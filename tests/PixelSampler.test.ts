import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	CanvasSampler,
	WebGLSampler,
	CompositeSampler,
	VideoSampler,
	createSamplerFromSource,
	type PixelSampler
} from '$lib/pixelwise/PixelSampler';

// Mock canvas - jsdom doesn't have canvas support
class MockCanvasRenderingContext2D {
	canvas: HTMLCanvasElement;
	private pixelData: Uint8ClampedArray;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		this.pixelData = new Uint8ClampedArray(canvas.width * canvas.height * 4);
	}

	fillStyle: string | any = '#000000';
	fillRect(x: number, y: number, w: number, h: number) {
		for (let py = y; py < y + h && py < this.canvas.height; py++) {
			for (let px = x; px < x + w && px < this.canvas.width; px++) {
				const color = this.getColorAt(px, py);
				const idx = (py * this.canvas.width + px) * 4;
				this.pixelData[idx] = color[0];
				this.pixelData[idx + 1] = color[1];
				this.pixelData[idx + 2] = color[2];
				this.pixelData[idx + 3] = color[3];
			}
		}
	}

	private getColorAt(x: number, y: number): [number, number, number, number] {
		if (typeof this.fillStyle === 'string') {
			return this.parseColor(this.fillStyle);
		}

		// Gradient - interpolate based on position
		const gradient = this.fillStyle;
		if (gradient.stops && gradient.stops.length > 0) {
			// For horizontal gradient (x0,y0,x1,y1)
			// Interpolate based on x position
			const t = x / this.canvas.width;

			// Find bounding stops
			let lower = gradient.stops[0];
			let upper = gradient.stops[gradient.stops.length - 1];

			for (let i = 0; i < gradient.stops.length - 1; i++) {
				if (t >= gradient.stops[i].offset && t <= gradient.stops[i + 1].offset) {
					lower = gradient.stops[i];
					upper = gradient.stops[i + 1];
					break;
				}
			}

			// Interpolate between lower and upper
			const range = upper.offset - lower.offset;
			const localT = range > 0 ? (t - lower.offset) / range : 0;

			const lowerColor = this.parseColor(lower.color);
			const upperColor = this.parseColor(upper.color);

			return [
				Math.floor(lowerColor[0] * (1 - localT) + upperColor[0] * localT),
				Math.floor(lowerColor[1] * (1 - localT) + upperColor[1] * localT),
				Math.floor(lowerColor[2] * (1 - localT) + upperColor[2] * localT),
				255
			];
		}

		return [0, 0, 0, 255];
	}

	createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
		const gradient = {
			stops: [] as Array<{ offset: number; color: string }>,
			addColorStop(offset: number, color: string) {
				this.stops.push({ offset, color });
			}
		};
		return gradient as any;
	}

	getImageData(x: number, y: number, w: number, h: number) {
		const data = new Uint8ClampedArray(w * h * 4);
		for (let py = 0; py < h; py++) {
			for (let px = 0; px < w; px++) {
				const srcIdx = ((y + py) * this.canvas.width + (x + px)) * 4;
				const dstIdx = (py * w + px) * 4;
				if (srcIdx >= 0 && srcIdx < this.pixelData.length - 3) {
					data[dstIdx] = this.pixelData[srcIdx];
					data[dstIdx + 1] = this.pixelData[srcIdx + 1];
					data[dstIdx + 2] = this.pixelData[srcIdx + 2];
					data[dstIdx + 3] = this.pixelData[srcIdx + 3];
				}
			}
		}
		return { data };
	}

	drawImage(video: any, x: number, y: number) {
		// Mock - just fill with gray
		this.fillStyle = 'rgb(128, 128, 128)';
		this.fillRect(0, 0, this.canvas.width, this.canvas.height);
	}

	private parseColor(color: string): [number, number, number, number] {
		const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
		if (match) {
			return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), 255];
		}
		return [0, 0, 0, 255];
	}
}

class MockWebGL2RenderingContext {
	canvas: HTMLCanvasElement;
	COLOR_BUFFER_BIT = 0x00004000;
	RGBA = 0x1908;
	UNSIGNED_BYTE = 0x1401;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
	}

	clearColor(r: number, g: number, b: number, a: number) {}
	clear(mask: number) {}
	readPixels(x: number, y: number, w: number, h: number, format: number, type: number, pixels: Uint8Array) {
		// Mock - fill with red (cleared color)
		for (let i = 0; i < pixels.length; i += 4) {
			pixels[i] = 255;     // R
			pixels[i + 1] = 0;   // G
			pixels[i + 2] = 0;   // B
			pixels[i + 3] = 255; // A
		}
	}
}

// Override HTMLCanvasElement.getContext
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (contextId: string, options?: any) {
	if (contextId === '2d') {
		return new MockCanvasRenderingContext2D(this) as any;
	}
	if (contextId === 'webgl2') {
		return new MockWebGL2RenderingContext(this) as any;
	}
	return originalGetContext.call(this, contextId, options);
};

describe('CanvasSampler', () => {
	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D;

	beforeEach(() => {
		canvas = document.createElement('canvas');
		canvas.width = 100;
		canvas.height = 100;
		ctx = canvas.getContext('2d')!;

		// Fill with gradient for testing
		const gradient = ctx.createLinearGradient(0, 0, 100, 0);
		gradient.addColorStop(0, 'rgb(255, 0, 0)'); // Red left
		gradient.addColorStop(1, 'rgb(0, 0, 255)'); // Blue right
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, 100, 100);
	});

	it('should sample single pixel correctly', () => {
		const sampler = new CanvasSampler(ctx);

		// Sample left edge (red)
		const [r1, g1, b1] = sampler.sample(0, 50);
		expect(r1).toBeGreaterThan(200);
		expect(b1).toBeLessThan(50);

		// Sample right edge (blue)
		const [r2, g2, b2] = sampler.sample(99, 50);
		expect(r2).toBeLessThan(50);
		expect(b2).toBeGreaterThan(200);
	});

	it('should batch sample small set efficiently', () => {
		const sampler = new CanvasSampler(ctx);

		// 10 samples (below threshold of 100)
		const coords = new Uint32Array([
			0, 0, 10, 10, 20, 20, 30, 30, 40, 40, 50, 50, 60, 60, 70, 70, 80, 80, 90, 90
		]);

		const result = sampler.sampleBatch(coords);
		expect(result.length).toBe(30); // 10 samples * 3 channels

		// First sample should be reddish
		expect(result[0]).toBeGreaterThan(200);
		expect(result[2]).toBeLessThan(100);

		// Last sample should be blueish
		const lastIdx = result.length - 3;
		expect(result[lastIdx]).toBeLessThan(100);
		expect(result[lastIdx + 2]).toBeGreaterThan(200);
	});

	it('should batch sample large set with bounding box optimization', () => {
		const sampler = new CanvasSampler(ctx);

		// 150 samples (above threshold of 100)
		const coords = new Uint32Array(300);
		for (let i = 0; i < 150; i++) {
			coords[i * 2] = (i % 10) * 10;
			coords[i * 2 + 1] = Math.floor(i / 10) * 10;
		}

		const result = sampler.sampleBatch(coords);
		expect(result.length).toBe(450); // 150 samples * 3 channels

		// Verify all samples are valid RGB
		for (let i = 0; i < result.length; i += 3) {
			expect(result[i]).toBeGreaterThanOrEqual(0);
			expect(result[i]).toBeLessThanOrEqual(255);
			expect(result[i + 1]).toBeGreaterThanOrEqual(0);
			expect(result[i + 1]).toBeLessThanOrEqual(255);
			expect(result[i + 2]).toBeGreaterThanOrEqual(0);
			expect(result[i + 2]).toBeLessThanOrEqual(255);
		}
	});

	it('should clamp out-of-bounds coordinates', () => {
		const sampler = new CanvasSampler(ctx);

		// Negative coordinates
		const [r1, g1, b1] = sampler.sample(-10, -10);
		expect(r1).toBeGreaterThanOrEqual(0);

		// Beyond canvas size
		const [r2, g2, b2] = sampler.sample(200, 200);
		expect(r2).toBeGreaterThanOrEqual(0);
	});

	it('should dispose without errors', () => {
		const sampler = new CanvasSampler(ctx);
		expect(() => sampler.dispose()).not.toThrow();
	});
});

describe('WebGLSampler', () => {
	let canvas: HTMLCanvasElement;
	let gl: WebGL2RenderingContext;

	beforeEach(() => {
		canvas = document.createElement('canvas');
		canvas.width = 100;
		canvas.height = 100;
		gl = canvas.getContext('webgl2')!;

		if (!gl) {
			throw new Error('WebGL2 not supported');
		}

		// Clear to red
		gl.clearColor(1, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);
	});

	it('should sample single pixel with Y-flip', () => {
		const sampler = new WebGLSampler(gl);

		// WebGL Y=0 is bottom, Canvas Y=0 is top
		// Sampling (50, 0) in canvas space should map to (50, 99) in GL space
		const [r, g, b] = sampler.sample(50, 50);

		// Should be red (cleared to red)
		expect(r).toBeGreaterThan(200);
		expect(g).toBeLessThan(50);
		expect(b).toBeLessThan(50);
	});

	it('should batch sample sparse coordinates', () => {
		const sampler = new WebGLSampler(gl);

		// 5 samples (below 10% threshold)
		const coords = new Uint32Array([10, 10, 20, 20, 30, 30, 40, 40, 50, 50]);

		const result = sampler.sampleBatch(coords);
		expect(result.length).toBe(15); // 5 samples * 3 channels

		// All should be red
		for (let i = 0; i < result.length; i += 3) {
			expect(result[i]).toBeGreaterThan(200);
			expect(result[i + 1]).toBeLessThan(50);
			expect(result[i + 2]).toBeLessThan(50);
		}
	});

	it('should batch read full framebuffer for dense sampling', () => {
		const sampler = new WebGLSampler(gl);

		// Sample >10% of pixels (100x100 = 10000 pixels, so >1000 samples)
		const numSamples = 1500;
		const coords = new Uint32Array(numSamples * 2);
		for (let i = 0; i < numSamples; i++) {
			coords[i * 2] = (i % 100);
			coords[i * 2 + 1] = Math.floor(i / 100);
		}

		const result = sampler.sampleBatch(coords);
		expect(result.length).toBe(numSamples * 3);

		// All should be red
		for (let i = 0; i < 30; i += 3) {
			// Check first 10 samples
			expect(result[i]).toBeGreaterThan(200);
		}
	});

	it('should dispose without errors', () => {
		const sampler = new WebGLSampler(gl);
		expect(() => sampler.dispose()).not.toThrow();
	});
});

describe('CompositeSampler', () => {
	it('should composite two canvas layers', () => {
		// Bottom layer: red
		const canvas1 = document.createElement('canvas');
		canvas1.width = 100;
		canvas1.height = 100;
		const ctx1 = canvas1.getContext('2d')!;
		ctx1.fillStyle = 'rgb(255, 0, 0)';
		ctx1.fillRect(0, 0, 100, 100);

		// Top layer: blue
		const canvas2 = document.createElement('canvas');
		canvas2.width = 100;
		canvas2.height = 100;
		const ctx2 = canvas2.getContext('2d')!;
		ctx2.fillStyle = 'rgb(0, 0, 255)';
		ctx2.fillRect(0, 0, 100, 100);

		const sampler1 = new CanvasSampler(ctx1);
		const sampler2 = new CanvasSampler(ctx2);
		const composite = new CompositeSampler([sampler1, sampler2]);

		// Should blend red and blue (simple average)
		const [r, g, b] = composite.sample(50, 50);

		// Average of (255,0,0) and (0,0,255) = (127,0,127)
		expect(r).toBeGreaterThan(100);
		expect(r).toBeLessThan(150);
		expect(b).toBeGreaterThan(100);
		expect(b).toBeLessThan(150);
		expect(g).toBeLessThan(50);
	});

	it('should batch composite multiple layers', () => {
		const canvas1 = document.createElement('canvas');
		canvas1.width = 100;
		canvas1.height = 100;
		const ctx1 = canvas1.getContext('2d')!;
		ctx1.fillStyle = 'rgb(255, 0, 0)';
		ctx1.fillRect(0, 0, 100, 100);

		const canvas2 = document.createElement('canvas');
		canvas2.width = 100;
		canvas2.height = 100;
		const ctx2 = canvas2.getContext('2d')!;
		ctx2.fillStyle = 'rgb(0, 255, 0)';
		ctx2.fillRect(0, 0, 100, 100);

		const composite = new CompositeSampler([new CanvasSampler(ctx1), new CanvasSampler(ctx2)]);

		const coords = new Uint32Array([10, 10, 20, 20, 30, 30]);
		const result = composite.sampleBatch(coords);

		expect(result.length).toBe(9); // 3 samples * 3 channels

		// All samples should be blended
		for (let i = 0; i < result.length; i += 3) {
			// Red and green blend
			expect(result[i]).toBeGreaterThan(100); // R channel
			expect(result[i + 1]).toBeGreaterThan(100); // G channel
			expect(result[i + 2]).toBeLessThan(50); // B channel
		}
	});

	it('should throw on empty layers array', () => {
		expect(() => new CompositeSampler([])).toThrow();
	});

	it('should dispose all layers', () => {
		const canvas1 = document.createElement('canvas');
		canvas1.width = 100;
		canvas1.height = 100;
		const ctx1 = canvas1.getContext('2d')!;

		const sampler1 = new CanvasSampler(ctx1);
		const composite = new CompositeSampler([sampler1]);

		expect(() => composite.dispose()).not.toThrow();
	});
});

describe('VideoSampler', () => {
	let video: HTMLVideoElement;

	beforeEach(() => {
		video = document.createElement('video');
		video.width = 100;
		video.height = 100;

		// Mock video properties
		Object.defineProperty(video, 'videoWidth', { value: 100, writable: true });
		Object.defineProperty(video, 'videoHeight', { value: 100, writable: true });
		Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_CURRENT_DATA, writable: true });
		Object.defineProperty(video, 'paused', { value: false, writable: true });
		Object.defineProperty(video, 'ended', { value: false, writable: true });
		Object.defineProperty(video, 'currentTime', { value: 1.0, writable: true });
	});

	it('should create sampler from video', () => {
		expect(() => new VideoSampler(video)).not.toThrow();
	});

	it('should return black when video not ready', () => {
		Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_NOTHING, writable: true });

		const sampler = new VideoSampler(video);
		const [r, g, b] = sampler.sample(50, 50);

		expect(r).toBe(0);
		expect(g).toBe(0);
		expect(b).toBe(0);
	});

	it('should return black batch when video not ready', () => {
		Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_NOTHING, writable: true });

		const sampler = new VideoSampler(video);
		const coords = new Uint32Array([10, 10, 20, 20]);
		const result = sampler.sampleBatch(coords);

		expect(result.length).toBe(6);
		expect(result.every((v) => v === 0)).toBe(true);
	});

	it('should dispose without errors', () => {
		const sampler = new VideoSampler(video);
		expect(() => sampler.dispose()).not.toThrow();
	});
});

describe('createSamplerFromSource', () => {
	it('should create CanvasSampler from canvas', () => {
		const canvas = document.createElement('canvas');
		canvas.width = 100;
		canvas.height = 100;

		const result = createSamplerFromSource(canvas);
		expect(result.success).toBe(true);
		expect(result.data).toBeInstanceOf(CanvasSampler);
	});

	it('should create VideoSampler from video', () => {
		const video = document.createElement('video');
		const result = createSamplerFromSource(video);
		expect(result.success).toBe(true);
		expect(result.data).toBeInstanceOf(VideoSampler);
	});

	it('should create WebGLSampler from WebGL context', () => {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2');

		if (gl) {
			const result = createSamplerFromSource(gl);
			expect(result.success).toBe(true);
			expect(result.data).toBeInstanceOf(WebGLSampler);
		}
	});

	it('should handle invalid canvas (no 2D context)', () => {
		const canvas = document.createElement('canvas');

		// Mock getContext to return null for 2D
		const originalGetContext = canvas.getContext.bind(canvas);
		canvas.getContext = function(contextId: string) {
			if (contextId === '2d') {
				return null;
			}
			return originalGetContext(contextId);
		} as any;

		const result = createSamplerFromSource(canvas);
		expect(result.success).toBe(false);
	});
});

describe('PixelSampler edge cases', () => {
	it('should handle fractional coordinates', () => {
		const canvas = document.createElement('canvas');
		canvas.width = 100;
		canvas.height = 100;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = 'rgb(100, 100, 100)';
		ctx.fillRect(0, 0, 100, 100);

		const sampler = new CanvasSampler(ctx);

		// Fractional coordinates should be floored
		const [r1, g1, b1] = sampler.sample(10.7, 10.3);
		const [r2, g2, b2] = sampler.sample(10, 10);

		expect(r1).toBe(r2);
		expect(g1).toBe(g2);
		expect(b1).toBe(b2);
	});

	it('should handle very large coordinate arrays', () => {
		const canvas = document.createElement('canvas');
		canvas.width = 1000;
		canvas.height = 1000;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = 'rgb(128, 128, 128)';
		ctx.fillRect(0, 0, 1000, 1000);

		const sampler = new CanvasSampler(ctx);

		// 5000 samples
		const numSamples = 5000;
		const coords = new Uint32Array(numSamples * 2);
		for (let i = 0; i < numSamples; i++) {
			coords[i * 2] = Math.floor(Math.random() * 1000);
			coords[i * 2 + 1] = Math.floor(Math.random() * 1000);
		}

		const start = performance.now();
		const result = sampler.sampleBatch(coords);
		const elapsed = performance.now() - start;

		expect(result.length).toBe(numSamples * 3);
		expect(elapsed).toBeLessThan(2000); // Should complete in <2000ms (CI environments vary)

		// Verify samples are roughly gray
		const avgR = result.filter((_, i) => i % 3 === 0).reduce((a, b) => a + b, 0) / numSamples;
		expect(avgR).toBeGreaterThan(100);
		expect(avgR).toBeLessThan(150);
	});
});
