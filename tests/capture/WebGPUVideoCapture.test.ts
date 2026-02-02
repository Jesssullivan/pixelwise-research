/**
 * WebGPUVideoCapture Tests
 *
 * Tests for the WebGPU video frame import system.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock GPUDevice
function createMockGPUDevice(hasExternalTexture = true) {
	const mockExternalTexture = { type: 'external' };
	const mockTexture = {
		createView: vi.fn(() => ({ type: 'view' })),
		destroy: vi.fn()
	};
	const mockSampler = { type: 'sampler' };
	const mockBindGroup = { type: 'bindGroup' };
	const mockBindGroupLayout = { type: 'layout' };

	return {
		createSampler: vi.fn(() => mockSampler),
		createTexture: vi.fn(() => mockTexture),
		createBindGroup: vi.fn(() => mockBindGroup),
		createBindGroupLayout: vi.fn(() => mockBindGroupLayout),
		importExternalTexture: hasExternalTexture ? vi.fn(() => mockExternalTexture) : undefined,
		queue: {
			copyExternalImageToTexture: vi.fn()
		},
		_mockExternalTexture: mockExternalTexture,
		_mockTexture: mockTexture,
		_mockSampler: mockSampler
	} as unknown as GPUDevice;
}

// Mock the $app/environment module
vi.mock('$app/environment', () => ({
	browser: true
}));

describe('WebGPUVideoCapture', () => {
	let mockDevice: GPUDevice;

	beforeEach(() => {
		// Set up global mocks
		Object.defineProperty(global, 'GPUDevice', {
			value: {
				prototype: {
					importExternalTexture: vi.fn()
				}
			},
			writable: true
		});

		Object.defineProperty(global, 'GPUQueue', {
			value: {
				prototype: {
					copyExternalImageToTexture: vi.fn()
				}
			},
			writable: true
		});

		mockDevice = createMockGPUDevice(true);
	});

	describe('construction', () => {
		it('should create instance with sampler', async () => {
			const { WebGPUVideoCapture } = await import('$lib/capture/WebGPUVideoCapture');

			const capture = new WebGPUVideoCapture(mockDevice);

			expect(capture.videoSampler).toBeDefined();
			expect(mockDevice.createSampler).toHaveBeenCalledWith(
				expect.objectContaining({
					magFilter: 'linear',
					minFilter: 'linear'
				})
			);
		});

		it('should detect capabilities', async () => {
			const { WebGPUVideoCapture } = await import('$lib/capture/WebGPUVideoCapture');

			const capture = new WebGPUVideoCapture(mockDevice);

			expect(capture.capabilities).toBeDefined();
			expect(typeof capture.capabilities.webgpu).toBe('boolean');
			expect(typeof capture.capabilities.importExternalTexture).toBe('boolean');
			expect(typeof capture.capabilities.copyExternalImage).toBe('boolean');
		});
	});

	describe('isExternalTextureSupported', () => {
		it('should return true when importExternalTexture exists on prototype', async () => {
			Object.defineProperty(global, 'GPUDevice', {
				value: {
					prototype: {
						importExternalTexture: vi.fn()
					}
				},
				writable: true
			});

			const { WebGPUVideoCapture } = await import('$lib/capture/WebGPUVideoCapture');

			expect(WebGPUVideoCapture.isExternalTextureSupported()).toBe(true);
		});
	});

	describe('importFrame', () => {
		it('should throw error for zero-dimension video', async () => {
			const { WebGPUVideoCapture } = await import('$lib/capture/WebGPUVideoCapture');

			const capture = new WebGPUVideoCapture(mockDevice);

			const mockVideo = {
				videoWidth: 0,
				videoHeight: 0
			} as HTMLVideoElement;

			expect(() => capture.importFrame(mockVideo)).toThrow('Video source has zero dimensions');
		});
	});

	describe('createBindGroupLayout', () => {
		it('should create layout for external texture', async () => {
			const { WebGPUVideoCapture } = await import('$lib/capture/WebGPUVideoCapture');

			const capture = new WebGPUVideoCapture(mockDevice);

			const layout = capture.createBindGroupLayout(true);

			expect(mockDevice.createBindGroupLayout).toHaveBeenCalledWith(
				expect.objectContaining({
					entries: expect.arrayContaining([
						expect.objectContaining({ binding: 0, sampler: expect.any(Object) }),
						expect.objectContaining({ binding: 1, externalTexture: expect.any(Object) })
					])
				})
			);
		});

		it('should create layout for regular texture', async () => {
			const { WebGPUVideoCapture } = await import('$lib/capture/WebGPUVideoCapture');

			const capture = new WebGPUVideoCapture(mockDevice);

			const layout = capture.createBindGroupLayout(false);

			expect(mockDevice.createBindGroupLayout).toHaveBeenCalledWith(
				expect.objectContaining({
					entries: expect.arrayContaining([
						expect.objectContaining({ binding: 0, sampler: expect.any(Object) }),
						expect.objectContaining({ binding: 1, texture: expect.any(Object) })
					])
				})
			);
		});

		it('should include additional entries', async () => {
			const { WebGPUVideoCapture } = await import('$lib/capture/WebGPUVideoCapture');

			const capture = new WebGPUVideoCapture(mockDevice);

			const additionalEntries = [
				{
					binding: 2,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'storage' as GPUBufferBindingType }
				}
			];

			capture.createBindGroupLayout(true, additionalEntries);

			expect(mockDevice.createBindGroupLayout).toHaveBeenCalledWith(
				expect.objectContaining({
					entries: expect.arrayContaining([
						expect.objectContaining({ binding: 2 })
					])
				})
			);
		});
	});

	describe('copyToTexture', () => {
		it('should create texture on first call', async () => {
			const { WebGPUVideoCapture } = await import('$lib/capture/WebGPUVideoCapture');

			const capture = new WebGPUVideoCapture(mockDevice);

			const mockVideo = {
				videoWidth: 1920,
				videoHeight: 1080
			} as HTMLVideoElement;

			capture.copyToTexture(mockVideo, 1920, 1080);

			expect(mockDevice.createTexture).toHaveBeenCalledWith(
				expect.objectContaining({
					size: [1920, 1080],
					format: 'rgba8unorm'
				})
			);

			expect(mockDevice.queue.copyExternalImageToTexture).toHaveBeenCalled();
		});

		it('should reuse texture for same dimensions', async () => {
			const { WebGPUVideoCapture } = await import('$lib/capture/WebGPUVideoCapture');

			const capture = new WebGPUVideoCapture(mockDevice);

			const mockVideo = {
				videoWidth: 800,
				videoHeight: 600
			} as HTMLVideoElement;

			capture.copyToTexture(mockVideo, 800, 600);
			capture.copyToTexture(mockVideo, 800, 600);

			// Should only create texture once
			expect(mockDevice.createTexture).toHaveBeenCalledTimes(1);
		});

		it('should recreate texture for different dimensions', async () => {
			const { WebGPUVideoCapture } = await import('$lib/capture/WebGPUVideoCapture');

			const capture = new WebGPUVideoCapture(mockDevice);

			const mockVideo1 = {
				videoWidth: 800,
				videoHeight: 600
			} as HTMLVideoElement;

			const mockVideo2 = {
				videoWidth: 1920,
				videoHeight: 1080
			} as HTMLVideoElement;

			capture.copyToTexture(mockVideo1, 800, 600);
			capture.copyToTexture(mockVideo2, 1920, 1080);

			// Should create texture twice (different dimensions)
			expect(mockDevice.createTexture).toHaveBeenCalledTimes(2);
		});
	});

	describe('destroy', () => {
		it('should clean up fallback texture', async () => {
			const { WebGPUVideoCapture } = await import('$lib/capture/WebGPUVideoCapture');

			const capture = new WebGPUVideoCapture(mockDevice);

			// Create a fallback texture
			const mockVideo = {
				videoWidth: 800,
				videoHeight: 600
			} as HTMLVideoElement;
			capture.copyToTexture(mockVideo, 800, 600);

			// Get reference to created texture
			const createdTexture = (mockDevice.createTexture as any).mock.results[0].value;

			capture.destroy();

			expect(createdTexture.destroy).toHaveBeenCalled();
		});
	});
});

describe('isVideoCaptureSupported', () => {
	it('should return true when either import method is available', async () => {
		Object.defineProperty(global, 'GPUDevice', {
			value: {
				prototype: {
					importExternalTexture: vi.fn()
				}
			},
			writable: true
		});

		const { isVideoCaptureSupported } = await import('$lib/capture/WebGPUVideoCapture');

		expect(isVideoCaptureSupported()).toBe(true);
	});
});

describe('createWebGPUVideoCapture', () => {
	it('should create WebGPUVideoCapture instance', async () => {
		const mockDevice = createMockGPUDevice();
		const { createWebGPUVideoCapture, WebGPUVideoCapture } = await import(
			'$lib/capture/WebGPUVideoCapture'
		);

		const capture = createWebGPUVideoCapture(mockDevice);

		expect(capture).toBeInstanceOf(WebGPUVideoCapture);
	});
});
