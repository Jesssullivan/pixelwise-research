/**
 * Vitest Global Setup
 *
 * Setup for theorem-verification tests and WebGL rendering tests.
 * Provides mocks for browser APIs not available in jsdom.
 */

// Import fast-check vitest integration for it.prop()
import '@fast-check/vitest';

// Extend expect with custom matchers if needed
import { expect, vi } from 'vitest';

/**
 * Mock OffscreenCanvas for tests that use canvas contexts
 * jsdom doesn't fully support OffscreenCanvas.getContext('2d')
 */
if (typeof globalThis.OffscreenCanvas === 'undefined' || !globalThis.OffscreenCanvas.prototype.getContext) {
	class MockOffscreenCanvas {
		width: number;
		height: number;

		constructor(width: number, height: number) {
			this.width = width;
			this.height = height;
		}

		getContext(type: string): any {
			if (type === '2d') {
				return {
					font: '',
					measureText: (text: string) => ({
						width: text.length * 8,
						actualBoundingBoxAscent: 12,
						actualBoundingBoxDescent: 3,
						fontBoundingBoxAscent: 14,
						fontBoundingBoxDescent: 4,
						actualBoundingBoxLeft: 0,
						actualBoundingBoxRight: text.length * 8,
						alphabeticBaseline: 0,
						emHeightAscent: 13,
						emHeightDescent: 3
					}),
					fillText: vi.fn(),
					clearRect: vi.fn(),
					getImageData: vi.fn().mockReturnValue({
						data: new Uint8ClampedArray(4),
						width: 1,
						height: 1
					}),
					putImageData: vi.fn(),
					drawImage: vi.fn(),
					canvas: { width: 1, height: 1 }
				};
			}
			return null;
		}

		transferToImageBitmap(): any {
			return {};
		}
	}

	(globalThis as unknown as Record<string, unknown>).OffscreenCanvas = MockOffscreenCanvas;
}

/**
 * Mock ImageData if not available in jsdom
 */
if (typeof globalThis.ImageData === 'undefined') {
	(globalThis as unknown as Record<string, unknown>).ImageData = class ImageData {
		data: Uint8ClampedArray;
		width: number;
		height: number;

		constructor(widthOrData: number | Uint8ClampedArray, heightOrWidth?: number, height?: number) {
			if (typeof widthOrData === 'number') {
				// new ImageData(width, height)
				this.width = widthOrData;
				this.height = heightOrWidth!;
				this.data = new Uint8ClampedArray(this.width * this.height * 4);
			} else {
				// new ImageData(data, width, height?)
				this.data = widthOrData;
				this.width = heightOrWidth!;
				this.height = height || (widthOrData.length / 4 / heightOrWidth!);
			}
		}
	};
}

/**
 * Create a mock WebGL2RenderingContext for tests
 */
function createMockWebGL2Context(): Record<string, unknown> {
	return {
		canvas: { width: 800, height: 600 },
		createShader: vi.fn().mockReturnValue({}),
		createProgram: vi.fn().mockReturnValue({}),
		attachShader: vi.fn(),
		shaderSource: vi.fn(),
		compileShader: vi.fn().mockReturnValue(true),
		getShaderParameter: vi.fn().mockReturnValue(true),
		getProgramParameter: vi.fn().mockReturnValue(true),
		linkProgram: vi.fn().mockReturnValue(true),
		getProgramInfoLog: vi.fn().mockReturnValue(''),
		LINK_STATUS: true,
		deleteShader: vi.fn(),
		deleteProgram: vi.fn(),
		deleteTexture: vi.fn(),
		deleteBuffer: vi.fn(),
		createTexture: vi.fn().mockReturnValue({}),
		bindTexture: vi.fn(),
		texImage2D: vi.fn(),
		texParameteri: vi.fn(),
		uniform2f: vi.fn(),
		uniform1f: vi.fn(),
		uniform1i: vi.fn(),
		uniform4f: vi.fn(),
		getUniformLocation: vi.fn().mockReturnValue({}),
		vertexAttribPointer: vi.fn(),
		enableVertexAttribArray: vi.fn(),
		createBuffer: vi.fn().mockReturnValue({}),
		bindBuffer: vi.fn(),
		bufferData: vi.fn(),
		getAttribLocation: vi.fn().mockReturnValue(0),
		useProgram: vi.fn(),
		drawArrays: vi.fn(),
		getError: vi.fn().mockReturnValue(0),
		viewport: vi.fn(),
		clearColor: vi.fn(),
		clear: vi.fn(),
		createVertexArray: vi.fn().mockReturnValue({}),
		bindVertexArray: vi.fn(),
		ARRAY_BUFFER: 0x8892,
		STATIC_DRAW: 0x88e4,
		COMPILE_STATUS: 0x8b81,
		VERTEX_SHADER: 0x8b31,
		FRAGMENT_SHADER: 0x8b30,
		TEXTURE_2D: 0x0de1,
		RGBA: 0x1908,
		UNSIGNED_BYTE: 0x1401,
		LINEAR: 0x2601,
		CLAMP_TO_EDGE: 0x812f,
		TEXTURE_MIN_FILTER: 0x2801,
		TEXTURE_MAG_FILTER: 0x2800,
		TEXTURE_WRAP_S: 0x2802,
		TEXTURE_WRAP_T: 0x2803,
		TRIANGLES: 0x0004,
		COLOR_BUFFER_BIT: 0x4000
	};
}

// Make createMockWebGL2Context available globally for tests
(globalThis as unknown as Record<string, unknown>).createMockWebGL2Context = createMockWebGL2Context;

/**
 * Mock window.matchMedia for jsdom
 * Required for prefers-reduced-motion and other media query detection
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		value: vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(), // deprecated
			removeListener: vi.fn(), // deprecated
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	});
}

/**
 * Mock crossOriginIsolated global for SharedArrayBuffer tests
 */
if (typeof globalThis.crossOriginIsolated === 'undefined') {
	Object.defineProperty(globalThis, 'crossOriginIsolated', {
		value: true, // Assume cross-origin isolated for tests
		writable: true,
		configurable: true
	});
}

/**
 * Mock WebGPU globals for tests that use WebGPU constants
 * GPUBufferUsage and GPUTextureUsage are global constants in browser environments
 */
if (typeof globalThis.GPUBufferUsage === 'undefined') {
	(globalThis as unknown as Record<string, unknown>).GPUBufferUsage = {
		MAP_READ: 0x0001,
		MAP_WRITE: 0x0002,
		COPY_SRC: 0x0004,
		COPY_DST: 0x0008,
		INDEX: 0x0010,
		VERTEX: 0x0020,
		UNIFORM: 0x0040,
		STORAGE: 0x0080,
		INDIRECT: 0x0100,
		QUERY_RESOLVE: 0x0200
	};
}

if (typeof globalThis.GPUTextureUsage === 'undefined') {
	(globalThis as unknown as Record<string, unknown>).GPUTextureUsage = {
		COPY_SRC: 0x01,
		COPY_DST: 0x02,
		TEXTURE_BINDING: 0x04,
		STORAGE_BINDING: 0x08,
		RENDER_ATTACHMENT: 0x10
	};
}

if (typeof globalThis.GPUShaderStage === 'undefined') {
	(globalThis as unknown as Record<string, unknown>).GPUShaderStage = {
		VERTEX: 0x1,
		FRAGMENT: 0x2,
		COMPUTE: 0x4
	};
}

if (typeof globalThis.GPUMapMode === 'undefined') {
	(globalThis as unknown as Record<string, unknown>).GPUMapMode = {
		READ: 0x0001,
		WRITE: 0x0002
	};
}

/**
 * Mock HTMLVideoElement for tests that check instanceof
 */
if (typeof globalThis.HTMLVideoElement === 'undefined') {
	class MockHTMLVideoElement {
		videoWidth: number = 0;
		videoHeight: number = 0;
		src: string = '';
		currentTime: number = 0;
		paused: boolean = true;

		constructor() {}

		play(): Promise<void> {
			return Promise.resolve();
		}

		pause(): void {}
	}
	(globalThis as unknown as Record<string, unknown>).HTMLVideoElement = MockHTMLVideoElement;
}

/**
 * Mock VideoFrame for tests
 */
if (typeof globalThis.VideoFrame === 'undefined') {
	class MockVideoFrame {
		displayWidth: number;
		displayHeight: number;

		constructor(source: any, options?: any) {
			this.displayWidth = options?.displayWidth ?? 0;
			this.displayHeight = options?.displayHeight ?? 0;
		}

		close(): void {}
	}
	(globalThis as unknown as Record<string, unknown>).VideoFrame = MockVideoFrame;
}
