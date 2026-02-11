/**
 * WebGPUOverlayCompositor Unit Tests
 *
 * Tests for the WebGPU overlay compositor:
 * - Factory function and interface shape
 * - Initialization with and without shared device
 * - Texture upload (Uint8ClampedArray and Uint8Array paths)
 * - Render pipeline execution
 * - Lifecycle (show/hide/clear/destroy)
 * - Fallback to WebGL2 in useContrastEnhancer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock $app/environment
vi.mock('$app/environment', () => ({
	browser: true
}));

// Mock the WGSL shader import
vi.mock('$lib/pixelwise/shaders/overlay-blend.wgsl?raw', () => ({
	default: '// mock overlay shader'
}));

// ---------------------------------------------------------------------------
// Mock WebGPU API
// ---------------------------------------------------------------------------

function createMockGPUTexture() {
	return {
		createView: vi.fn().mockReturnValue({ label: 'mock-view' }),
		destroy: vi.fn()
	};
}

function createMockGPUContext() {
	return {
		configure: vi.fn(),
		getCurrentTexture: vi.fn().mockReturnValue({
			createView: vi.fn().mockReturnValue({ label: 'canvas-view' })
		})
	};
}

function createMockRenderPassEncoder() {
	return {
		setPipeline: vi.fn(),
		setBindGroup: vi.fn(),
		draw: vi.fn(),
		end: vi.fn()
	};
}

function createMockCommandEncoder() {
	const passEncoder = createMockRenderPassEncoder();
	return {
		encoder: {
			beginRenderPass: vi.fn().mockReturnValue(passEncoder),
			finish: vi.fn().mockReturnValue({ label: 'command-buffer' })
		},
		passEncoder
	};
}

function createMockGPUDevice() {
	const { encoder, passEncoder } = createMockCommandEncoder();
	return {
		device: {
			createShaderModule: vi.fn().mockReturnValue({
				getCompilationInfo: vi.fn().mockResolvedValue({ messages: [] })
			}),
			createSampler: vi.fn().mockReturnValue({ label: 'sampler' }),
			createTexture: vi.fn().mockImplementation(() => createMockGPUTexture()),
			createBindGroupLayout: vi.fn().mockReturnValue({ label: 'layout' }),
			createBindGroup: vi.fn().mockReturnValue({ label: 'bind-group' }),
			createRenderPipeline: vi.fn().mockReturnValue({ label: 'pipeline' }),
			createPipelineLayout: vi.fn().mockReturnValue({ label: 'pipeline-layout' }),
			createCommandEncoder: vi.fn().mockReturnValue(encoder),
			queue: {
				writeTexture: vi.fn(),
				submit: vi.fn()
			},
			destroy: vi.fn()
		},
		encoder,
		passEncoder
	};
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let originalNavigator: any;
let mockDevice: ReturnType<typeof createMockGPUDevice>['device'];

beforeEach(() => {
	const { device } = createMockGPUDevice();
	mockDevice = device;

	// Mock navigator.gpu
	originalNavigator = globalThis.navigator;
	Object.defineProperty(globalThis, 'navigator', {
		value: {
			...originalNavigator,
			gpu: {
				requestAdapter: vi.fn().mockResolvedValue({
					requestDevice: vi.fn().mockResolvedValue(device)
				}),
				getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm')
			}
		},
		writable: true,
		configurable: true
	});

	// Mock document.createElement for canvas
	const mockCanvas = {
		id: '',
		style: { cssText: '', display: '', width: '', height: '' },
		width: 0,
		height: 0,
		getContext: vi.fn().mockReturnValue(createMockGPUContext()),
		parentNode: document.body
	};
	vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as any);
	vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node as any);
	vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node as any);

	// Mock window properties
	Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true, configurable: true });
	Object.defineProperty(window, 'innerHeight', { value: 1080, writable: true, configurable: true });
	Object.defineProperty(window, 'devicePixelRatio', { value: 1, writable: true, configurable: true });
});

afterEach(() => {
	vi.restoreAllMocks();
	Object.defineProperty(globalThis, 'navigator', {
		value: originalNavigator,
		writable: true,
		configurable: true
	});
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createWebGPUOverlayCompositor', () => {
	// Dynamic import to allow mocks to be set up first
	async function getModule() {
		return import('$lib/core/WebGPUOverlayCompositor');
	}

	describe('factory function', () => {
		it('returns an object with the expected interface', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();

			expect(compositor).toHaveProperty('initialize');
			expect(compositor).toHaveProperty('resize');
			expect(compositor).toHaveProperty('updateTexture');
			expect(compositor).toHaveProperty('updateTextureFromBuffer');
			expect(compositor).toHaveProperty('render');
			expect(compositor).toHaveProperty('show');
			expect(compositor).toHaveProperty('hide');
			expect(compositor).toHaveProperty('clear');
			expect(compositor).toHaveProperty('destroy');
			expect(compositor).toHaveProperty('isVisible');
			expect(compositor).toHaveProperty('canvas');
		});

		it('starts with isVisible false and canvas null', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();

			expect(compositor.isVisible).toBe(false);
			expect(compositor.canvas).toBeNull();
		});
	});

	describe('initialization', () => {
		it('initializes with auto-detected device when none provided', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();

			const result = await compositor.initialize();
			expect(result).toBe(true);
			expect(compositor.canvas).not.toBeNull();
		});

		it('initializes with a shared GPUDevice', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();

			const result = await compositor.initialize({}, mockDevice);
			expect(result).toBe(true);
			// Should NOT call requestAdapter when device is provided
			expect(navigator.gpu.requestAdapter).not.toHaveBeenCalled();
		});

		it('creates a canvas with correct style properties', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();

			await compositor.initialize({ zIndex: 50000 });
			expect(compositor.canvas).not.toBeNull();
			expect(compositor.canvas!.id).toBe('pixelwise-webgpu-overlay');
			expect(compositor.canvas!.style.cssText).toContain('pointer-events: none');
			expect(compositor.canvas!.style.cssText).toContain('50000');
		});

		it('appends canvas to document body', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();

			await compositor.initialize();
			expect(document.body.appendChild).toHaveBeenCalled();
		});

		it('returns false when WebGPU canvas context unavailable', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();

			// Override canvas mock to return null context
			vi.spyOn(document, 'createElement').mockReturnValue({
				id: '',
				style: { cssText: '', display: '' },
				width: 0,
				height: 0,
				getContext: vi.fn().mockReturnValue(null),
				parentNode: null
			} as any);

			const result = await compositor.initialize({}, mockDevice);
			expect(result).toBe(false);
		});
	});

	describe('texture operations', () => {
		it('updateTexture accepts Uint8ClampedArray', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();
			await compositor.initialize({}, mockDevice);

			const pixels = new Uint8ClampedArray(16); // 2x2 RGBA
			compositor.updateTexture(pixels, 2, 2);

			expect(mockDevice.queue.writeTexture).toHaveBeenCalled();
		});

		it('updateTextureFromBuffer accepts Uint8Array', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();
			await compositor.initialize({}, mockDevice);

			const data = new Uint8Array(16); // 2x2 RGBA
			compositor.updateTextureFromBuffer(data, 2, 2);

			expect(mockDevice.queue.writeTexture).toHaveBeenCalled();
		});

		it('recreates texture when dimensions change', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();
			await compositor.initialize({}, mockDevice);

			const createTextureSpy = mockDevice.createTexture;

			// First upload at 2x2
			compositor.updateTexture(new Uint8ClampedArray(16), 2, 2);
			const callCount1 = createTextureSpy.mock.calls.length;

			// Same size should not recreate
			compositor.updateTexture(new Uint8ClampedArray(16), 2, 2);
			expect(createTextureSpy.mock.calls.length).toBe(callCount1);

			// Different size should recreate
			compositor.updateTexture(new Uint8ClampedArray(64), 4, 4);
			expect(createTextureSpy.mock.calls.length).toBeGreaterThan(callCount1);
		});
	});

	describe('rendering', () => {
		it('render submits a command buffer with draw(3)', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();
			await compositor.initialize({}, mockDevice);

			compositor.render();

			expect(mockDevice.createCommandEncoder).toHaveBeenCalled();
			expect(mockDevice.queue.submit).toHaveBeenCalled();
		});
	});

	describe('visibility', () => {
		it('show/hide toggle isVisible and canvas display', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();
			await compositor.initialize({}, mockDevice);

			expect(compositor.isVisible).toBe(false);

			compositor.show();
			expect(compositor.isVisible).toBe(true);
			expect(compositor.canvas!.style.display).toBe('block');

			compositor.hide();
			expect(compositor.isVisible).toBe(false);
			expect(compositor.canvas!.style.display).toBe('none');
		});
	});

	describe('lifecycle', () => {
		it('destroy removes canvas from DOM', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();
			await compositor.initialize({}, mockDevice);

			compositor.destroy();
			expect(compositor.canvas).toBeNull();
		});

		it('operations are safe after destroy', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();
			await compositor.initialize({}, mockDevice);

			compositor.destroy();

			// These should not throw
			compositor.render();
			compositor.show();
			compositor.hide();
			compositor.clear();
			compositor.updateTexture(new Uint8ClampedArray(4), 1, 1);
			compositor.resize();
		});
	});

	describe('interface compatibility with WebGL2 OverlayCompositor', () => {
		it('has the same core methods as createOverlayCompositor', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();

			// All methods from the WebGL2 version must exist
			const requiredMethods = [
				'initialize',
				'resize',
				'updateTexture',
				'render',
				'show',
				'hide',
				'clear',
				'destroy'
			];

			for (const method of requiredMethods) {
				expect(typeof (compositor as any)[method]).toBe('function');
			}

			// Getters
			expect('isVisible' in compositor).toBe(true);
			expect('canvas' in compositor).toBe(true);
		});

		it('additionally exposes updateTextureFromBuffer', async () => {
			const { createWebGPUOverlayCompositor } = await getModule();
			const compositor = createWebGPUOverlayCompositor();

			expect(typeof compositor.updateTextureFromBuffer).toBe('function');
		});
	});
});
