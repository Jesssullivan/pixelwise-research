/**
 * ComputeDispatcher - Routes computation to Futhark WebGPU or Futhark WASM
 *
 * Provides a unified interface for running the ESDT/WCAG pipeline,
 * with automatic fallback between backends:
 *
 * Priority:
 * 1. Futhark WebGPU (GPU) - Unified Futhark-generated WebGPU shaders
 * 2. Futhark WASM (multicore) - CPU fallback, requires COOP/COEP headers
 * 3. Pure JS fallback - Last resort, single-threaded
 *
 * The dispatcher handles:
 * - Backend initialization and capability detection
 * - Automatic fallback on errors
 */

import { browser } from '$app/environment';
import { detectWebGPU, detectImportExternalTexture } from '$lib/pixelwise/featureDetection';

import videoCaptureEsdtShader from '$lib/pixelwise/shaders/video-capture-esdt.wgsl?raw';
import videoCaptureEsdtFallbackShader from '$lib/pixelwise/shaders/video-capture-esdt-fallback.wgsl?raw';

export interface ComputeConfig {
	maxDistance: number;
	targetContrast: number;
	sampleDistance: number;
	useRelaxation: boolean;
}

export const DEFAULT_CONFIG: ComputeConfig = {
	maxDistance: 3.0,
	targetContrast: 7.0, // WCAG AAA
	sampleDistance: 5.0,
	useRelaxation: false
};

export interface EsdtResult {
	/** Flat array of [delta_x, delta_y, ...] per pixel */
	data: Float32Array;
	width: number;
	height: number;
}

export interface PipelineResult {
	/** Adjusted RGBA pixel data */
	adjustedPixels: Uint8ClampedArray;
	/** Number of pixels that were adjusted */
	adjustedCount: number;
	/** Processing time in milliseconds */
	processingTime: number;
	/** Backend used for computation */
	backend: 'futhark-webgpu' | 'futhark-wasm' | 'js-fallback';
}

export type ComputeBackend = 'futhark-webgpu' | 'futhark-wasm' | 'auto';

interface FutharkContext {
	new_f32_2d(data: Float32Array, width: number, height: number): FutharkArray;
	compute_esdt_2d(input: FutharkArray, useRelaxation: boolean): FutharkArray;
}

interface FutharkArray {
	toTypedArray(): Promise<Float32Array>;
	free(): void;
}

/**
 * Futhark WebGPU context interface (from $lib/futhark-webgpu)
 */
interface FutharkWebGPUContext {
	enhanceContrastRgba(
		imageFlat: Uint8Array,
		width: number,
		height: number,
		targetContrast: number,
		maxDistance: number,
		sampleDistance: number
	): Promise<Uint8Array>;
	free(): void;
	sync(): Promise<void>;
}

/**
 * WebGPU context for video capture pipeline (uses hand-written shaders
 * since Futhark WebGPU doesn't support external textures yet)
 */
interface VideoCaptureContext {
	device: GPUDevice;
	adapter: GPUAdapter;
	videoCaptureEsdtModule: GPUShaderModule;
	videoCaptureEsdtPipeline: GPUComputePipeline;
	videoCaptureLayout: GPUBindGroupLayout;
	hasExternalTexture: boolean;
	sampler: GPUSampler;
}

/**
 * Result of processing a video frame
 */
export interface VideoCaptureResult {
	grayscaleBuffer: GPUBuffer;
	gradientXBuffer: GPUBuffer;
	gradientYBuffer: GPUBuffer;
	width: number;
	height: number;
	processingTime: number;
}

/**
 * Creates a compute dispatcher for the ESDT/WCAG pipeline.
 */
export function createComputeDispatcher() {
	let futharkContext: FutharkContext | null = null;
	let futharkWebGPUContext: FutharkWebGPUContext | null = null;
	let videoCaptureContext: VideoCaptureContext | null = null;
	let isInitialized = false;
	let initializationError: Error | null = null;
	let activeBackend: ComputeBackend = 'auto';

	/**
	 * Initialize the video capture pipeline (still uses hand-written WGSL
	 * since it needs GPUExternalTexture support not available in Futhark)
	 */
	async function initializeVideoCapture(device: GPUDevice): Promise<VideoCaptureContext | null> {
		const hasExternalTexture = detectImportExternalTexture();
		const shaderCode = hasExternalTexture ? videoCaptureEsdtShader : videoCaptureEsdtFallbackShader;

		const videoCaptureEsdtModule = device.createShaderModule({
			label: 'video-capture-esdt',
			code: shaderCode
		});

		const info = await videoCaptureEsdtModule.getCompilationInfo();
		for (const msg of info.messages) {
			if (msg.type === 'error') {
				console.error('[ComputeDispatcher] Video capture shader error:', msg.message);
				return null;
			}
		}

		const sampler = device.createSampler({
			label: 'video-capture-sampler',
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});

		const videoCaptureLayout = device.createBindGroupLayout({
			label: 'video-capture-layout',
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.COMPUTE,
					sampler: { type: 'filtering' }
				},
				{
					binding: 1,
					visibility: GPUShaderStage.COMPUTE,
					...(hasExternalTexture ? { externalTexture: {} } : { texture: { sampleType: 'float' } })
				},
				{
					binding: 2,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'storage' }
				},
				{
					binding: 3,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'storage' }
				},
				{
					binding: 4,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'storage' }
				},
				{
					binding: 5,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'uniform' }
				}
			]
		});

		const videoCaptureEsdtPipeline = device.createComputePipeline({
			label: 'video-capture-esdt-pipeline',
			layout: device.createPipelineLayout({
				bindGroupLayouts: [videoCaptureLayout]
			}),
			compute: {
				module: videoCaptureEsdtModule,
				entryPoint: 'main'
			}
		});

		// We need a GPU adapter for the context but it's only needed for video capture
		const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
		if (!adapter) return null;

		return {
			device,
			adapter,
			videoCaptureEsdtModule,
			videoCaptureEsdtPipeline,
			videoCaptureLayout,
			hasExternalTexture,
			sampler
		};
	}

	/**
	 * Initialize the Futhark WebGPU backend (unified GPU path)
	 *
	 * Uses the Futhark-generated WebGPU shaders compiled from pipeline.fut.
	 * Requires: `just futhark-webgpu-compile` to generate the module.
	 */
	async function initializeFutharkWebGPU(): Promise<boolean> {
		if (!browser) return false;

		try {
			const webgpuResult = await detectWebGPU();
			if (!webgpuResult.available) {
				console.warn('[ComputeDispatcher] WebGPU not available');
				return false;
			}

			const { newFutharkWebGPUContext } = await import('$lib/futhark-webgpu');
			futharkWebGPUContext = await newFutharkWebGPUContext();
			console.log('[ComputeDispatcher] Futhark WebGPU context initialized');

			// Initialize video capture if WebGPU is available
			// (video capture still uses hand-written shaders for external texture support)
			try {
				const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
				if (adapter) {
					const device = await adapter.requestDevice({
						requiredLimits: {
							maxBufferSize: 256 * 1024 * 1024,
							maxStorageBufferBindingSize: 128 * 1024 * 1024
						}
					});
					videoCaptureContext = await initializeVideoCapture(device);
					if (videoCaptureContext) {
						console.log('[ComputeDispatcher] Video capture pipeline initialized');
					}
				}
			} catch (err) {
				console.warn('[ComputeDispatcher] Video capture initialization failed (optional):', err);
			}

			return true;
		} catch (err) {
			console.warn('[ComputeDispatcher] Futhark WebGPU initialization failed:', err);
			return false;
		}
	}

	/**
	 * Initialize the Futhark WASM backend (CPU fallback)
	 */
	async function initializeFuthark(): Promise<boolean> {
		if (!browser) return false;

		try {
			const { newFutharkContext } = await import('$lib/futhark');

			if (typeof newFutharkContext === 'function') {
				futharkContext = await newFutharkContext();
				console.log('[ComputeDispatcher] Futhark WASM context initialized');
				return true;
			}

			throw new Error('Futhark module missing newFutharkContext');
		} catch (err) {
			console.warn('Futhark WASM initialization failed:', err);
			initializationError = err instanceof Error ? err : new Error(String(err));
			return false;
		}
	}

	/**
	 * Initialize the compute dispatcher
	 *
	 * Initialization order:
	 * 1. Futhark WebGPU (unified GPU path via Futhark-generated shaders)
	 * 2. Futhark WASM (multicore CPU fallback)
	 * 3. JS fallback (last resort)
	 */
	async function initialize(preferredBackend: ComputeBackend = 'auto'): Promise<boolean> {
		if (isInitialized) return true;

		activeBackend = preferredBackend;

		// Try Futhark WebGPU first (unified GPU path)
		if (preferredBackend === 'futhark-webgpu' || preferredBackend === 'auto') {
			if (await initializeFutharkWebGPU()) {
				// Also initialize Futhark WASM as fallback
				await initializeFuthark();
				isInitialized = true;
				activeBackend = 'futhark-webgpu';
				console.log('[ComputeDispatcher] Using Futhark WebGPU backend');
				return true;
			}
		}

		// Fall back to Futhark WASM
		if (preferredBackend === 'futhark-wasm' || preferredBackend === 'auto') {
			if (await initializeFuthark()) {
				isInitialized = true;
				activeBackend = 'futhark-wasm';
				console.log('[ComputeDispatcher] Using Futhark WASM backend');
				return true;
			}
		}

		// JS fallback
		console.warn('[ComputeDispatcher] No GPU compute backend available, using JS fallback');
		activeBackend = 'auto';
		isInitialized = true;
		return true;
	}

	/**
	 * Compute ESDT from grayscale levels using Futhark WASM
	 */
	async function computeEsdtFuthark(
		levels: Float32Array,
		width: number,
		height: number,
		useRelaxation: boolean
	): Promise<EsdtResult> {
		if (!futharkContext) {
			throw new Error('Futhark context not initialized');
		}

		const input2d = futharkContext.new_f32_2d(levels, width, height);

		try {
			const result = futharkContext.compute_esdt_2d(input2d, useRelaxation);
			const data = await result.toTypedArray();
			result.free();
			return { data, width, height };
		} finally {
			input2d.free();
		}
	}

	/**
	 * Pure JS ESDT fallback (simplified version)
	 */
	function computeEsdtFallback(
		levels: Float32Array,
		width: number,
		height: number,
		_useRelaxation: boolean
	): EsdtResult {
		const data = new Float32Array(width * height * 2);

		for (let i = 0; i < width * height; i++) {
			if (levels[i] >= 0.5) {
				data[i * 2] = 0;
				data[i * 2 + 1] = 0;
			} else {
				data[i * 2] = 1e10;
				data[i * 2 + 1] = 1e10;
			}
		}

		// X-pass forward
		for (let y = 0; y < height; y++) {
			for (let x = 1; x < width; x++) {
				const idx = (y * width + x) * 2;
				const prevIdx = (y * width + x - 1) * 2;
				const candX = data[prevIdx] + 1;
				const candY = data[prevIdx + 1];
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		// X-pass backward
		for (let y = 0; y < height; y++) {
			for (let x = width - 2; x >= 0; x--) {
				const idx = (y * width + x) * 2;
				const nextIdx = (y * width + x + 1) * 2;
				const candX = data[nextIdx] - 1;
				const candY = data[nextIdx + 1];
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		// Y-pass forward
		for (let x = 0; x < width; x++) {
			for (let y = 1; y < height; y++) {
				const idx = (y * width + x) * 2;
				const prevIdx = ((y - 1) * width + x) * 2;
				const candX = data[prevIdx];
				const candY = data[prevIdx + 1] + 1;
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		// Y-pass backward
		for (let x = 0; x < width; x++) {
			for (let y = height - 2; y >= 0; y--) {
				const idx = (y * width + x) * 2;
				const nextIdx = ((y + 1) * width + x) * 2;
				const candX = data[nextIdx];
				const candY = data[nextIdx + 1] - 1;
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		return { data, width, height };
	}

	/**
	 * Run the full contrast enhancement pipeline using Futhark WebGPU
	 */
	async function runFullPipelineFutharkWebGPU(
		rgbaData: Uint8ClampedArray,
		width: number,
		height: number,
		config: ComputeConfig
	): Promise<PipelineResult> {
		if (!futharkWebGPUContext) {
			throw new Error('Futhark WebGPU context not initialized');
		}

		const startTime = performance.now();

		try {
			const inputData = new Uint8Array(rgbaData);

			const resultData = await futharkWebGPUContext.enhanceContrastRgba(
				inputData,
				width,
				height,
				config.targetContrast,
				config.maxDistance,
				config.sampleDistance
			);

			await futharkWebGPUContext.sync();

			const processingTime = performance.now() - startTime;
			const adjustedPixels = new Uint8ClampedArray(resultData);

			// Count adjusted pixels
			let adjustedCount = 0;
			for (let i = 3; i < adjustedPixels.length; i += 4) {
				if (adjustedPixels[i] > 0) {
					adjustedCount++;
				}
			}

			return {
				adjustedPixels,
				adjustedCount,
				processingTime,
				backend: 'futhark-webgpu'
			};
		} catch (err) {
			console.error('[ComputeDispatcher] Futhark WebGPU pipeline failed:', err);
			throw err;
		}
	}

	/**
	 * Run the full contrast enhancement pipeline
	 *
	 * Backend selection:
	 * 1. Futhark WebGPU (GPU, unified Futhark-generated shaders)
	 * 2. CPU fallback (returns original data)
	 */
	async function runFullPipeline(
		rgbaData: Uint8ClampedArray,
		width: number,
		height: number,
		config: Partial<ComputeConfig> = {}
	): Promise<PipelineResult> {
		const fullConfig = { ...DEFAULT_CONFIG, ...config };

		// Try Futhark WebGPU
		if (futharkWebGPUContext) {
			try {
				return await runFullPipelineFutharkWebGPU(rgbaData, width, height, fullConfig);
			} catch (err) {
				console.warn('[ComputeDispatcher] Futhark WebGPU pipeline failed, falling back:', err);
			}
		}

		// Fall back to CPU processing
		return {
			adjustedPixels: new Uint8ClampedArray(rgbaData),
			adjustedCount: 0,
			processingTime: 0,
			backend: futharkContext ? 'futhark-wasm' : 'js-fallback'
		};
	}

	/**
	 * Process a video frame for ESDT pipeline
	 *
	 * Uses hand-written WGSL shaders for video capture since Futhark WebGPU
	 * doesn't support GPUExternalTexture.
	 */
	async function processVideoFrame(video: HTMLVideoElement): Promise<VideoCaptureResult | null> {
		if (!videoCaptureContext) {
			return null;
		}

		const startTime = performance.now();
		const { device, videoCaptureEsdtPipeline, videoCaptureLayout, hasExternalTexture, sampler } =
			videoCaptureContext;

		const width = video.videoWidth;
		const height = video.videoHeight;

		if (width === 0 || height === 0) {
			return null;
		}

		const pixelCount = width * height;

		const grayscaleBuffer = device.createBuffer({
			label: 'video-grayscale',
			size: pixelCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
		});

		const gradientXBuffer = device.createBuffer({
			label: 'video-gradient-x',
			size: pixelCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
		});

		const gradientYBuffer = device.createBuffer({
			label: 'video-gradient-y',
			size: pixelCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
		});

		const paramsBuffer = device.createBuffer({
			label: 'video-capture-params',
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		const params = new ArrayBuffer(16);
		new Uint32Array(params, 0, 2).set([width, height]);
		new Float32Array(params, 8, 1).set([window.devicePixelRatio || 1]);
		device.queue.writeBuffer(paramsBuffer, 0, params);

		let bindGroup: GPUBindGroup;

		if (hasExternalTexture) {
			const externalTexture = device.importExternalTexture({
				source: video,
				colorSpace: 'srgb'
			});

			bindGroup = device.createBindGroup({
				label: 'video-capture-bind-group',
				layout: videoCaptureLayout,
				entries: [
					{ binding: 0, resource: sampler },
					{ binding: 1, resource: externalTexture },
					{ binding: 2, resource: { buffer: grayscaleBuffer } },
					{ binding: 3, resource: { buffer: gradientXBuffer } },
					{ binding: 4, resource: { buffer: gradientYBuffer } },
					{ binding: 5, resource: { buffer: paramsBuffer } }
				]
			});
		} else {
			const fallbackTexture = device.createTexture({
				label: 'video-fallback-texture',
				size: [width, height],
				format: 'rgba8unorm',
				usage:
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_DST |
					GPUTextureUsage.RENDER_ATTACHMENT
			});

			device.queue.copyExternalImageToTexture(
				{ source: video, flipY: false },
				{ texture: fallbackTexture },
				[width, height]
			);

			bindGroup = device.createBindGroup({
				label: 'video-capture-bind-group-fallback',
				layout: videoCaptureLayout,
				entries: [
					{ binding: 0, resource: sampler },
					{ binding: 1, resource: fallbackTexture.createView() },
					{ binding: 2, resource: { buffer: grayscaleBuffer } },
					{ binding: 3, resource: { buffer: gradientXBuffer } },
					{ binding: 4, resource: { buffer: gradientYBuffer } },
					{ binding: 5, resource: { buffer: paramsBuffer } }
				]
			});
		}

		const encoder = device.createCommandEncoder({ label: 'video-capture-encoder' });
		const pass = encoder.beginComputePass({ label: 'video-capture-pass' });
		pass.setPipeline(videoCaptureEsdtPipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
		pass.end();

		device.queue.submit([encoder.finish()]);
		await device.queue.onSubmittedWorkDone();

		paramsBuffer.destroy();

		const processingTime = performance.now() - startTime;

		return {
			grayscaleBuffer,
			gradientXBuffer,
			gradientYBuffer,
			width,
			height,
			processingTime
		};
	}

	/**
	 * Check if video capture is available
	 */
	function hasVideoCapture(): boolean {
		return videoCaptureContext !== null;
	}

	/**
	 * Compute ESDT from grayscale levels
	 *
	 * Backend selection order:
	 * 1. Futhark WASM (if initialized)
	 * 2. JS fallback
	 */
	async function computeEsdt(
		levels: Float32Array,
		width: number,
		height: number,
		config: Partial<ComputeConfig> = {}
	): Promise<EsdtResult> {
		const { useRelaxation = DEFAULT_CONFIG.useRelaxation } = config;

		if (futharkContext) {
			return computeEsdtFuthark(levels, width, height, useRelaxation);
		}

		return computeEsdtFallback(levels, width, height, useRelaxation);
	}

	/**
	 * Get distance value from ESDT result
	 */
	function getDistance(esdt: EsdtResult, x: number, y: number): number {
		const idx = (y * esdt.width + x) * 2;
		const dx = esdt.data[idx];
		const dy = esdt.data[idx + 1];
		return Math.sqrt(dx * dx + dy * dy);
	}

	/**
	 * Get gradient direction from ESDT result
	 */
	function getGradient(esdt: EsdtResult, x: number, y: number): [number, number] {
		const idx = (y * esdt.width + x) * 2;
		const dx = esdt.data[idx];
		const dy = esdt.data[idx + 1];
		const d = Math.sqrt(dx * dx + dy * dy);
		if (d > 0.001) {
			return [dx / d, dy / d];
		}
		return [0, 0];
	}

	/**
	 * Cleanup resources
	 */
	function destroy() {
		if (videoCaptureContext) {
			videoCaptureContext.device.destroy();
			videoCaptureContext = null;
		}
		if (futharkWebGPUContext) {
			futharkWebGPUContext.free();
			futharkWebGPUContext = null;
		}
		futharkContext = null;
		isInitialized = false;
		initializationError = null;
		activeBackend = 'auto';
	}

	/**
	 * Force switch to a different backend (for testing/debugging)
	 */
	function switchBackend(backend: ComputeBackend): boolean {
		if (backend === 'futhark-webgpu' && futharkWebGPUContext) {
			activeBackend = 'futhark-webgpu';
			return true;
		}
		if (backend === 'futhark-wasm' && futharkContext) {
			activeBackend = 'futhark-wasm';
			return true;
		}
		if (backend === 'auto') {
			if (futharkWebGPUContext) {
				activeBackend = 'futhark-webgpu';
			} else if (futharkContext) {
				activeBackend = 'futhark-wasm';
			} else {
				activeBackend = 'auto';
			}
			return true;
		}
		return false;
	}

	return {
		initialize,
		computeEsdt,
		runFullPipeline,
		processVideoFrame,
		hasVideoCapture,
		getDistance,
		getGradient,
		destroy,
		switchBackend,
		get isInitialized() {
			return isInitialized;
		},
		get activeBackend() {
			return activeBackend;
		},
		get hasWebGPU() {
			return futharkWebGPUContext !== null;
		},
		get hasFuthark() {
			return futharkContext !== null;
		},
		get hasFutharkWebGPU() {
			return futharkWebGPUContext !== null;
		},
		get error() {
			return initializationError;
		}
	};
}

export type ComputeDispatcher = ReturnType<typeof createComputeDispatcher>;
