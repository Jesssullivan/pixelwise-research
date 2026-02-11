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
import type { FutharkWebGPUContext } from '$lib/futhark-webgpu';

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
	/** Raw Uint8Array from Futhark WebGPU (avoids Uint8ClampedArray copy for WebGPU overlay) */
	_rawBuffer?: Uint8Array;
}

/**
 * Detailed metrics from a single pipeline execution.
 *
 * Since the Futhark pipeline runs all 6 passes as a single opaque
 * GPU dispatch, per-pass timing is not available. Instead we measure
 * end-to-end pipeline time, data-transfer overhead, and pixel-level
 * statistics observable from the JS side.
 */
export interface PipelineMetrics {
	/** Core pipeline execution time in ms (Futhark call + GPU sync) */
	pipelineTimeMs: number;
	/** Data marshalling overhead in ms (TypedArray copies, pixel counting) */
	overheadTimeMs: number;
	/** Total wall-clock time in ms (pipeline + overhead) */
	totalTimeMs: number;
	/** Backend that executed this frame */
	backend: 'futhark-webgpu' | 'futhark-wasm' | 'js-fallback';
	/** Frame width in pixels */
	width: number;
	/** Frame height in pixels */
	height: number;
	/** Total pixel count (width * height) */
	totalPixels: number;
	/** Number of pixels adjusted by the pipeline */
	adjustedPixels: number;
	/** Megapixels processed per second */
	mpixPerSec: number;
	/** Timestamp of this measurement (performance.now()) */
	timestamp: number;
}

/** Maximum number of metrics entries retained in history */
const METRICS_HISTORY_SIZE = 120;

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
 * WebGPU context for video capture pipeline (uses hand-written shaders
 * since Futhark WebGPU doesn't support external textures yet).
 *
 * The shaders only extract RGBA from the video texture; all further
 * processing (grayscale, Sobel, ESDT, WCAG) goes through runFullPipeline().
 */
interface VideoCaptureContext {
	device: GPUDevice;
	adapter: GPUAdapter;
	videoCapturePipeline: GPUComputePipeline;
	videoCaptureLayout: GPUBindGroupLayout;
	hasExternalTexture: boolean;
	sampler: GPUSampler;
}

/**
 * Result of processing a video frame.
 *
 * Now returns a PipelineResult (same as runFullPipeline) since the
 * video capture shader only extracts RGBA and delegates all further
 * processing to the unified Futhark pipeline.
 */
export type VideoCaptureResult = PipelineResult;

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

	/** Ring buffer of recent pipeline metrics */
	const metricsHistory: PipelineMetrics[] = [];

	/** Record a metrics entry, evicting oldest when full */
	function recordMetrics(m: PipelineMetrics) {
		metricsHistory.push(m);
		if (metricsHistory.length > METRICS_HISTORY_SIZE) {
			metricsHistory.shift();
		}
	}

	/**
	 * Initialize the video capture pipeline (still uses hand-written WGSL
	 * since it needs GPUExternalTexture support not available in Futhark)
	 */
	async function initializeVideoCapture(device: GPUDevice): Promise<VideoCaptureContext | null> {
		const hasExternalTexture = detectImportExternalTexture();
		const shaderCode = hasExternalTexture ? videoCaptureEsdtShader : videoCaptureEsdtFallbackShader;

		const shaderModule = device.createShaderModule({
			label: 'video-capture-rgba',
			code: shaderCode
		});

		const info = await shaderModule.getCompilationInfo();
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

		// Simplified layout: sampler, texture, rgba_output, params
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
					buffer: { type: 'uniform' }
				}
			]
		});

		const videoCapturePipeline = device.createComputePipeline({
			label: 'video-capture-rgba-pipeline',
			layout: device.createPipelineLayout({
				bindGroupLayouts: [videoCaptureLayout]
			}),
			compute: {
				module: shaderModule,
				entryPoint: 'main'
			}
		});

		// We need a GPU adapter for the context but it's only needed for video capture
		const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
		if (!adapter) return null;

		return {
			device,
			adapter,
			videoCapturePipeline,
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
			} catch (err: unknown) {
				console.warn('[ComputeDispatcher] Video capture initialization failed (optional):', err);
			}

			return true;
		} catch (err: unknown) {
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
		} catch (err: unknown) {
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

		const totalStart = performance.now();

		try {
			// -- Data marshalling (overhead) --
			const marshalStart = performance.now();
			const inputData = new Uint8Array(rgbaData.buffer, rgbaData.byteOffset, rgbaData.byteLength);
			const marshalTime = performance.now() - marshalStart;

			// -- Core pipeline execution --
			const pipelineStart = performance.now();
			const resultData = await futharkWebGPUContext.enhanceContrastRgba(
				inputData,
				width,
				height,
				config.targetContrast,
				config.maxDistance,
				config.sampleDistance
			);
			await futharkWebGPUContext.sync();
			const pipelineTime = performance.now() - pipelineStart;

			// -- Post-processing (overhead) --
			const postStart = performance.now();

			// Estimate adjusted pixel count by sampling (avoids O(n) comparison loop).
			// Sample every 64th pixel for a ~1.5% sample — sufficient for metrics display.
			const totalPixels = width * height;
			const sampleStride = 64;
			let sampleHits = 0;
			let sampleCount = 0;
			for (let i = 0; i < resultData.length; i += sampleStride * 4) {
				if (
					resultData[i] !== rgbaData[i] ||
					resultData[i + 1] !== rgbaData[i + 1] ||
					resultData[i + 2] !== rgbaData[i + 2]
				) {
					sampleHits++;
				}
				sampleCount++;
			}
			const adjustedCount = sampleCount > 0
				? Math.round((sampleHits / sampleCount) * totalPixels)
				: 0;

			const postTime = performance.now() - postStart;

			const totalTime = performance.now() - totalStart;
			const overheadTime = marshalTime + postTime;

			// Record metrics
			recordMetrics({
				pipelineTimeMs: pipelineTime,
				overheadTimeMs: overheadTime,
				totalTimeMs: totalTime,
				backend: 'futhark-webgpu',
				width,
				height,
				totalPixels,
				adjustedPixels: adjustedCount,
				mpixPerSec: totalTime > 0 ? (totalPixels / totalTime) * 1000 / 1e6 : 0,
				timestamp: performance.now()
			});

			// Return Uint8Array directly — callers using WebGPUOverlayCompositor
			// can pass this to updateTextureFromBuffer() without copying.
			// For WebGL2 fallback, the Uint8ClampedArray view is created lazily.
			return {
				adjustedPixels: new Uint8ClampedArray(resultData.buffer, resultData.byteOffset, resultData.byteLength),
				adjustedCount,
				processingTime: totalTime,
				backend: 'futhark-webgpu',
				_rawBuffer: resultData
			} as PipelineResult;
		} catch (err: unknown) {
			console.error('[ComputeDispatcher] Futhark WebGPU pipeline failed:', err);
			throw err;
		}
	}

	/**
	 * sRGB to linear conversion per WCAG 2.1 spec
	 */
	function sRGBtoLinear(c: number): number {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	}

	/**
	 * WCAG relative luminance from 8-bit RGB
	 */
	function relativeLuminance(r: number, g: number, b: number): number {
		return 0.2126 * sRGBtoLinear(r) + 0.7152 * sRGBtoLinear(g) + 0.0722 * sRGBtoLinear(b);
	}

	/**
	 * WCAG contrast ratio between two luminances
	 */
	function contrastRatio(l1: number, l2: number): number {
		const lighter = Math.max(l1, l2);
		const darker = Math.min(l1, l2);
		return (lighter + 0.05) / (darker + 0.05);
	}

	/**
	 * Run the contrast enhancement pipeline on CPU using ESDT results.
	 *
	 * Replicates the 6-pass Futhark pipeline:
	 * 1. Grayscale + ESDT (via computeEsdt, which uses Futhark WASM or JS fallback)
	 * 2. Glyph extraction (distance < maxDistance)
	 * 3. Background sampling (along gradient direction)
	 * 4. WCAG contrast check + color adjustment
	 */
	async function runFullPipelineCPU(
		rgbaData: Uint8ClampedArray,
		width: number,
		height: number,
		config: ComputeConfig
	): Promise<PipelineResult> {
		const startTime = performance.now();
		const pixelCount = width * height;

		// Pass 1: Convert RGBA to grayscale luminance levels
		const levels = new Float32Array(pixelCount);
		for (let i = 0; i < pixelCount; i++) {
			const idx = i * 4;
			const r = rgbaData[idx] / 255;
			const g = rgbaData[idx + 1] / 255;
			const b = rgbaData[idx + 2] / 255;
			levels[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		}

		// Pass 2-3: ESDT (uses Futhark WASM if available, else JS fallback)
		const esdt = await computeEsdt(levels, width, height, config);

		// Pass 4: Extract glyph mask and compute adjustments
		const adjustedPixels = new Uint8ClampedArray(rgbaData);
		let adjustedCount = 0;

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const i = y * width + x;
				const esdtIdx = i * 2;
				const dx = esdt.data[esdtIdx];
				const dy = esdt.data[esdtIdx + 1];
				const d = Math.sqrt(dx * dx + dy * dy);

				// Glyph extraction: distance must be within threshold
				const coverage = Math.max(0, Math.min(1, 1 - d / config.maxDistance));
				if (d >= config.maxDistance || coverage <= 0.02) continue;

				// Check gradient magnitude
				const gradLen = d > 0.001 ? 1.0 : 0.0;
				if (gradLen < 0.1) continue; // Solid interior pixel, skip

				// Normalize gradient direction
				const gx = dx / d;
				const gy = dy / d;

				// Pass 5: Sample background along gradient direction
				const sx = Math.max(0, Math.min(width - 1, Math.round(x + gx * config.sampleDistance)));
				const sy = Math.max(0, Math.min(height - 1, Math.round(y + gy * config.sampleDistance)));
				const bgIdx = (sy * width + sx) * 4;
				const bgR = rgbaData[bgIdx];
				const bgG = rgbaData[bgIdx + 1];
				const bgB = rgbaData[bgIdx + 2];

				// Pass 6: WCAG contrast check
				const pixIdx = i * 4;
				const textR = rgbaData[pixIdx];
				const textG = rgbaData[pixIdx + 1];
				const textB = rgbaData[pixIdx + 2];

				const textLum = relativeLuminance(textR, textG, textB);
				const bgLum = relativeLuminance(bgR, bgG, bgB);
				const cr = contrastRatio(textLum, bgLum);

				if (cr >= config.targetContrast) continue; // Already compliant

				// Adjust text color to meet target contrast
				const textIsLighter = textLum > bgLum;
				let targetLum: number;
				if (textIsLighter) {
					targetLum = Math.max(0, Math.min(1, config.targetContrast * (bgLum + 0.05) - 0.05));
				} else {
					targetLum = Math.max(0, Math.min(1, (bgLum + 0.05) / config.targetContrast - 0.05));
				}

				const currentLum = relativeLuminance(textR, textG, textB);
				let newR: number, newG: number, newB: number;
				if (currentLum < 0.001) {
					// Near-black: make gray with target luminance
					const gray = Math.sqrt(targetLum / 0.2126) * 255;
					newR = newG = newB = Math.max(0, Math.min(255, Math.round(gray)));
				} else {
					const ratio = targetLum / currentLum;
					newR = Math.max(0, Math.min(255, Math.round(textR * ratio)));
					newG = Math.max(0, Math.min(255, Math.round(textG * ratio)));
					newB = Math.max(0, Math.min(255, Math.round(textB * ratio)));
				}

				adjustedPixels[pixIdx] = newR;
				adjustedPixels[pixIdx + 1] = newG;
				adjustedPixels[pixIdx + 2] = newB;
				// Alpha preserved from original
				adjustedCount++;
			}
		}

		const processingTime = performance.now() - startTime;
		const backend: PipelineResult['backend'] = futharkContext ? 'futhark-wasm' : 'js-fallback';
		const totalPixels = width * height;

		// Record metrics (CPU path has no separate marshal overhead)
		recordMetrics({
			pipelineTimeMs: processingTime,
			overheadTimeMs: 0,
			totalTimeMs: processingTime,
			backend,
			width,
			height,
			totalPixels,
			adjustedPixels: adjustedCount,
			mpixPerSec: processingTime > 0 ? (totalPixels / processingTime) * 1000 / 1e6 : 0,
			timestamp: performance.now()
		});

		return {
			adjustedPixels,
			adjustedCount,
			processingTime,
			backend
		};
	}

	/**
	 * Run the full contrast enhancement pipeline
	 *
	 * Backend selection:
	 * 1. Futhark WebGPU (GPU, unified Futhark-generated shaders)
	 * 2. Futhark WASM (multicore CPU, ESDT via WASM + contrast adjustment in JS)
	 * 3. Pure JS fallback (single-threaded ESDT + contrast adjustment)
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
			} catch (err: unknown) {
				console.warn('[ComputeDispatcher] Futhark WebGPU pipeline failed, falling back:', err);
			}
		}

		// Fall back to CPU processing (Futhark WASM for ESDT, or pure JS)
		try {
			return await runFullPipelineCPU(rgbaData, width, height, fullConfig);
		} catch (err: unknown) {
			console.error('[ComputeDispatcher] CPU pipeline failed:', err);
			// Last resort: return original data unmodified
			recordMetrics({
				pipelineTimeMs: 0,
				overheadTimeMs: 0,
				totalTimeMs: 0,
				backend: 'js-fallback',
				width,
				height,
				totalPixels: width * height,
				adjustedPixels: 0,
				mpixPerSec: 0,
				timestamp: performance.now()
			});
			return {
				adjustedPixels: new Uint8ClampedArray(rgbaData),
				adjustedCount: 0,
				processingTime: 0,
				backend: 'js-fallback'
			};
		}
	}

	/**
	 * Process a video frame through the full contrast enhancement pipeline.
	 *
	 * Steps:
	 * 1. Run minimal WGSL shader to extract RGBA from video texture
	 * 2. Read RGBA data back from GPU
	 * 3. Feed through runFullPipeline() (Futhark WebGPU -> WASM -> JS)
	 *
	 * Uses hand-written WGSL only for video texture import (GPUExternalTexture
	 * is not supported by Futhark). All grayscale, Sobel, ESDT, and WCAG
	 * processing is delegated to the unified Futhark pipeline.
	 */
	async function processVideoFrame(
		video: HTMLVideoElement,
		config: Partial<ComputeConfig> = {}
	): Promise<VideoCaptureResult | null> {
		if (!videoCaptureContext) {
			return null;
		}

		const { device, videoCapturePipeline, videoCaptureLayout, hasExternalTexture, sampler } =
			videoCaptureContext;

		const width = video.videoWidth;
		const height = video.videoHeight;

		if (width === 0 || height === 0) {
			return null;
		}

		const pixelCount = width * height;

		// Single RGBA output buffer (u32 per pixel)
		const rgbaBuffer = device.createBuffer({
			label: 'video-rgba-output',
			size: pixelCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
		});

		// Params buffer: just width and height (8 bytes, padded to 8 for alignment)
		const paramsBuffer = device.createBuffer({
			label: 'video-capture-params',
			size: 8,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		const paramsData = new Uint32Array([width, height]);
		device.queue.writeBuffer(paramsBuffer, 0, paramsData);

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
					{ binding: 2, resource: { buffer: rgbaBuffer } },
					{ binding: 3, resource: { buffer: paramsBuffer } }
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
					{ binding: 2, resource: { buffer: rgbaBuffer } },
					{ binding: 3, resource: { buffer: paramsBuffer } }
				]
			});
		}

		// Step 1: Run minimal texture-to-RGBA shader
		const encoder = device.createCommandEncoder({ label: 'video-capture-encoder' });
		const pass = encoder.beginComputePass({ label: 'video-capture-pass' });
		pass.setPipeline(videoCapturePipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
		pass.end();

		// Copy RGBA data to a readable staging buffer
		const stagingBuffer = device.createBuffer({
			label: 'video-rgba-staging',
			size: pixelCount * 4,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
		});
		encoder.copyBufferToBuffer(rgbaBuffer, 0, stagingBuffer, 0, pixelCount * 4);

		device.queue.submit([encoder.finish()]);
		await device.queue.onSubmittedWorkDone();

		// Step 2: Read back RGBA data
		await stagingBuffer.mapAsync(GPUMapMode.READ);
		const rgbaU32 = new Uint32Array(stagingBuffer.getMappedRange().slice(0));
		stagingBuffer.unmap();

		// Convert packed u32 to Uint8ClampedArray (RGBA byte order)
		const rgbaData = new Uint8ClampedArray(pixelCount * 4);
		for (let i = 0; i < pixelCount; i++) {
			const packed = rgbaU32[i];
			rgbaData[i * 4] = packed & 0xff; // R
			rgbaData[i * 4 + 1] = (packed >> 8) & 0xff; // G
			rgbaData[i * 4 + 2] = (packed >> 16) & 0xff; // B
			rgbaData[i * 4 + 3] = (packed >> 24) & 0xff; // A
		}

		// Cleanup GPU resources
		rgbaBuffer.destroy();
		paramsBuffer.destroy();
		stagingBuffer.destroy();

		// Step 3: Feed through unified Futhark pipeline
		return runFullPipeline(rgbaData, width, height, config);
	}

	/**
	 * Check if video capture is available
	 */
	function hasVideoCapture(): boolean {
		return videoCaptureContext !== null;
	}

	/**
	 * Compute ESDT from RGBA pixel data using Futhark WebGPU
	 *
	 * Uses the debug_esdt_flat entry point which handles grayscale
	 * conversion on the GPU, so it takes raw RGBA data.
	 */
	async function computeEsdtWebGPU(
		rgbaData: Uint8ClampedArray,
		width: number,
		height: number,
		maxDistance: number
	): Promise<EsdtResult> {
		if (!futharkWebGPUContext) {
			throw new Error('Futhark WebGPU context not initialized');
		}

		const inputData = new Uint8Array(rgbaData);
		const data = await futharkWebGPUContext.debugEsdtFlat(
			inputData,
			width,
			height,
			maxDistance
		);
		await futharkWebGPUContext.sync();

		return { data, width, height };
	}

	/**
	 * Compute ESDT from grayscale levels
	 *
	 * Backend selection order:
	 * 1. Futhark WebGPU (if initialized and rgbaData provided)
	 * 2. Futhark WASM (if initialized)
	 * 3. JS fallback
	 *
	 * @param levels - Grayscale float levels (used by WASM and JS backends)
	 * @param width - Image width
	 * @param height - Image height
	 * @param config - Compute configuration
	 * @param rgbaData - Optional raw RGBA pixel data (enables WebGPU path)
	 */
	async function computeEsdt(
		levels: Float32Array,
		width: number,
		height: number,
		config: Partial<ComputeConfig> = {},
		rgbaData?: Uint8ClampedArray
	): Promise<EsdtResult> {
		const { useRelaxation = DEFAULT_CONFIG.useRelaxation } = config;
		const { maxDistance = DEFAULT_CONFIG.maxDistance } = config;

		// Try Futhark WebGPU first (requires RGBA data)
		if (futharkWebGPUContext && rgbaData) {
			try {
				return await computeEsdtWebGPU(rgbaData, width, height, maxDistance);
			} catch (err: unknown) {
				console.warn('[ComputeDispatcher] WebGPU ESDT failed, falling back:', err);
			}
		}

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

	/**
	 * Render ESDT distances as a heatmap overlay (Futhark WebGPU only).
	 */
	async function debugDistanceHeatmap(
		rgbaData: Uint8ClampedArray,
		width: number,
		height: number,
		maxDistance: number
	): Promise<Uint8Array> {
		if (!futharkWebGPUContext) {
			throw new Error('Futhark WebGPU context not initialized');
		}
		const inputData = new Uint8Array(rgbaData.buffer, rgbaData.byteOffset, rgbaData.byteLength);
		const result = await futharkWebGPUContext.debugDistanceHeatmap(inputData, width, height, maxDistance);
		await futharkWebGPUContext.sync();
		return result;
	}

	/**
	 * Render binary glyph mask overlay (Futhark WebGPU only).
	 */
	async function debugGlyphMask(
		rgbaData: Uint8ClampedArray,
		width: number,
		height: number,
		maxDistance: number
	): Promise<Uint8Array> {
		if (!futharkWebGPUContext) {
			throw new Error('Futhark WebGPU context not initialized');
		}
		const inputData = new Uint8Array(rgbaData.buffer, rgbaData.byteOffset, rgbaData.byteLength);
		const result = await futharkWebGPUContext.debugGlyphMask(inputData, width, height, maxDistance);
		await futharkWebGPUContext.sync();
		return result;
	}

	/**
	 * Render WCAG compliance overlay (Futhark WebGPU only).
	 */
	async function debugWcagCompliance(
		rgbaData: Uint8ClampedArray,
		width: number,
		height: number,
		targetContrast: number,
		maxDistance: number,
		sampleDistance: number
	): Promise<Uint8Array> {
		if (!futharkWebGPUContext) {
			throw new Error('Futhark WebGPU context not initialized');
		}
		const inputData = new Uint8Array(rgbaData.buffer, rgbaData.byteOffset, rgbaData.byteLength);
		const result = await futharkWebGPUContext.debugWcagCompliance(
			inputData, width, height, targetContrast, maxDistance, sampleDistance
		);
		await futharkWebGPUContext.sync();
		return result;
	}

	/**
	 * Return the most recent pipeline metrics entry, or null if none recorded.
	 */
	function getLatestMetrics(): PipelineMetrics | null {
		return metricsHistory.length > 0 ? metricsHistory[metricsHistory.length - 1] : null;
	}

	/**
	 * Return a shallow copy of the full metrics history (oldest-first).
	 */
	function getMetricsHistory(): readonly PipelineMetrics[] {
		return [...metricsHistory];
	}

	/**
	 * Clear all recorded metrics.
	 */
	function clearMetrics() {
		metricsHistory.length = 0;
	}

	/**
	 * Get the shared GPUDevice (from video capture context) for use by
	 * other WebGPU consumers like the WebGPU overlay compositor.
	 */
	function getDevice(): GPUDevice | null {
		return videoCaptureContext?.device ?? null;
	}

	return {
		initialize,
		computeEsdt,
		runFullPipeline,
		processVideoFrame,
		hasVideoCapture,
		getDevice,
		getDistance,
		getGradient,
		debugDistanceHeatmap,
		debugGlyphMask,
		debugWcagCompliance,
		destroy,
		switchBackend,
		getLatestMetrics,
		getMetricsHistory,
		clearMetrics,
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
