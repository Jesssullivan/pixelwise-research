/**
 * PixelSampler - Background-agnostic pixel sampling interface
 *
 * Architecture:
 * - Compositor is decoupled from background source
 * - Sparse edge sampling: sample ONLY at text boundaries
 * - Monadic composability: samplers can be layered and transformed
 *
 * Design Principles:
 * - Interface defines contract, not implementation
 * - Batch operations preferred (single getImageData call where possible)
 * - Coordinate transforms handled internally (WebGL Y-flip, etc.)
 * - Resource cleanup via dispose() method
 */

import type { Result } from './types';

/**
 * Core sampling interface - background agnostic
 */
export interface PixelSampler {
	/**
	 * Sample single pixel at coordinate
	 * @param x - X coordinate in screen space (0 = left)
	 * @param y - Y coordinate in screen space (0 = top)
	 * @returns RGB tuple [0-255, 0-255, 0-255]
	 */
	sample(x: number, y: number): [r: number, g: number, b: number];

	/**
	 * Batch sample for efficiency
	 * @param coords - Flat Uint32Array of [x1, y1, x2, y2, ...]
	 * @returns Flat Uint8Array of [r1, g1, b1, r2, g2, b2, ...]
	 */
	sampleBatch(coords: Uint32Array): Uint8Array;

	/**
	 * Dispose resources (textures, contexts, etc.)
	 */
	dispose(): void;
}

/**
 * Canvas-based sampler for 2D canvas backgrounds
 * Use for: SVG blobs, static images, canvas-rendered content
 */
export class CanvasSampler implements PixelSampler {
	private ctx: CanvasRenderingContext2D;
	private width: number;
	private height: number;

	constructor(ctx: CanvasRenderingContext2D) {
		this.ctx = ctx;
		this.width = ctx.canvas.width;
		this.height = ctx.canvas.height;
	}

	sample(x: number, y: number): [number, number, number] {
		// Clamp coordinates to canvas bounds
		const clampedX = Math.max(0, Math.min(Math.floor(x), this.width - 1));
		const clampedY = Math.max(0, Math.min(Math.floor(y), this.height - 1));

		try {
			const pixel = this.ctx.getImageData(clampedX, clampedY, 1, 1).data;
			return [pixel[0], pixel[1], pixel[2]];
		} catch (error: unknown) {
			// Security error or invalid state - return black
			const message = error instanceof Error ? error.message : String(error);
			console.warn('CanvasSampler: Failed to sample pixel', message);
			return [0, 0, 0];
		}
	}

	sampleBatch(coords: Uint32Array): Uint8Array {
		const numSamples = coords.length / 2;
		const result = new Uint8Array(numSamples * 3);

		// Early exit for empty input
		if (numSamples === 0) {
			return result;
		}

		// Try to optimize by finding bounding box and using single getImageData
		// For sparse samples, individual calls may be faster due to cache locality
		const threshold = 100; // Tunable: when to use batch vs individual

		if (numSamples < threshold) {
			// Individual samples for small batches
			for (let i = 0; i < numSamples; i++) {
				const x = coords[i * 2];
				const y = coords[i * 2 + 1];
				const [r, g, b] = this.sample(x, y);
				result[i * 3] = r;
				result[i * 3 + 1] = g;
				result[i * 3 + 2] = b;
			}
		} else {
			// Batch getImageData for large sets
			// Find bounding box with validation for NaN/Infinity/huge values
			let minX = this.width;
			let minY = this.height;
			let maxX = 0;
			let maxY = 0;
			let hasValidCoords = false;

			for (let i = 0; i < numSamples; i++) {
				const x = coords[i * 2];
				const y = coords[i * 2 + 1];

				// Skip invalid coordinates (NaN, huge values from Uint32 wrap of negatives)
				// MAX_SAFE_INTEGER check catches Uint32 wrapped negatives like 4294967291
				if (x > this.width || y > this.height) {
					continue;
				}

				hasValidCoords = true;
				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				maxX = Math.max(maxX, x);
				maxY = Math.max(maxY, y);
			}

			// If no valid coordinates, fall back to individual sampling
			if (!hasValidCoords) {
				for (let i = 0; i < numSamples; i++) {
					const [r, g, b] = this.sample(coords[i * 2], coords[i * 2 + 1]);
					result[i * 3] = r;
					result[i * 3 + 1] = g;
					result[i * 3 + 2] = b;
				}
				return result;
			}

			// Clamp to canvas bounds
			minX = Math.max(0, Math.floor(minX));
			minY = Math.max(0, Math.floor(minY));
			maxX = Math.min(this.width - 1, Math.ceil(maxX));
			maxY = Math.min(this.height - 1, Math.ceil(maxY));

			const boxWidth = maxX - minX + 1;
			const boxHeight = maxY - minY + 1;

			// Final safety check: ensure dimensions are reasonable
			if (boxWidth <= 0 || boxHeight <= 0 || boxWidth > this.width || boxHeight > this.height) {
				// Fallback to individual samples
				for (let i = 0; i < numSamples; i++) {
					const [r, g, b] = this.sample(coords[i * 2], coords[i * 2 + 1]);
					result[i * 3] = r;
					result[i * 3 + 1] = g;
					result[i * 3 + 2] = b;
				}
				return result;
			}

			try {
				// Single getImageData call for entire bounding box
				const imageData = this.ctx.getImageData(minX, minY, boxWidth, boxHeight);
				const pixels = imageData.data;

				// Sample from the cached image data
				for (let i = 0; i < numSamples; i++) {
					const x = Math.floor(coords[i * 2]) - minX;
					const y = Math.floor(coords[i * 2 + 1]) - minY;

					// Bounds check within box
					if (x >= 0 && x < boxWidth && y >= 0 && y < boxHeight) {
						const pixelIndex = (y * boxWidth + x) * 4;
						result[i * 3] = pixels[pixelIndex];
						result[i * 3 + 1] = pixels[pixelIndex + 1];
						result[i * 3 + 2] = pixels[pixelIndex + 2];
					} else {
						// Out of bounds - black
						result[i * 3] = 0;
						result[i * 3 + 1] = 0;
						result[i * 3 + 2] = 0;
					}
				}
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn('CanvasSampler: Failed to batch sample', message);
				// Fallback to individual samples
				for (let i = 0; i < numSamples; i++) {
					const [r, g, b] = this.sample(coords[i * 2], coords[i * 2 + 1]);
					result[i * 3] = r;
					result[i * 3 + 1] = g;
					result[i * 3 + 2] = b;
				}
			}
		}

		return result;
	}

	dispose(): void {
		// Canvas contexts don't need explicit cleanup
		// Just clear references
		this.ctx = null as unknown as CanvasRenderingContext2D;
	}
}

/**
 * WebGL-based sampler for GPU-rendered backgrounds
 * Use for: WebGL blob physics, shader backgrounds, GPU effects
 *
 * Note: Handles Y-axis flip (WebGL Y=0 at bottom, Canvas Y=0 at top)
 */
export class WebGLSampler implements PixelSampler {
	private gl: WebGL2RenderingContext;
	private width: number;
	private height: number;
	private pixelBuffer: Uint8Array;

	constructor(gl: WebGL2RenderingContext) {
		this.gl = gl;
		this.width = gl.canvas.width;
		this.height = gl.canvas.height;
		// Reusable pixel buffer for single-pixel reads
		this.pixelBuffer = new Uint8Array(4);
	}

	sample(x: number, y: number): [number, number, number] {
		// Flip Y coordinate (Canvas Y=0 at top, WebGL Y=0 at bottom)
		const glY = this.height - 1 - Math.floor(y);
		const glX = Math.floor(x);

		// Clamp to framebuffer bounds
		const clampedX = Math.max(0, Math.min(glX, this.width - 1));
		const clampedY = Math.max(0, Math.min(glY, this.height - 1));

		try {
			this.gl.readPixels(clampedX, clampedY, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.pixelBuffer);
			return [this.pixelBuffer[0], this.pixelBuffer[1], this.pixelBuffer[2]];
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn('WebGLSampler: Failed to sample pixel', message);
			return [0, 0, 0];
		}
	}

	sampleBatch(coords: Uint32Array): Uint8Array {
		const numSamples = coords.length / 2;
		const result = new Uint8Array(numSamples * 3);

		// For WebGL, batch readPixels is more complex due to Y-flip
		// Optimal strategy: read entire framebuffer once, then sample from it
		// vs. multiple individual readPixels calls

		// Heuristic: if sampling >10% of pixels, read full framebuffer
		const totalPixels = this.width * this.height;
		const sampleRatio = numSamples / totalPixels;

		if (sampleRatio > 0.1) {
			// Batch read: get entire framebuffer
			try {
				const framebuffer = new Uint8Array(this.width * this.height * 4);
				this.gl.readPixels(0, 0, this.width, this.height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, framebuffer);

				// Sample from framebuffer
				for (let i = 0; i < numSamples; i++) {
					const x = Math.floor(coords[i * 2]);
					const y = Math.floor(coords[i * 2 + 1]);
					// Flip Y for WebGL
					const glY = this.height - 1 - y;

					if (x >= 0 && x < this.width && glY >= 0 && glY < this.height) {
						const pixelIndex = (glY * this.width + x) * 4;
						result[i * 3] = framebuffer[pixelIndex];
						result[i * 3 + 1] = framebuffer[pixelIndex + 1];
						result[i * 3 + 2] = framebuffer[pixelIndex + 2];
					} else {
						result[i * 3] = 0;
						result[i * 3 + 1] = 0;
						result[i * 3 + 2] = 0;
					}
				}
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn('WebGLSampler: Failed to batch read framebuffer', message);
				// Fallback to individual
				for (let i = 0; i < numSamples; i++) {
					const [r, g, b] = this.sample(coords[i * 2], coords[i * 2 + 1]);
					result[i * 3] = r;
					result[i * 3 + 1] = g;
					result[i * 3 + 2] = b;
				}
			}
		} else {
			// Individual readPixels for sparse sampling
			for (let i = 0; i < numSamples; i++) {
				const [r, g, b] = this.sample(coords[i * 2], coords[i * 2 + 1]);
				result[i * 3] = r;
				result[i * 3 + 1] = g;
				result[i * 3 + 2] = b;
			}
		}

		return result;
	}

	dispose(): void {
		// WebGL contexts don't need explicit cleanup from sampler
		this.gl = null as unknown as WebGL2RenderingContext;
	}
}

/**
 * Composite sampler for layered backgrounds
 * Composites multiple samplers back-to-front with alpha blending
 * Use for: Background image + animated overlay, multiple canvas layers
 */
export class CompositeSampler implements PixelSampler {
	private layers: PixelSampler[];

	/**
	 * @param layers - Samplers in back-to-front order (layers[0] = bottom)
	 */
	constructor(layers: PixelSampler[]) {
		if (layers.length === 0) {
			throw new Error('CompositeSampler requires at least one layer');
		}
		this.layers = layers;
	}

	sample(x: number, y: number): [number, number, number] {
		// Simple compositing: sample all layers and blend
		// For MVP, assume opaque layers (no alpha) - just return top layer
		// Full implementation would need alpha channel from samplers

		// Start with bottom layer
		let [r, g, b] = this.layers[0].sample(x, y);

		// Composite remaining layers
		// TODO: Full alpha compositing if samplers provide alpha channel
		// For now, just average (naive blending)
		for (let i = 1; i < this.layers.length; i++) {
			const [lr, lg, lb] = this.layers[i].sample(x, y);
			// Simple average - replace with proper alpha blend when needed
			r = Math.floor((r + lr) / 2);
			g = Math.floor((g + lg) / 2);
			b = Math.floor((b + lb) / 2);
		}

		return [r, g, b];
	}

	sampleBatch(coords: Uint32Array): Uint8Array {
		const numSamples = coords.length / 2;
		const result = new Uint8Array(numSamples * 3);

		// Batch sample each layer
		const layerSamples = this.layers.map((layer) => layer.sampleBatch(coords));

		// Composite samples
		for (let i = 0; i < numSamples; i++) {
			const baseIdx = i * 3;

			// Start with bottom layer
			let r = layerSamples[0][baseIdx];
			let g = layerSamples[0][baseIdx + 1];
			let b = layerSamples[0][baseIdx + 2];

			// Composite remaining layers (simple average for MVP)
			for (let layerIdx = 1; layerIdx < layerSamples.length; layerIdx++) {
				const lr = layerSamples[layerIdx][baseIdx];
				const lg = layerSamples[layerIdx][baseIdx + 1];
				const lb = layerSamples[layerIdx][baseIdx + 2];

				r = Math.floor((r + lr) / 2);
				g = Math.floor((g + lg) / 2);
				b = Math.floor((b + lb) / 2);
			}

			result[baseIdx] = r;
			result[baseIdx + 1] = g;
			result[baseIdx + 2] = b;
		}

		return result;
	}

	dispose(): void {
		// Dispose all layers
		for (const layer of this.layers) {
			layer.dispose();
		}
		this.layers = [];
	}
}

/**
 * Video-based sampler for video backgrounds
 * Uses scratch canvas to sample video frames
 * Use for: Video backgrounds, webcam feeds
 *
 * Note: Handles video readyState and CORS issues
 */
export class VideoSampler implements PixelSampler {
	private video: HTMLVideoElement;
	private scratchCanvas: HTMLCanvasElement;
	private scratchCtx: CanvasRenderingContext2D;
	private lastFrameTime: number = -1;
	private cachedSampler: CanvasSampler | null = null;

	constructor(video: HTMLVideoElement) {
		this.video = video;
		this.scratchCanvas = document.createElement('canvas');
		const ctx = this.scratchCanvas.getContext('2d', {
			alpha: false,
			willReadFrequently: true // Hint for getImageData optimization
		});

		if (!ctx) {
			throw new Error('Failed to create 2D context for VideoSampler');
		}

		this.scratchCtx = ctx;
		this.updateCanvasSize();
	}

	private updateCanvasSize(): void {
		// Match video dimensions
		this.scratchCanvas.width = this.video.videoWidth || 1920;
		this.scratchCanvas.height = this.video.videoHeight || 1080;
	}

	private ensureFrameReady(): boolean {
		// Check if video is ready
		if (
			this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
			this.video.paused ||
			this.video.ended
		) {
			return false;
		}

		// Check if we need to update scratch canvas
		const currentTime = this.video.currentTime;
		if (currentTime !== this.lastFrameTime) {
			// New frame available - redraw
			try {
				this.updateCanvasSize();
				this.scratchCtx.drawImage(this.video, 0, 0);
				this.lastFrameTime = currentTime;

				// Update cached sampler
				this.cachedSampler = new CanvasSampler(this.scratchCtx);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn('VideoSampler: Failed to draw video frame', message);
				return false;
			}
		}

		return true;
	}

	sample(x: number, y: number): [number, number, number] {
		if (!this.ensureFrameReady() || !this.cachedSampler) {
			// Video not ready - return black
			return [0, 0, 0];
		}

		return this.cachedSampler.sample(x, y);
	}

	sampleBatch(coords: Uint32Array): Uint8Array {
		const numSamples = coords.length / 2;
		const result = new Uint8Array(numSamples * 3);

		if (!this.ensureFrameReady() || !this.cachedSampler) {
			// Video not ready - return all black
			return result;
		}

		return this.cachedSampler.sampleBatch(coords);
	}

	dispose(): void {
		if (this.cachedSampler) {
			this.cachedSampler.dispose();
			this.cachedSampler = null;
		}
		this.video = null as unknown as HTMLVideoElement;
		this.scratchCtx = null as unknown as CanvasRenderingContext2D;
		this.scratchCanvas = null as unknown as HTMLCanvasElement;
	}
}

/**
 * Factory function to create appropriate sampler from source
 */
export function createSamplerFromSource(
	source: HTMLCanvasElement | HTMLVideoElement | WebGL2RenderingContext
): Result<PixelSampler> {
	try {
		if (source instanceof HTMLCanvasElement) {
			const ctx = source.getContext('2d');
			if (!ctx) {
				return { success: false, error: new Error('Failed to get 2D context from canvas') };
			}
			return { success: true, data: new CanvasSampler(ctx) };
		}

		if (source instanceof HTMLVideoElement) {
			return { success: true, data: new VideoSampler(source) };
		}

		// WebGL2RenderingContext
		return { success: true, data: new WebGLSampler(source) };
	} catch (error: unknown) {
		return {
			success: false,
			error: error instanceof Error ? error : new Error(String(error))
		};
	}
}
