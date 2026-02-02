/**
 * BufferRing - Triple-buffer frame pipeline for 60fps processing
 *
 * Implements a ring buffer of frame resources to enable pipelined
 * processing where capture, GPU processing, and output can overlap:
 *
 * Frame N-2: OUTPUT    (displaying)
 * Frame N-1: PROCESS   (GPU computing)
 * Frame N:   CAPTURE   (importing from video)
 * Frame N+1: WAITING   (ready for next capture)
 *
 * This prevents frame drops by decoupling the capture timing from
 * GPU processing completion.
 *
 * @module capture/BufferRing
 */

/**
 * Status of a frame buffer in the ring
 */
export type BufferStatus = 'idle' | 'capturing' | 'processing' | 'ready' | 'error';

/**
 * GPU buffers for a single frame
 */
export interface FrameBuffers {
	/** Index in the ring buffer */
	index: number;

	/** Current status of this buffer set */
	status: BufferStatus;

	/** Frame number when last used */
	frameNumber: number;

	/** Grayscale luminance values */
	grayscale: GPUBuffer;

	/** Horizontal gradient values */
	gradientX: GPUBuffer;

	/** Vertical gradient values */
	gradientY: GPUBuffer;

	/** ESDT offset vectors (delta_x, delta_y, distance) */
	esdtData: GPUBuffer;

	/** Extracted glyph pixels */
	glyphPixels: GPUBuffer;

	/** Glyph pixel count */
	pixelCount: GPUBuffer;

	/** Background color samples */
	backgroundSamples: GPUBuffer;

	/** Contrast analysis results */
	contrastAnalyses: GPUBuffer;

	/** Output texture for final result */
	outputTexture: GPUTexture;

	/** Error message if status is 'error' */
	error: string | null;
}

/**
 * Configuration for the buffer ring
 */
export interface BufferRingConfig {
	/** Number of frame buffers in the ring (default: 3 for triple buffering) */
	frameCount: number;
	/** Maximum glyph pixels per frame */
	maxGlyphPixels: number;
}

/**
 * Default configuration
 */
export const DEFAULT_RING_CONFIG: BufferRingConfig = {
	frameCount: 3,
	maxGlyphPixels: 100000
};

/**
 * BufferRing - Manages triple-buffered frame processing
 *
 * @example
 * ```typescript
 * const ring = new BufferRing(device, 1920, 1080);
 *
 * // Get buffer for next capture
 * const captureBuffer = ring.getNextForCapture();
 * captureBuffer.status = 'capturing';
 *
 * // After capture completes
 * captureBuffer.status = 'processing';
 *
 * // After GPU processing
 * captureBuffer.status = 'ready';
 *
 * // Get completed frame
 * const readyBuffer = ring.getReady();
 * if (readyBuffer) {
 *   // Use readyBuffer.outputTexture
 *   ring.markIdle(readyBuffer);
 * }
 * ```
 */
export class BufferRing {
	private readonly device: GPUDevice;
	private readonly buffers: FrameBuffers[];
	private currentIndex = 0;
	private frameCounter = 0;
	private readonly width: number;
	private readonly height: number;
	private readonly config: BufferRingConfig;

	/**
	 * Create a new BufferRing
	 *
	 * @param device - WebGPU device
	 * @param width - Frame width in pixels
	 * @param height - Frame height in pixels
	 * @param config - Ring configuration
	 */
	constructor(
		device: GPUDevice,
		width: number,
		height: number,
		config: Partial<BufferRingConfig> = {}
	) {
		this.device = device;
		this.width = width;
		this.height = height;
		this.config = { ...DEFAULT_RING_CONFIG, ...config };

		// Allocate frame buffers
		this.buffers = [];
		for (let i = 0; i < this.config.frameCount; i++) {
			this.buffers.push(this.createFrameBuffers(i));
		}

		console.log(
			`[BufferRing] Created ${this.config.frameCount} frame buffers for ${width}x${height}`
		);
	}

	/** Number of buffers in the ring */
	get size(): number {
		return this.buffers.length;
	}

	/** Total frames processed */
	get totalFrames(): number {
		return this.frameCounter;
	}

	/** Current frame dimensions */
	get dimensions(): { width: number; height: number } {
		return { width: this.width, height: this.height };
	}

	/**
	 * Create GPU buffers for a single frame
	 */
	private createFrameBuffers(index: number): FrameBuffers {
		const pixelCount = this.width * this.height;
		const distanceDataSize = 12; // 3 x f32 per pixel (delta_x, delta_y, distance)
		const glyphPixelSize = 24; // 6 x f32 per glyph pixel

		return {
			index,
			status: 'idle',
			frameNumber: -1,
			error: null,

			grayscale: this.device.createBuffer({
				label: `grayscale-${index}`,
				size: pixelCount * 4, // f32
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}),

			gradientX: this.device.createBuffer({
				label: `gradient-x-${index}`,
				size: pixelCount * 4, // f32
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}),

			gradientY: this.device.createBuffer({
				label: `gradient-y-${index}`,
				size: pixelCount * 4, // f32
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}),

			esdtData: this.device.createBuffer({
				label: `esdt-data-${index}`,
				size: pixelCount * distanceDataSize,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
			}),

			glyphPixels: this.device.createBuffer({
				label: `glyph-pixels-${index}`,
				size: this.config.maxGlyphPixels * glyphPixelSize,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
			}),

			pixelCount: this.device.createBuffer({
				label: `pixel-count-${index}`,
				size: 4, // u32
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
			}),

			backgroundSamples: this.device.createBuffer({
				label: `background-samples-${index}`,
				size: this.config.maxGlyphPixels * 16, // 4 x f32 per sample
				usage: GPUBufferUsage.STORAGE
			}),

			contrastAnalyses: this.device.createBuffer({
				label: `contrast-analyses-${index}`,
				size: this.config.maxGlyphPixels * 16, // 4 x f32 per analysis
				usage: GPUBufferUsage.STORAGE
			}),

			outputTexture: this.device.createTexture({
				label: `output-texture-${index}`,
				size: [this.width, this.height],
				format: 'rgba8unorm',
				usage:
					GPUTextureUsage.STORAGE_BINDING |
					GPUTextureUsage.COPY_SRC |
					GPUTextureUsage.COPY_DST |
					GPUTextureUsage.RENDER_ATTACHMENT
			})
		};
	}

	/**
	 * Get the next buffer for capturing a new frame
	 *
	 * Prefers idle buffers, but will reuse the oldest buffer if none are idle.
	 * This prevents stalls when processing takes longer than expected.
	 */
	getNextForCapture(): FrameBuffers {
		// First, try to find an idle buffer
		for (let i = 0; i < this.buffers.length; i++) {
			const idx = (this.currentIndex + i) % this.buffers.length;
			if (this.buffers[idx].status === 'idle') {
				this.currentIndex = (idx + 1) % this.buffers.length;
				this.frameCounter++;
				this.buffers[idx].frameNumber = this.frameCounter;
				this.buffers[idx].status = 'capturing';
				this.buffers[idx].error = null;
				return this.buffers[idx];
			}
		}

		// No idle buffer - reuse the oldest (may cause frame drop)
		const oldest = this.buffers[this.currentIndex];
		this.currentIndex = (this.currentIndex + 1) % this.buffers.length;
		this.frameCounter++;

		console.warn(
			`[BufferRing] No idle buffer, reusing buffer ${oldest.index} (was ${oldest.status})`
		);

		oldest.frameNumber = this.frameCounter;
		oldest.status = 'capturing';
		oldest.error = null;
		return oldest;
	}

	/**
	 * Get a buffer that is ready for output
	 *
	 * @returns Ready buffer or null if none available
	 */
	getReady(): FrameBuffers | null {
		// Find the oldest ready buffer (to maintain frame order)
		let oldestReady: FrameBuffers | null = null;

		for (const buffer of this.buffers) {
			if (buffer.status === 'ready') {
				if (!oldestReady || buffer.frameNumber < oldestReady.frameNumber) {
					oldestReady = buffer;
				}
			}
		}

		return oldestReady;
	}

	/**
	 * Get all buffers that are currently ready
	 */
	getAllReady(): FrameBuffers[] {
		return this.buffers.filter((b) => b.status === 'ready').sort((a, b) => a.frameNumber - b.frameNumber);
	}

	/**
	 * Mark a buffer as idle (available for reuse)
	 */
	markIdle(buffer: FrameBuffers): void {
		buffer.status = 'idle';
	}

	/**
	 * Mark a buffer as processing
	 */
	markProcessing(buffer: FrameBuffers): void {
		buffer.status = 'processing';
	}

	/**
	 * Mark a buffer as ready (processing complete)
	 */
	markReady(buffer: FrameBuffers): void {
		buffer.status = 'ready';
	}

	/**
	 * Mark a buffer as error
	 */
	markError(buffer: FrameBuffers, error: string): void {
		buffer.status = 'error';
		buffer.error = error;
	}

	/**
	 * Get buffer by index
	 */
	getBuffer(index: number): FrameBuffers | null {
		return this.buffers[index] || null;
	}

	/**
	 * Get status of all buffers
	 */
	getStatus(): Array<{ index: number; status: BufferStatus; frameNumber: number }> {
		return this.buffers.map((b) => ({
			index: b.index,
			status: b.status,
			frameNumber: b.frameNumber
		}));
	}

	/**
	 * Count buffers in each status
	 */
	getStatusCounts(): Record<BufferStatus, number> {
		const counts: Record<BufferStatus, number> = {
			idle: 0,
			capturing: 0,
			processing: 0,
			ready: 0,
			error: 0
		};

		for (const buffer of this.buffers) {
			counts[buffer.status]++;
		}

		return counts;
	}

	/**
	 * Reset all buffers to idle state
	 */
	reset(): void {
		for (const buffer of this.buffers) {
			buffer.status = 'idle';
			buffer.frameNumber = -1;
			buffer.error = null;
		}
		this.currentIndex = 0;
		this.frameCounter = 0;
	}

	/**
	 * Resize all buffers for new dimensions
	 *
	 * This destroys all existing buffers and creates new ones.
	 */
	resize(width: number, height: number): void {
		// Destroy old buffers
		this.destroy();

		// Update dimensions
		(this as { width: number }).width = width;
		(this as { height: number }).height = height;

		// Create new buffers
		this.buffers.length = 0;
		for (let i = 0; i < this.config.frameCount; i++) {
			this.buffers.push(this.createFrameBuffers(i));
		}

		this.reset();

		console.log(`[BufferRing] Resized to ${width}x${height}`);
	}

	/**
	 * Clean up all GPU resources
	 */
	destroy(): void {
		for (const buffer of this.buffers) {
			buffer.grayscale.destroy();
			buffer.gradientX.destroy();
			buffer.gradientY.destroy();
			buffer.esdtData.destroy();
			buffer.glyphPixels.destroy();
			buffer.pixelCount.destroy();
			buffer.backgroundSamples.destroy();
			buffer.contrastAnalyses.destroy();
			buffer.outputTexture.destroy();
		}
	}
}

/**
 * Create a BufferRing instance
 */
export function createBufferRing(
	device: GPUDevice,
	width: number,
	height: number,
	config?: Partial<BufferRingConfig>
): BufferRing {
	return new BufferRing(device, width, height, config);
}
