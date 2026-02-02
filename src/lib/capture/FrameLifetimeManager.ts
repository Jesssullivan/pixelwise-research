/**
 * FrameLifetimeManager - Manages external texture lifecycle for WebGPU
 *
 * External textures (GPUExternalTexture) have single-frame validity:
 * they expire immediately after command buffer submission. This manager
 * coordinates the import-process-submit cycle to ensure textures remain
 * valid during pipeline execution.
 *
 * Pipeline execution order (all within single command buffer):
 * 1. Import external texture from video
 * 2. Create bind group with external texture
 * 3. Encode all compute passes
 * 4. Submit command buffer (texture expires after this)
 *
 * @module capture/FrameLifetimeManager
 */

import { type VideoFrameImport, WebGPUVideoCapture } from './WebGPUVideoCapture';
import type { GlyphPixelBufferV2 } from '$lib/pixelwise/GlyphPixelBuffer';
import type { ExtendedGlyphData } from '$lib/pixelwise/GlyphExtractor';

/**
 * Pipeline stage for frame processing
 */
export type PipelineStage =
	| 'idle'
	| 'importing'
	| 'processing'
	| 'submitting'
	| 'complete'
	| 'error';

/**
 * Result of processing a single frame
 */
export interface FrameProcessingResult {
	/** Whether processing succeeded */
	success: boolean;
	/** Processing time in milliseconds */
	processingTime: number;
	/** Number of glyph pixels processed */
	glyphPixelCount: number;
	/** Output texture (if pipeline produces one) */
	outputTexture: GPUTexture | null;
	/** Error message if failed */
	error: string | null;
}

/**
 * Configuration for the frame lifetime manager
 */
export interface FrameLifetimeConfig {
	/** Maximum pixels to process per frame */
	maxGlyphPixels: number;
	/** Target contrast ratio for WCAG enhancement */
	targetContrast: number;
	/** ESDT max distance for edge detection */
	maxDistance: number;
	/** Sample distance for background color */
	sampleDistance: number;
}

/**
 * Default configuration
 */
export const DEFAULT_FRAME_CONFIG: FrameLifetimeConfig = {
	maxGlyphPixels: 100000,
	targetContrast: 7.0, // WCAG AAA
	maxDistance: 3.0,
	sampleDistance: 5.0
};

/**
 * FrameLifetimeManager - Coordinates external texture lifecycle
 *
 * @example
 * ```typescript
 * const manager = new FrameLifetimeManager(device, videoCapture);
 *
 * // Initialize pipelines
 * await manager.initializePipelines();
 *
 * // Process a frame (all passes in single command buffer)
 * const result = await manager.processFrame(videoElement, glyphData);
 *
 * if (result.success) {
 *   // Use result.outputTexture or read from glyphData
 * }
 * ```
 */
export class FrameLifetimeManager {
	private readonly device: GPUDevice;
	private readonly videoCapture: WebGPUVideoCapture;
	private config: FrameLifetimeConfig;
	private _stage: PipelineStage = 'idle';

	// Pipeline resources (lazily initialized)
	private grayscaleGradientPipeline: GPUComputePipeline | null = null;
	private esdtXPassPipeline: GPUComputePipeline | null = null;
	private esdtYPassPipeline: GPUComputePipeline | null = null;
	private extractPixelsPipeline: GPUComputePipeline | null = null;
	private backgroundSamplePipeline: GPUComputePipeline | null = null;
	private contrastAnalysisPipeline: GPUComputePipeline | null = null;
	private colorAdjustPipeline: GPUComputePipeline | null = null;

	// Video-specific pipeline (uses external texture)
	private videoCaptureEsdtPipeline: GPUComputePipeline | null = null;
	private videoCaptureLayout: GPUBindGroupLayout | null = null;

	// Reusable GPU buffers
	private grayscaleBuffer: GPUBuffer | null = null;
	private gradientXBuffer: GPUBuffer | null = null;
	private gradientYBuffer: GPUBuffer | null = null;
	private distancesBuffer: GPUBuffer | null = null;
	private glyphPixelsBuffer: GPUBuffer | null = null;
	private pixelCountBuffer: GPUBuffer | null = null;
	private backgroundSamplesBuffer: GPUBuffer | null = null;
	private contrastAnalysesBuffer: GPUBuffer | null = null;
	private outputTexture: GPUTexture | null = null;

	// Buffer dimensions (for reallocation checks)
	private bufferWidth = 0;
	private bufferHeight = 0;

	constructor(
		device: GPUDevice,
		videoCapture: WebGPUVideoCapture,
		config: Partial<FrameLifetimeConfig> = {}
	) {
		this.device = device;
		this.videoCapture = videoCapture;
		this.config = { ...DEFAULT_FRAME_CONFIG, ...config };
	}

	/** Current pipeline stage */
	get stage(): PipelineStage {
		return this._stage;
	}

	/** Whether pipelines are initialized */
	get isInitialized(): boolean {
		return this.videoCaptureEsdtPipeline !== null;
	}

	/**
	 * Initialize GPU pipelines
	 *
	 * Must be called before processing frames.
	 */
	async initializePipelines(): Promise<void> {
		// Create video capture layout based on capabilities
		this.videoCaptureLayout = this.videoCapture.createBindGroupLayout(
			this.videoCapture.capabilities.importExternalTexture,
			[
				// Additional entries for ESDT output buffers
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
					buffer: { type: 'uniform' }
				}
			]
		);

		// Create video capture ESDT pipeline
		// This shader handles external texture input and outputs grayscale + gradients
		const videoCaptureEsdtModule = this.device.createShaderModule({
			label: 'video-capture-esdt',
			code: this.getVideoCaptureEsdtShader()
		});

		this.videoCaptureEsdtPipeline = this.device.createComputePipeline({
			label: 'video-capture-esdt-pipeline',
			layout: this.device.createPipelineLayout({
				bindGroupLayouts: [this.videoCaptureLayout]
			}),
			compute: {
				module: videoCaptureEsdtModule,
				entryPoint: 'main'
			}
		});

		console.log('[FrameLifetimeManager] Pipelines initialized');
	}

	/**
	 * Process a single video frame through the ESDT pipeline
	 *
	 * All GPU operations are encoded in a single command buffer to ensure
	 * the external texture remains valid throughout processing.
	 *
	 * @param video - Video element to capture from
	 * @param glyphData - Glyph position data (optional, for overlay mode)
	 * @param glyphs - Extended glyph data array (optional)
	 * @returns Processing result
	 */
	async processFrame(
		video: HTMLVideoElement,
		glyphData?: GlyphPixelBufferV2,
		glyphs?: ExtendedGlyphData[]
	): Promise<FrameProcessingResult> {
		if (!this.isInitialized) {
			throw new Error('Pipelines not initialized. Call initializePipelines() first.');
		}

		const startTime = performance.now();
		this._stage = 'importing';

		try {
			const width = video.videoWidth;
			const height = video.videoHeight;

			if (width === 0 || height === 0) {
				return {
					success: false,
					processingTime: 0,
					glyphPixelCount: 0,
					outputTexture: null,
					error: 'Video has zero dimensions'
				};
			}

			// Ensure buffers are allocated
			this.ensureBuffers(width, height);

			// Import video frame
			const frameImport = this.videoCapture.importFrame(video);

			this._stage = 'processing';

			// Create command encoder
			const encoder = this.device.createCommandEncoder({
				label: 'frame-processing-encoder'
			});

			// Upload glyph data if provided
			let glyphPixelCount = 0;
			if (glyphData && glyphs) {
				glyphPixelCount = glyphs.length;
				this.uploadGlyphData(glyphData, glyphs);
			}

			// Encode all passes in single command buffer
			this.encodeVideoCapturePasses(encoder, frameImport, width, height);

			this._stage = 'submitting';

			// Submit (external texture expires after this)
			this.device.queue.submit([encoder.finish()]);

			// Wait for GPU completion
			await this.device.queue.onSubmittedWorkDone();

			this._stage = 'complete';

			const processingTime = performance.now() - startTime;

			return {
				success: true,
				processingTime,
				glyphPixelCount,
				outputTexture: this.outputTexture,
				error: null
			};
		} catch (err) {
			this._stage = 'error';
			const errorMessage = err instanceof Error ? err.message : String(err);
			console.error('[FrameLifetimeManager] Frame processing failed:', errorMessage);

			return {
				success: false,
				processingTime: performance.now() - startTime,
				glyphPixelCount: 0,
				outputTexture: null,
				error: errorMessage
			};
		}
	}

	/**
	 * Ensure GPU buffers are allocated for the given dimensions
	 */
	private ensureBuffers(width: number, height: number): void {
		if (this.bufferWidth === width && this.bufferHeight === height) {
			return; // Buffers already correct size
		}

		// Destroy old buffers
		this.destroyBuffers();

		const pixelCount = width * height;
		const distanceDataSize = 12; // 3 x f32 per pixel

		// Allocate new buffers
		this.grayscaleBuffer = this.device.createBuffer({
			label: 'grayscale',
			size: pixelCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
		});

		this.gradientXBuffer = this.device.createBuffer({
			label: 'gradient-x',
			size: pixelCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
		});

		this.gradientYBuffer = this.device.createBuffer({
			label: 'gradient-y',
			size: pixelCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
		});

		this.distancesBuffer = this.device.createBuffer({
			label: 'distances',
			size: pixelCount * distanceDataSize,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
		});

		this.glyphPixelsBuffer = this.device.createBuffer({
			label: 'glyph-pixels',
			size: this.config.maxGlyphPixels * 24, // GlyphPixel struct size
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
		});

		this.pixelCountBuffer = this.device.createBuffer({
			label: 'pixel-count',
			size: 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
		});

		this.backgroundSamplesBuffer = this.device.createBuffer({
			label: 'background-samples',
			size: this.config.maxGlyphPixels * 16, // 4 x f32 per sample
			usage: GPUBufferUsage.STORAGE
		});

		this.contrastAnalysesBuffer = this.device.createBuffer({
			label: 'contrast-analyses',
			size: this.config.maxGlyphPixels * 16, // 4 x f32 per analysis
			usage: GPUBufferUsage.STORAGE
		});

		this.outputTexture = this.device.createTexture({
			label: 'output-texture',
			size: [width, height],
			format: 'rgba8unorm',
			usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
		});

		this.bufferWidth = width;
		this.bufferHeight = height;

		console.log(`[FrameLifetimeManager] Allocated buffers for ${width}x${height}`);
	}

	/**
	 * Destroy GPU buffers
	 */
	private destroyBuffers(): void {
		this.grayscaleBuffer?.destroy();
		this.gradientXBuffer?.destroy();
		this.gradientYBuffer?.destroy();
		this.distancesBuffer?.destroy();
		this.glyphPixelsBuffer?.destroy();
		this.pixelCountBuffer?.destroy();
		this.backgroundSamplesBuffer?.destroy();
		this.contrastAnalysesBuffer?.destroy();
		this.outputTexture?.destroy();

		this.grayscaleBuffer = null;
		this.gradientXBuffer = null;
		this.gradientYBuffer = null;
		this.distancesBuffer = null;
		this.glyphPixelsBuffer = null;
		this.pixelCountBuffer = null;
		this.backgroundSamplesBuffer = null;
		this.contrastAnalysesBuffer = null;
		this.outputTexture = null;
	}

	/**
	 * Upload glyph position data to GPU
	 */
	private uploadGlyphData(buffer: GlyphPixelBufferV2, glyphs: ExtendedGlyphData[]): void {
		// Pack glyph data for GPU
		const packed = new Float32Array(glyphs.length * 6);
		for (let i = 0; i < glyphs.length; i++) {
			const g = glyphs[i];
			packed[i * 6] = g.texelX;
			packed[i * 6 + 1] = g.texelY;
			packed[i * 6 + 2] = 1.0; // Coverage (placeholder)
			packed[i * 6 + 3] = 1.0; // Edge weight (placeholder)
			packed[i * 6 + 4] = g.fracX;
			packed[i * 6 + 5] = g.fracY;
		}

		this.device.queue.writeBuffer(this.glyphPixelsBuffer!, 0, packed);
		this.device.queue.writeBuffer(this.pixelCountBuffer!, 0, new Uint32Array([glyphs.length]));
	}

	/**
	 * Encode video capture and ESDT passes
	 */
	private encodeVideoCapturePasses(
		encoder: GPUCommandEncoder,
		frameImport: VideoFrameImport,
		width: number,
		height: number
	): void {
		// Create params buffer
		const paramsBuffer = this.device.createBuffer({
			label: 'video-capture-params',
			size: 16, // width, height, dpr, padding
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		const params = new ArrayBuffer(16);
		new Uint32Array(params, 0, 2).set([width, height]);
		new Float32Array(params, 8, 1).set([window.devicePixelRatio || 1]);
		this.device.queue.writeBuffer(paramsBuffer, 0, params);

		// Create bind group based on frame type
		let bindGroup: GPUBindGroup;

		if (frameImport.externalTexture) {
			bindGroup = this.device.createBindGroup({
				label: 'video-capture-bind-group',
				layout: this.videoCaptureLayout!,
				entries: [
					{ binding: 0, resource: this.videoCapture.videoSampler },
					{ binding: 1, resource: frameImport.externalTexture },
					{ binding: 2, resource: { buffer: this.grayscaleBuffer! } },
					{ binding: 3, resource: { buffer: this.gradientXBuffer! } },
					{ binding: 4, resource: { buffer: paramsBuffer } }
				]
			});
		} else if (frameImport.texture) {
			bindGroup = this.device.createBindGroup({
				label: 'video-capture-bind-group-fallback',
				layout: this.videoCaptureLayout!,
				entries: [
					{ binding: 0, resource: this.videoCapture.videoSampler },
					{ binding: 1, resource: frameImport.texture.createView() },
					{ binding: 2, resource: { buffer: this.grayscaleBuffer! } },
					{ binding: 3, resource: { buffer: this.gradientXBuffer! } },
					{ binding: 4, resource: { buffer: paramsBuffer } }
				]
			});
		} else {
			throw new Error('VideoFrameImport has no texture');
		}

		// Pass 1: Video to Grayscale + Gradient
		const pass1 = encoder.beginComputePass({ label: 'video-capture-esdt' });
		pass1.setPipeline(this.videoCaptureEsdtPipeline!);
		pass1.setBindGroup(0, bindGroup);
		pass1.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
		pass1.end();

		// Clean up params buffer after encoding
		// Note: Buffer must remain valid until command buffer is submitted
		// We'll let it be garbage collected after submit
	}

	/**
	 * Get WGSL shader code for video capture ESDT
	 *
	 * This shader handles both external textures and regular textures
	 * based on the texture type binding.
	 */
	private getVideoCaptureEsdtShader(): string {
		// Use external texture if supported
		if (this.videoCapture.capabilities.importExternalTexture) {
			return `
// Video Capture ESDT - External Texture Version
// Converts video frame to grayscale + gradient for ESDT pipeline

@group(0) @binding(0) var videoSampler: sampler;
@group(0) @binding(1) var videoTexture: texture_external;
@group(0) @binding(2) var<storage, read_write> grayscale: array<f32>;
@group(0) @binding(3) var<storage, read_write> gradient_x: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
    dpr: f32,
    padding: u32,
}

// sRGB linearization (WCAG 2.1 exact constants)
fn srgb_to_linear(c: f32) -> f32 {
    if (c <= 0.03928) {
        return c / 12.92;
    }
    return pow((c + 0.055) / 1.055, 2.4);
}

// Relative luminance (WCAG 2.1)
fn relative_luminance(rgb: vec3<f32>) -> f32 {
    let lin = vec3<f32>(
        srgb_to_linear(rgb.r),
        srgb_to_linear(rgb.g),
        srgb_to_linear(rgb.b)
    );
    return 0.2126 * lin.r + 0.7152 * lin.g + 0.0722 * lin.b;
}

fn sample_video(x: i32, y: i32) -> f32 {
    let px = clamp(x, 0, i32(params.width) - 1);
    let py = clamp(y, 0, i32(params.height) - 1);
    let uv = vec2<f32>(f32(px) + 0.5, f32(py) + 0.5) / vec2<f32>(f32(params.width), f32(params.height));
    let color = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv);
    return relative_luminance(color.rgb);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = i32(global_id.x);
    let y = i32(global_id.y);

    if (global_id.x >= params.width || global_id.y >= params.height) {
        return;
    }

    let idx = global_id.y * params.width + global_id.x;

    // Sample center pixel
    let center = sample_video(x, y);

    // INVERT luminance for text detection (dark text -> high value)
    grayscale[idx] = 1.0 - center;

    // Compute Sobel gradient
    let gx = (
        -1.0 * sample_video(x - 1, y - 1) +
        -2.0 * sample_video(x - 1, y    ) +
        -1.0 * sample_video(x - 1, y + 1) +
         1.0 * sample_video(x + 1, y - 1) +
         2.0 * sample_video(x + 1, y    ) +
         1.0 * sample_video(x + 1, y + 1)
    );

    gradient_x[idx] = gx / 8.0;
}
`;
		} else {
			// Fallback: regular texture
			return `
// Video Capture ESDT - Regular Texture Fallback
// For browsers without importExternalTexture support

@group(0) @binding(0) var videoSampler: sampler;
@group(0) @binding(1) var videoTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> grayscale: array<f32>;
@group(0) @binding(3) var<storage, read_write> gradient_x: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
    dpr: f32,
    padding: u32,
}

fn srgb_to_linear(c: f32) -> f32 {
    if (c <= 0.03928) {
        return c / 12.92;
    }
    return pow((c + 0.055) / 1.055, 2.4);
}

fn relative_luminance(rgb: vec3<f32>) -> f32 {
    let lin = vec3<f32>(
        srgb_to_linear(rgb.r),
        srgb_to_linear(rgb.g),
        srgb_to_linear(rgb.b)
    );
    return 0.2126 * lin.r + 0.7152 * lin.g + 0.0722 * lin.b;
}

fn sample_video(x: i32, y: i32) -> f32 {
    let px = clamp(x, 0, i32(params.width) - 1);
    let py = clamp(y, 0, i32(params.height) - 1);
    let color = textureLoad(videoTexture, vec2<i32>(px, py), 0);
    return relative_luminance(color.rgb);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = i32(global_id.x);
    let y = i32(global_id.y);

    if (global_id.x >= params.width || global_id.y >= params.height) {
        return;
    }

    let idx = global_id.y * params.width + global_id.x;

    let center = sample_video(x, y);
    grayscale[idx] = 1.0 - center;

    let gx = (
        -1.0 * sample_video(x - 1, y - 1) +
        -2.0 * sample_video(x - 1, y    ) +
        -1.0 * sample_video(x - 1, y + 1) +
         1.0 * sample_video(x + 1, y - 1) +
         2.0 * sample_video(x + 1, y    ) +
         1.0 * sample_video(x + 1, y + 1)
    );

    gradient_x[idx] = gx / 8.0;
}
`;
		}
	}

	/**
	 * Clean up all resources
	 */
	destroy(): void {
		this.destroyBuffers();
		this.videoCaptureEsdtPipeline = null;
		this.videoCaptureLayout = null;
		this._stage = 'idle';
	}
}

/**
 * Create a FrameLifetimeManager instance
 */
export function createFrameLifetimeManager(
	device: GPUDevice,
	videoCapture: WebGPUVideoCapture,
	config?: Partial<FrameLifetimeConfig>
): FrameLifetimeManager {
	return new FrameLifetimeManager(device, videoCapture, config);
}
