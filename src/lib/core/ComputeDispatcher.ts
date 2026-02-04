/**
 * ComputeDispatcher - Routes computation to Futhark WASM or WebGPU
 *
 * Provides a unified interface for running the ESDT/WCAG pipeline,
 * with automatic fallback between backends:
 *
 * Priority:
 * 1. WebGPU (via WGSL shaders) - GPU acceleration path
 * 2. Futhark WASM (multicore) - Always available in browser
 * 3. Pure JS fallback - Last resort
 *
 * The dispatcher handles:
 * - Backend initialization and capability detection
 * - Memory management and buffer pooling
 * - Automatic fallback on errors
 */

import { browser } from '$app/environment';
import { detectWebGPU, detectImportExternalTexture } from '$lib/pixelwise/featureDetection';

// Import shader sources as raw strings (Vite handles this with ?raw suffix)
import grayscaleGradientShader from '$lib/pixelwise/shaders/esdt-grayscale-gradient.wgsl?raw';
import esdtXPassShader from '$lib/pixelwise/shaders/esdt-x-pass.wgsl?raw';
import esdtYPassShader from '$lib/pixelwise/shaders/esdt-y-pass.wgsl?raw';
import extractPixelsShader from '$lib/pixelwise/shaders/esdt-extract-pixels.wgsl?raw';
import backgroundSampleShader from '$lib/pixelwise/shaders/esdt-background-sample.wgsl?raw';
import contrastAnalysisShader from '$lib/pixelwise/shaders/esdt-contrast-analysis.wgsl?raw';
import colorAdjustShader from '$lib/pixelwise/shaders/esdt-color-adjust.wgsl?raw';
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
	backend: 'futhark-wasm' | 'webgpu' | 'js-fallback';
}

export type ComputeBackend = 'futhark-wasm' | 'webgpu' | 'auto';

interface FutharkContext {
	new_f32_2d(data: Float32Array, width: number, height: number): FutharkArray;
	compute_esdt_2d(input: FutharkArray, useRelaxation: boolean): FutharkArray;
	// Add more entry points as needed
}

interface FutharkArray {
	toTypedArray(): Promise<Float32Array>;
	free(): void;
}

/**
 * WebGPU pipeline state for ESDT computation
 */
interface WebGPUContext {
	device: GPUDevice;
	adapter: GPUAdapter;

	// Shader modules
	grayscaleGradientModule: GPUShaderModule;
	esdtXPassModule: GPUShaderModule;
	esdtYPassModule: GPUShaderModule;
	extractPixelsModule: GPUShaderModule;
	backgroundSampleModule: GPUShaderModule;
	contrastAnalysisModule: GPUShaderModule;
	colorAdjustModule: GPUShaderModule;

	// Compute pipelines
	grayscaleGradientPipeline: GPUComputePipeline;
	esdtXPassPipeline: GPUComputePipeline;
	esdtYPassPipeline: GPUComputePipeline;
	extractPixelsPipeline: GPUComputePipeline;
	backgroundSamplePipeline: GPUComputePipeline;
	contrastAnalysisPipeline: GPUComputePipeline;
	colorAdjustPipeline: GPUComputePipeline;
}

/**
 * Video capture pipeline state
 */
interface VideoCaptureContext {
	/** Video capture ESDT shader module */
	videoCaptureEsdtModule: GPUShaderModule;
	/** Video capture ESDT pipeline */
	videoCaptureEsdtPipeline: GPUComputePipeline;
	/** Bind group layout for video capture */
	videoCaptureLayout: GPUBindGroupLayout;
	/** Whether external texture is supported */
	hasExternalTexture: boolean;
	/** Sampler for video texture */
	sampler: GPUSampler;
}

/**
 * Result of processing a video frame
 */
export interface VideoCaptureResult {
	/** Grayscale luminance buffer */
	grayscaleBuffer: GPUBuffer;
	/** Horizontal gradient buffer */
	gradientXBuffer: GPUBuffer;
	/** Vertical gradient buffer */
	gradientYBuffer: GPUBuffer;
	/** Frame width */
	width: number;
	/** Frame height */
	height: number;
	/** Processing time in milliseconds */
	processingTime: number;
}

/**
 * Struct layouts for GPU buffers (matching WGSL structs)
 */
const DISTANCE_DATA_SIZE = 12; // 3 x f32 (delta_x, delta_y, distance)
const GLYPH_PIXEL_SIZE = 24; // 6 x f32 (x, y, coverage, edge_weight, grad_x, grad_y)

/**
 * Creates a compute dispatcher for the ESDT/WCAG pipeline.
 */
export function createComputeDispatcher() {
	let futharkContext: FutharkContext | null = null;
	let webgpuContext: WebGPUContext | null = null;
	let videoCaptureContext: VideoCaptureContext | null = null;
	let isInitialized = false;
	let initializationError: Error | null = null;
	let activeBackend: ComputeBackend = 'auto';

	/**
	 * Initialize the video capture pipeline
	 */
	async function initializeVideoCapture(device: GPUDevice): Promise<VideoCaptureContext | null> {
		const hasExternalTexture = detectImportExternalTexture();

		// Choose shader based on external texture support
		const shaderCode = hasExternalTexture ? videoCaptureEsdtShader : videoCaptureEsdtFallbackShader;

		const videoCaptureEsdtModule = device.createShaderModule({
			label: 'video-capture-esdt',
			code: shaderCode
		});

		// Check compilation
		const info = await videoCaptureEsdtModule.getCompilationInfo();
		for (const msg of info.messages) {
			if (msg.type === 'error') {
				console.error('[ComputeDispatcher] Video capture shader error:', msg.message);
				return null;
			}
		}

		// Create sampler for video texture
		const sampler = device.createSampler({
			label: 'video-capture-sampler',
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});

		// Create bind group layout
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

		// Create pipeline
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

		return {
			videoCaptureEsdtModule,
			videoCaptureEsdtPipeline,
			videoCaptureLayout,
			hasExternalTexture,
			sampler
		};
	}

	/**
	 * Initialize the WebGPU backend
	 */
	async function initializeWebGPU(): Promise<boolean> {
		if (!browser) return false;

		try {
			const webgpuResult = await detectWebGPU();
			if (!webgpuResult.available) {
				console.warn('[ComputeDispatcher] WebGPU not available');
				return false;
			}

			// Request adapter
			const adapter = await navigator.gpu.requestAdapter({
				powerPreference: 'high-performance'
			});

			if (!adapter) {
				console.warn('[ComputeDispatcher] No WebGPU adapter found');
				return false;
			}

			// Request device with required limits
			const device = await adapter.requestDevice({
				requiredLimits: {
					maxBufferSize: 256 * 1024 * 1024, // 256MB
					maxStorageBufferBindingSize: 128 * 1024 * 1024 // 128MB
				}
			});

			// Set up device lost handler
			device.lost.then((info) => {
				console.error('[ComputeDispatcher] WebGPU device lost:', info.message);
				webgpuContext = null;
				// Fall back to Futhark WASM
				if (futharkContext) {
					activeBackend = 'futhark-wasm';
				}
			});

			// Compile shader modules
			const grayscaleGradientModule = device.createShaderModule({
				label: 'esdt-grayscale-gradient',
				code: grayscaleGradientShader
			});

			const esdtXPassModule = device.createShaderModule({
				label: 'esdt-x-pass',
				code: esdtXPassShader
			});

			const esdtYPassModule = device.createShaderModule({
				label: 'esdt-y-pass',
				code: esdtYPassShader
			});

			const extractPixelsModule = device.createShaderModule({
				label: 'esdt-extract-pixels',
				code: extractPixelsShader
			});

			const backgroundSampleModule = device.createShaderModule({
				label: 'esdt-background-sample',
				code: backgroundSampleShader
			});

			const contrastAnalysisModule = device.createShaderModule({
				label: 'esdt-contrast-analysis',
				code: contrastAnalysisShader
			});

			const colorAdjustModule = device.createShaderModule({
				label: 'esdt-color-adjust',
				code: colorAdjustShader
			});

			// Check for shader compilation errors
			const checkCompilation = async (module: GPUShaderModule, name: string) => {
				const info = await module.getCompilationInfo();
				for (const msg of info.messages) {
					if (msg.type === 'error') {
						console.error(`[ComputeDispatcher] Shader ${name} error:`, msg.message);
						return false;
					}
					if (msg.type === 'warning') {
						console.warn(`[ComputeDispatcher] Shader ${name} warning:`, msg.message);
					}
				}
				return true;
			};

			const compilationResults = await Promise.all([
				checkCompilation(grayscaleGradientModule, 'grayscale-gradient'),
				checkCompilation(esdtXPassModule, 'x-pass'),
				checkCompilation(esdtYPassModule, 'y-pass'),
				checkCompilation(extractPixelsModule, 'extract-pixels'),
				checkCompilation(backgroundSampleModule, 'background-sample'),
				checkCompilation(contrastAnalysisModule, 'contrast-analysis'),
				checkCompilation(colorAdjustModule, 'color-adjust')
			]);

			if (!compilationResults.every(Boolean)) {
				console.error('[ComputeDispatcher] Shader compilation failed');
				device.destroy();
				return false;
			}

			// Create compute pipelines
			const grayscaleGradientPipeline = device.createComputePipeline({
				label: 'esdt-grayscale-gradient-pipeline',
				layout: 'auto',
				compute: {
					module: grayscaleGradientModule,
					entryPoint: 'main'
				}
			});

			const esdtXPassPipeline = device.createComputePipeline({
				label: 'esdt-x-pass-pipeline',
				layout: 'auto',
				compute: {
					module: esdtXPassModule,
					entryPoint: 'main'
				}
			});

			const esdtYPassPipeline = device.createComputePipeline({
				label: 'esdt-y-pass-pipeline',
				layout: 'auto',
				compute: {
					module: esdtYPassModule,
					entryPoint: 'main'
				}
			});

			const extractPixelsPipeline = device.createComputePipeline({
				label: 'esdt-extract-pixels-pipeline',
				layout: 'auto',
				compute: {
					module: extractPixelsModule,
					entryPoint: 'main'
				}
			});

			const backgroundSamplePipeline = device.createComputePipeline({
				label: 'esdt-background-sample-pipeline',
				layout: 'auto',
				compute: {
					module: backgroundSampleModule,
					entryPoint: 'main'
				}
			});

			const contrastAnalysisPipeline = device.createComputePipeline({
				label: 'esdt-contrast-analysis-pipeline',
				layout: 'auto',
				compute: {
					module: contrastAnalysisModule,
					entryPoint: 'main'
				}
			});

			const colorAdjustPipeline = device.createComputePipeline({
				label: 'esdt-color-adjust-pipeline',
				layout: 'auto',
				compute: {
					module: colorAdjustModule,
					entryPoint: 'main'
				}
			});

			webgpuContext = {
				device,
				adapter,
				grayscaleGradientModule,
				esdtXPassModule,
				esdtYPassModule,
				extractPixelsModule,
				backgroundSampleModule,
				contrastAnalysisModule,
				colorAdjustModule,
				grayscaleGradientPipeline,
				esdtXPassPipeline,
				esdtYPassPipeline,
				extractPixelsPipeline,
				backgroundSamplePipeline,
				contrastAnalysisPipeline,
				colorAdjustPipeline
			};

			// Initialize video capture context
			try {
				videoCaptureContext = await initializeVideoCapture(device);
				if (videoCaptureContext) {
					console.log('[ComputeDispatcher] Video capture pipeline initialized');
				}
			} catch (err) {
				console.warn('[ComputeDispatcher] Video capture initialization failed (optional):', err);
				// Video capture is optional, continue without it
			}

			console.log('[ComputeDispatcher] WebGPU initialized successfully');
			return true;
		} catch (err) {
			console.warn('[ComputeDispatcher] WebGPU initialization failed:', err);
			initializationError = err instanceof Error ? err : new Error(String(err));
			return false;
		}
	}

	/**
	 * Initialize the Futhark WASM backend
	 */
	async function initializeFuthark(): Promise<boolean> {
		if (!browser) return false;

		try {
			// Dynamic import of the Futhark WASM module wrapper
			// The wrapper combines esdt.mjs (loadWASM) with esdt.class.js (FutharkContext)
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
	 * 1. WebGPU (if available and preferred or auto)
	 * 2. Futhark WASM (always available)
	 * 3. JS fallback (last resort)
	 */
	async function initialize(preferredBackend: ComputeBackend = 'auto'): Promise<boolean> {
		if (isInitialized) return true;

		activeBackend = preferredBackend;

		// Try WebGPU first for GPU acceleration
		if (preferredBackend === 'webgpu' || preferredBackend === 'auto') {
			if (await initializeWebGPU()) {
				// Also initialize Futhark as fallback
				await initializeFuthark();
				isInitialized = true;
				activeBackend = 'webgpu';
				console.log('[ComputeDispatcher] Using WebGPU backend');
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

		// Create 2D input array
		const input2d = futharkContext.new_f32_2d(levels, width, height);

		try {
			// Run ESDT computation
			const result = futharkContext.compute_esdt_2d(input2d, useRelaxation);
			const data = await result.toTypedArray();
			result.free();

			return { data, width, height };
		} finally {
			input2d.free();
		}
	}

	/**
	 * Compute ESDT from grayscale levels using WebGPU
	 *
	 * Pipeline order:
	 * 1. grayscale-gradient: input texture → grayscale[], gradient_x[], gradient_y[]
	 * 2. esdt-x-pass: grayscale, gradients → distances[] (horizontal propagation)
	 * 3. esdt-y-pass: distances → distances (vertical propagation)
	 */
	async function computeEsdtWebGPU(
		levels: Float32Array,
		width: number,
		height: number,
		_useRelaxation: boolean
	): Promise<EsdtResult> {
		if (!webgpuContext) {
			throw new Error('WebGPU context not initialized');
		}

		const { device, esdtXPassPipeline, esdtYPassPipeline } = webgpuContext;
		const pixelCount = width * height;

		// Create GPU buffers
		const grayscaleBuffer = device.createBuffer({
			label: 'grayscale',
			size: pixelCount * 4, // f32
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
		});

		const gradientXBuffer = device.createBuffer({
			label: 'gradient_x',
			size: pixelCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
		});

		const gradientYBuffer = device.createBuffer({
			label: 'gradient_y',
			size: pixelCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
		});

		const distancesBuffer = device.createBuffer({
			label: 'distances',
			size: pixelCount * DISTANCE_DATA_SIZE,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
		});

		const readbackBuffer = device.createBuffer({
			label: 'readback',
			size: pixelCount * DISTANCE_DATA_SIZE,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
		});

		// Params uniform buffer for x-pass (width, height, padding)
		const xPassParamsBuffer = device.createBuffer({
			label: 'x-pass-params',
			size: 12, // 3 x u32
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		// Params uniform buffer for y-pass (width, height)
		const yPassParamsBuffer = device.createBuffer({
			label: 'y-pass-params',
			size: 8, // 2 x u32
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		// Upload data to GPU
		// Cast to ArrayBuffer for WebGPU compatibility
		device.queue.writeBuffer(grayscaleBuffer, 0, levels.buffer as ArrayBuffer, levels.byteOffset, levels.byteLength);

		// Compute gradients on CPU (simpler than full grayscale-gradient shader)
		// This matches the Futhark compute_gradient function
		const gradientX = new Float32Array(pixelCount);
		const gradientY = new Float32Array(pixelCount);
		const weights = [1, 2, 1];

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				let gx = 0, gy = 0;

				for (let dy = 0; dy < 3; dy++) {
					for (let dx = 0; dx < 3; dx++) {
						const px = Math.max(0, Math.min(width - 1, x + dx - 1));
						const py = Math.max(0, Math.min(height - 1, y + dy - 1));
						const sample = levels[py * width + px];
						const wt = weights[dy] * weights[dx];
						gx += (dx - 1) * sample * wt;
						gy += (dy - 1) * sample * wt;
					}
				}

				const len = Math.sqrt(gx * gx + gy * gy);
				const idx = y * width + x;
				if (len > 0.001) {
					gradientX[idx] = gx / len;
					gradientY[idx] = gy / len;
				} else {
					gradientX[idx] = 0;
					gradientY[idx] = 0;
				}
			}
		}

		device.queue.writeBuffer(gradientXBuffer, 0, gradientX.buffer as ArrayBuffer, gradientX.byteOffset, gradientX.byteLength);
		device.queue.writeBuffer(gradientYBuffer, 0, gradientY.buffer as ArrayBuffer, gradientY.byteOffset, gradientY.byteLength);

		// Write params
		const xPassParams = new Uint32Array([width, height, 0]); // padding
		const yPassParams = new Uint32Array([width, height]);
		device.queue.writeBuffer(xPassParamsBuffer, 0, xPassParams);
		device.queue.writeBuffer(yPassParamsBuffer, 0, yPassParams);

		// Create bind groups
		const xPassBindGroup = device.createBindGroup({
			label: 'x-pass-bind-group',
			layout: esdtXPassPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: grayscaleBuffer } },
				{ binding: 1, resource: { buffer: distancesBuffer } },
				{ binding: 2, resource: { buffer: xPassParamsBuffer } },
				{ binding: 3, resource: { buffer: gradientXBuffer } },
				{ binding: 4, resource: { buffer: gradientYBuffer } }
			]
		});

		const yPassBindGroup = device.createBindGroup({
			label: 'y-pass-bind-group',
			layout: esdtYPassPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: distancesBuffer } },
				{ binding: 1, resource: { buffer: yPassParamsBuffer } }
			]
		});

		// Execute compute passes
		const commandEncoder = device.createCommandEncoder();

		// X-pass: one workgroup per row
		const xPassEncoder = commandEncoder.beginComputePass();
		xPassEncoder.setPipeline(esdtXPassPipeline);
		xPassEncoder.setBindGroup(0, xPassBindGroup);
		xPassEncoder.dispatchWorkgroups(Math.ceil(height / 256));
		xPassEncoder.end();

		// Y-pass: one workgroup per column
		const yPassEncoder = commandEncoder.beginComputePass();
		yPassEncoder.setPipeline(esdtYPassPipeline);
		yPassEncoder.setBindGroup(0, yPassBindGroup);
		yPassEncoder.dispatchWorkgroups(Math.ceil(width / 256));
		yPassEncoder.end();

		// Copy results to readback buffer
		commandEncoder.copyBufferToBuffer(
			distancesBuffer, 0,
			readbackBuffer, 0,
			pixelCount * DISTANCE_DATA_SIZE
		);

		// Submit and wait
		device.queue.submit([commandEncoder.finish()]);

		// Map and read results
		await readbackBuffer.mapAsync(GPUMapMode.READ);
		const resultArray = new Float32Array(readbackBuffer.getMappedRange());

		// Convert from DistanceData struct (delta_x, delta_y, distance) to flat [delta_x, delta_y]
		const data = new Float32Array(pixelCount * 2);
		for (let i = 0; i < pixelCount; i++) {
			data[i * 2] = resultArray[i * 3]; // delta_x
			data[i * 2 + 1] = resultArray[i * 3 + 1]; // delta_y
		}

		readbackBuffer.unmap();

		// Cleanup GPU resources
		grayscaleBuffer.destroy();
		gradientXBuffer.destroy();
		gradientYBuffer.destroy();
		distancesBuffer.destroy();
		readbackBuffer.destroy();
		xPassParamsBuffer.destroy();
		yPassParamsBuffer.destroy();

		return { data, width, height };
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

		// Initialize: foreground=0, background=inf
		for (let i = 0; i < width * height; i++) {
			if (levels[i] >= 0.5) {
				data[i * 2] = 0;
				data[i * 2 + 1] = 0;
			} else {
				data[i * 2] = 1e10;
				data[i * 2 + 1] = 1e10;
			}
		}

		// Simple X and Y passes (not as accurate as full ESDT)
		// This is a placeholder - real implementation would port the full algorithm

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
	 * Run the full 6-pass WebGPU contrast enhancement pipeline (CPU preprocessing + 6 GPU passes)
	 *
	 * Pipeline:
	 * 1. Grayscale + Gradient computation
	 * 2. ESDT X-pass (horizontal propagation)
	 * 3. ESDT Y-pass (vertical propagation)
	 * 4. Extract glyph pixels
	 * 5. Background sampling
	 * 6. Contrast analysis
	 * 7. Color adjustment
	 */
	async function runFullPipelineWebGPU(
		rgbaData: Uint8ClampedArray,
		width: number,
		height: number,
		config: ComputeConfig
	): Promise<PipelineResult> {
		if (!webgpuContext) {
			throw new Error('WebGPU context not initialized');
		}

		const startTime = performance.now();
		const {
			device,
			esdtXPassPipeline,
			esdtYPassPipeline,
			extractPixelsPipeline,
			backgroundSamplePipeline,
			contrastAnalysisPipeline,
			colorAdjustPipeline
		} = webgpuContext;

		const pixelCount = width * height;
		const maxGlyphPixels = pixelCount; // Worst case: all pixels are glyph pixels

		// Convert RGBA u8 to grayscale f32 and compute gradients on CPU
		// (Full GPU implementation would use grayscale-gradient shader)
		const grayscale = new Float32Array(pixelCount);
		const gradientX = new Float32Array(pixelCount);
		const gradientY = new Float32Array(pixelCount);

		// sRGB to linear conversion
		const toLinear = (c: number) => {
			const v = c / 255;
			return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
		};

		// Compute INVERTED grayscale luminance for ESDT
		// ESDT treats high values as "foreground" (glyph), low values as "background"
		// For text detection: dark text should be foreground, so we INVERT:
		// - Black text (luminance 0) → grayscale 1.0 (foreground, distance 0)
		// - White background (luminance 1) → grayscale 0.0 (background, distance INF)
		for (let i = 0; i < pixelCount; i++) {
			const r = toLinear(rgbaData[i * 4]);
			const g = toLinear(rgbaData[i * 4 + 1]);
			const b = toLinear(rgbaData[i * 4 + 2]);
			const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
			grayscale[i] = 1.0 - luminance; // INVERT for text detection
		}

		// Compute Sobel gradients
		const weights = [1, 2, 1];
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				let gx = 0, gy = 0;
				for (let dy = 0; dy < 3; dy++) {
					for (let dx = 0; dx < 3; dx++) {
						const px = Math.max(0, Math.min(width - 1, x + dx - 1));
						const py = Math.max(0, Math.min(height - 1, y + dy - 1));
						const sample = grayscale[py * width + px];
						const wt = weights[dy] * weights[dx];
						gx += (dx - 1) * sample * wt;
						gy += (dy - 1) * sample * wt;
					}
				}
				const len = Math.sqrt(gx * gx + gy * gy);
				const idx = y * width + x;
				if (len > 0.001) {
					gradientX[idx] = gx / len;
					gradientY[idx] = gy / len;
				}
			}
		}

		// Create GPU buffers
		const grayscaleBuffer = device.createBuffer({
			label: 'grayscale',
			size: pixelCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
		});

		const gradientXBuffer = device.createBuffer({
			label: 'gradient_x',
			size: pixelCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
		});

		const gradientYBuffer = device.createBuffer({
			label: 'gradient_y',
			size: pixelCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
		});

		const distancesBuffer = device.createBuffer({
			label: 'distances',
			size: pixelCount * DISTANCE_DATA_SIZE,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
		});

		const glyphPixelsBuffer = device.createBuffer({
			label: 'glyph_pixels',
			size: maxGlyphPixels * GLYPH_PIXEL_SIZE,
			usage: GPUBufferUsage.STORAGE
		});

		const pixelCountBuffer = device.createBuffer({
			label: 'pixel_count',
			size: 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
		});

		const backgroundSamplesBuffer = device.createBuffer({
			label: 'background_samples',
			size: maxGlyphPixels * 16, // BackgroundSample: r,g,b,valid (4 x f32)
			usage: GPUBufferUsage.STORAGE
		});

		const contrastAnalysesBuffer = device.createBuffer({
			label: 'contrast_analyses',
			size: maxGlyphPixels * 16, // ContrastAnalysis: 4 x f32
			usage: GPUBufferUsage.STORAGE
		});

		// Params buffers
		const xPassParamsBuffer = device.createBuffer({
			label: 'x-pass-params',
			size: 12, // width, height, padding
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		const yPassParamsBuffer = device.createBuffer({
			label: 'y-pass-params',
			size: 8, // width, height
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		const extractParamsBuffer = device.createBuffer({
			label: 'extract-params',
			size: 12, // width, height, max_distance
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		const backgroundParamsBuffer = device.createBuffer({
			label: 'background-params',
			size: 12, // width, height, sample_distance
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		const contrastParamsBuffer = device.createBuffer({
			label: 'contrast-params',
			size: 4, // target_contrast
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		const colorAdjustParamsBuffer = device.createBuffer({
			label: 'color-adjust-params',
			size: 4, // edge_boost_strength
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		const pixelCountReadbackBuffer = device.createBuffer({
			label: 'pixel-count-readback',
			size: 4,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
		});

		// Create input texture from RGBA data
		const inputTexture = device.createTexture({
			label: 'input-texture',
			size: [width, height],
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		});

		// Create output texture for color adjustment
		const outputTexture = device.createTexture({
			label: 'output-texture',
			size: [width, height],
			format: 'rgba8unorm',
			usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
		});

		// WebGPU requires bytesPerRow to be a multiple of 256 for texture-buffer copies
		const unalignedBytesPerRow = width * 4;
		const alignedBytesPerRow = Math.ceil(unalignedBytesPerRow / 256) * 256;
		const paddedBufferSize = alignedBytesPerRow * height;

		const outputReadbackBuffer = device.createBuffer({
			label: 'output-readback',
			size: paddedBufferSize,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
		});

		// Upload data to GPU
		device.queue.writeBuffer(grayscaleBuffer, 0, grayscale);
		device.queue.writeBuffer(gradientXBuffer, 0, gradientX);
		device.queue.writeBuffer(gradientYBuffer, 0, gradientY);
		device.queue.writeBuffer(pixelCountBuffer, 0, new Uint32Array([0])); // Initialize to 0
		// Copy RGBA data to regular ArrayBuffer for WebGPU compatibility
		const rgbaBuffer = new ArrayBuffer(rgbaData.byteLength);
		new Uint8Array(rgbaBuffer).set(rgbaData);
		device.queue.writeTexture(
			{ texture: inputTexture },
			rgbaBuffer,
			{ bytesPerRow: width * 4 },
			{ width, height }
		);

		// Write params
		device.queue.writeBuffer(xPassParamsBuffer, 0, new Uint32Array([width, height, 0]));
		device.queue.writeBuffer(yPassParamsBuffer, 0, new Uint32Array([width, height]));

		// Extract params: width, height, max_distance (as u32 bits)
		const extractParamsData = new ArrayBuffer(12);
		new Uint32Array(extractParamsData, 0, 2).set([width, height]);
		new Float32Array(extractParamsData, 8, 1).set([config.maxDistance]);
		device.queue.writeBuffer(extractParamsBuffer, 0, extractParamsData);

		// Background params: width, height, sample_distance
		const bgParamsData = new ArrayBuffer(12);
		new Uint32Array(bgParamsData, 0, 2).set([width, height]);
		new Float32Array(bgParamsData, 8, 1).set([config.sampleDistance]);
		device.queue.writeBuffer(backgroundParamsBuffer, 0, bgParamsData);

		device.queue.writeBuffer(contrastParamsBuffer, 0, new Float32Array([config.targetContrast]));
		device.queue.writeBuffer(colorAdjustParamsBuffer, 0, new Float32Array([0.3])); // Edge boost strength

		// Create bind groups
		const xPassBindGroup = device.createBindGroup({
			label: 'x-pass-bind-group',
			layout: esdtXPassPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: grayscaleBuffer } },
				{ binding: 1, resource: { buffer: distancesBuffer } },
				{ binding: 2, resource: { buffer: xPassParamsBuffer } },
				{ binding: 3, resource: { buffer: gradientXBuffer } },
				{ binding: 4, resource: { buffer: gradientYBuffer } }
			]
		});

		const yPassBindGroup = device.createBindGroup({
			label: 'y-pass-bind-group',
			layout: esdtYPassPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: distancesBuffer } },
				{ binding: 1, resource: { buffer: yPassParamsBuffer } }
			]
		});

		const extractBindGroup = device.createBindGroup({
			label: 'extract-bind-group',
			layout: extractPixelsPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: distancesBuffer } },
				{ binding: 1, resource: { buffer: glyphPixelsBuffer } },
				{ binding: 2, resource: { buffer: pixelCountBuffer } },
				{ binding: 3, resource: { buffer: extractParamsBuffer } }
			]
		});

		const backgroundBindGroup = device.createBindGroup({
			label: 'background-bind-group',
			layout: backgroundSamplePipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: inputTexture.createView() },
				{ binding: 1, resource: { buffer: glyphPixelsBuffer } },
				{ binding: 2, resource: { buffer: backgroundSamplesBuffer } },
				{ binding: 3, resource: { buffer: backgroundParamsBuffer } },
				{ binding: 4, resource: { buffer: pixelCountBuffer } }
			]
		});

		const contrastBindGroup = device.createBindGroup({
			label: 'contrast-bind-group',
			layout: contrastAnalysisPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: inputTexture.createView() },
				{ binding: 1, resource: { buffer: glyphPixelsBuffer } },
				{ binding: 2, resource: { buffer: backgroundSamplesBuffer } },
				{ binding: 3, resource: { buffer: contrastAnalysesBuffer } },
				{ binding: 4, resource: { buffer: contrastParamsBuffer } },
				{ binding: 5, resource: { buffer: pixelCountBuffer } }
			]
		});

		const colorAdjustBindGroup = device.createBindGroup({
			label: 'color-adjust-bind-group',
			layout: colorAdjustPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: inputTexture.createView() },
				{ binding: 1, resource: outputTexture.createView() },
				{ binding: 2, resource: { buffer: glyphPixelsBuffer } },
				{ binding: 3, resource: { buffer: contrastAnalysesBuffer } },
				{ binding: 4, resource: { buffer: colorAdjustParamsBuffer } },
				{ binding: 5, resource: { buffer: pixelCountBuffer } }
			]
		});

		// Execute compute passes
		const commandEncoder = device.createCommandEncoder();

		// Pass 1: X-pass
		const xPassEncoder = commandEncoder.beginComputePass({ label: 'x-pass' });
		xPassEncoder.setPipeline(esdtXPassPipeline);
		xPassEncoder.setBindGroup(0, xPassBindGroup);
		xPassEncoder.dispatchWorkgroups(Math.ceil(height / 256));
		xPassEncoder.end();

		// Pass 2: Y-pass
		const yPassEncoder = commandEncoder.beginComputePass({ label: 'y-pass' });
		yPassEncoder.setPipeline(esdtYPassPipeline);
		yPassEncoder.setBindGroup(0, yPassBindGroup);
		yPassEncoder.dispatchWorkgroups(Math.ceil(width / 256));
		yPassEncoder.end();

		// Pass 3: Extract pixels
		const extractEncoder = commandEncoder.beginComputePass({ label: 'extract-pixels' });
		extractEncoder.setPipeline(extractPixelsPipeline);
		extractEncoder.setBindGroup(0, extractBindGroup);
		extractEncoder.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
		extractEncoder.end();

		// Copy pixel count for readback (we need it to dispatch subsequent passes)
		commandEncoder.copyBufferToBuffer(pixelCountBuffer, 0, pixelCountReadbackBuffer, 0, 4);

		// Submit and wait to get pixel count
		device.queue.submit([commandEncoder.finish()]);
		await pixelCountReadbackBuffer.mapAsync(GPUMapMode.READ);
		const glyphPixelCount = new Uint32Array(pixelCountReadbackBuffer.getMappedRange())[0];
		pixelCountReadbackBuffer.unmap();

		// Debug: log pipeline progress
		console.log(`[GPU Pipeline] Glyph pixels detected: ${glyphPixelCount} / ${pixelCount} (${(100 * glyphPixelCount / pixelCount).toFixed(1)}%)`);
		console.log(`[GPU Pipeline] Image: ${width}x${height}, alignedBytesPerRow: ${alignedBytesPerRow}`);

		// Debug: sample input pixels for comparison
		const inputSamples = [];
		for (let i = 0; i < Math.min(5, height); i++) {
			const offset = i * width * 4;
			inputSamples.push(`[${rgbaData[offset]},${rgbaData[offset+1]},${rgbaData[offset+2]},${rgbaData[offset+3]}]`);
		}
		console.log(`[GPU Pipeline] Sample INPUT pixels (first 5 rows): ${inputSamples.join(' ')}`);

		// Continue with passes 4-6 if there are glyph pixels
		let adjustedCount = 0;
		if (glyphPixelCount > 0) {
			// Clear output texture to transparent (0,0,0,0) before color adjustment
			// This ensures non-adjusted pixels have alpha=0 for proper overlay blending
			const clearBuffer = new ArrayBuffer(pixelCount * 4);
			device.queue.writeTexture(
				{ texture: outputTexture },
				clearBuffer,
				{ bytesPerRow: width * 4 },
				{ width, height }
			);

			const commandEncoder2 = device.createCommandEncoder();

			// Pass 4: Background sampling
			const bgEncoder = commandEncoder2.beginComputePass({ label: 'background-sample' });
			bgEncoder.setPipeline(backgroundSamplePipeline);
			bgEncoder.setBindGroup(0, backgroundBindGroup);
			bgEncoder.dispatchWorkgroups(Math.ceil(glyphPixelCount / 256));
			bgEncoder.end();

			// Pass 5: Contrast analysis
			const contrastEncoder = commandEncoder2.beginComputePass({ label: 'contrast-analysis' });
			contrastEncoder.setPipeline(contrastAnalysisPipeline);
			contrastEncoder.setBindGroup(0, contrastBindGroup);
			contrastEncoder.dispatchWorkgroups(Math.ceil(glyphPixelCount / 256));
			contrastEncoder.end();

			// Pass 6: Color adjustment
			const colorEncoder = commandEncoder2.beginComputePass({ label: 'color-adjust' });
			colorEncoder.setPipeline(colorAdjustPipeline);
			colorEncoder.setBindGroup(0, colorAdjustBindGroup);
			colorEncoder.dispatchWorkgroups(Math.ceil(glyphPixelCount / 256));
			colorEncoder.end();

			// Copy output texture to readback buffer (using aligned bytesPerRow)
			commandEncoder2.copyTextureToBuffer(
				{ texture: outputTexture },
				{ buffer: outputReadbackBuffer, bytesPerRow: alignedBytesPerRow },
				{ width, height }
			);

			device.queue.submit([commandEncoder2.finish()]);
			adjustedCount = glyphPixelCount;
		}

		// Read back adjusted pixels and strip row padding
		await outputReadbackBuffer.mapAsync(GPUMapMode.READ);
		const paddedData = new Uint8Array(outputReadbackBuffer.getMappedRange());

		// Debug: sample some output pixels
		if (paddedData.length >= 40) {
			const samples = [];
			for (let i = 0; i < 10; i++) {
				const offset = i * alignedBytesPerRow; // First pixel of each row
				samples.push(`[${paddedData[offset]},${paddedData[offset+1]},${paddedData[offset+2]},${paddedData[offset+3]}]`);
			}
			console.log(`[GPU Pipeline] Sample output pixels (first 10 rows): ${samples.join(' ')}`);
		}

		// Strip padding from each row (alignedBytesPerRow -> unalignedBytesPerRow)
		const adjustedPixels = new Uint8ClampedArray(pixelCount * 4);
		if (alignedBytesPerRow === unalignedBytesPerRow) {
			// No padding, direct copy
			adjustedPixels.set(paddedData.subarray(0, pixelCount * 4));
		} else {
			// Strip padding from each row
			for (let y = 0; y < height; y++) {
				const srcOffset = y * alignedBytesPerRow;
				const dstOffset = y * unalignedBytesPerRow;
				adjustedPixels.set(
					paddedData.subarray(srcOffset, srcOffset + unalignedBytesPerRow),
					dstOffset
				);
			}
		}
		outputReadbackBuffer.unmap();

		// If no adjustments were made, copy original data
		if (adjustedCount === 0) {
			adjustedPixels.set(rgbaData);
		}

		// Cleanup
		grayscaleBuffer.destroy();
		gradientXBuffer.destroy();
		gradientYBuffer.destroy();
		distancesBuffer.destroy();
		glyphPixelsBuffer.destroy();
		pixelCountBuffer.destroy();
		backgroundSamplesBuffer.destroy();
		contrastAnalysesBuffer.destroy();
		xPassParamsBuffer.destroy();
		yPassParamsBuffer.destroy();
		extractParamsBuffer.destroy();
		backgroundParamsBuffer.destroy();
		contrastParamsBuffer.destroy();
		colorAdjustParamsBuffer.destroy();
		pixelCountReadbackBuffer.destroy();
		outputReadbackBuffer.destroy();
		inputTexture.destroy();
		outputTexture.destroy();

		const processingTime = performance.now() - startTime;

		return {
			adjustedPixels,
			adjustedCount,
			processingTime,
			backend: 'webgpu'
		};
	}

	/**
	 * Run the full contrast enhancement pipeline
	 *
	 * Uses WebGPU if available, falls back to CPU processing
	 */
	async function runFullPipeline(
		rgbaData: Uint8ClampedArray,
		width: number,
		height: number,
		config: Partial<ComputeConfig> = {}
	): Promise<PipelineResult> {
		const fullConfig = { ...DEFAULT_CONFIG, ...config };

		// Try WebGPU full pipeline
		if (webgpuContext && activeBackend === 'webgpu') {
			try {
				return await runFullPipelineWebGPU(rgbaData, width, height, fullConfig);
			} catch (err) {
				console.warn('[ComputeDispatcher] WebGPU pipeline failed, falling back:', err);
			}
		}

		// Fall back to CPU processing (existing implementation via composable)
		// This returns the original data unchanged - the composable handles CPU fallback
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
	 * Takes a video element and produces grayscale + gradient buffers
	 * for subsequent ESDT processing.
	 *
	 * @param video - HTMLVideoElement with active video stream
	 * @returns VideoCaptureResult with GPU buffers, or null if not available
	 */
	async function processVideoFrame(video: HTMLVideoElement): Promise<VideoCaptureResult | null> {
		if (!webgpuContext || !videoCaptureContext) {
			return null;
		}

		const startTime = performance.now();
		const { device } = webgpuContext;
		const { videoCaptureEsdtPipeline, videoCaptureLayout, hasExternalTexture, sampler } = videoCaptureContext;

		const width = video.videoWidth;
		const height = video.videoHeight;

		if (width === 0 || height === 0) {
			return null;
		}

		const pixelCount = width * height;

		// Create output buffers
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

		// Create params buffer
		const paramsBuffer = device.createBuffer({
			label: 'video-capture-params',
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		const params = new ArrayBuffer(16);
		new Uint32Array(params, 0, 2).set([width, height]);
		new Float32Array(params, 8, 1).set([window.devicePixelRatio || 1]);
		device.queue.writeBuffer(paramsBuffer, 0, params);

		// Create bind group based on texture type
		let bindGroup: GPUBindGroup;

		if (hasExternalTexture) {
			// Zero-copy external texture
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
			// Fallback: copy to regular texture
			const fallbackTexture = device.createTexture({
				label: 'video-fallback-texture',
				size: [width, height],
				format: 'rgba8unorm',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
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

		// Execute compute pass
		const encoder = device.createCommandEncoder({ label: 'video-capture-encoder' });
		const pass = encoder.beginComputePass({ label: 'video-capture-pass' });
		pass.setPipeline(videoCaptureEsdtPipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
		pass.end();

		device.queue.submit([encoder.finish()]);
		await device.queue.onSubmittedWorkDone();

		// Clean up params buffer
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
	 * 1. WebGPU (if initialized and active)
	 * 2. Futhark WASM (if initialized)
	 * 3. JS fallback
	 */
	async function computeEsdt(
		levels: Float32Array,
		width: number,
		height: number,
		config: Partial<ComputeConfig> = {}
	): Promise<EsdtResult> {
		const { useRelaxation = DEFAULT_CONFIG.useRelaxation } = config;

		// Try WebGPU first
		if (webgpuContext && activeBackend === 'webgpu') {
			try {
				return await computeEsdtWebGPU(levels, width, height, useRelaxation);
			} catch (err) {
				console.warn('[ComputeDispatcher] WebGPU computation failed, falling back:', err);
				// Fall through to Futhark
			}
		}

		// Try Futhark WASM
		if (futharkContext) {
			return computeEsdtFuthark(levels, width, height, useRelaxation);
		}

		// JS fallback
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
		if (webgpuContext) {
			webgpuContext.device.destroy();
			webgpuContext = null;
		}
		videoCaptureContext = null;
		futharkContext = null;
		isInitialized = false;
		initializationError = null;
		activeBackend = 'auto';
	}

	/**
	 * Force switch to a different backend (for testing/debugging)
	 */
	function switchBackend(backend: ComputeBackend): boolean {
		if (backend === 'webgpu' && webgpuContext) {
			activeBackend = 'webgpu';
			return true;
		}
		if (backend === 'futhark-wasm' && futharkContext) {
			activeBackend = 'futhark-wasm';
			return true;
		}
		if (backend === 'auto') {
			// Re-evaluate best backend
			if (webgpuContext) {
				activeBackend = 'webgpu';
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
			return webgpuContext !== null;
		},
		get hasFuthark() {
			return futharkContext !== null;
		},
		get error() {
			return initializationError;
		}
	};
}

export type ComputeDispatcher = ReturnType<typeof createComputeDispatcher>;
