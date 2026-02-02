/**
 * BufferRing Tests
 *
 * Tests for the triple-buffer frame pipeline.
 *
 * These tests use a mock GPUDevice to avoid requiring actual WebGPU.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock GPUDevice and related types
function createMockGPUDevice() {
	const buffers: any[] = [];
	const textures: any[] = [];

	return {
		createBuffer: vi.fn((descriptor: any) => {
			const buffer = {
				label: descriptor.label,
				size: descriptor.size,
				usage: descriptor.usage,
				destroy: vi.fn()
			};
			buffers.push(buffer);
			return buffer;
		}),
		createTexture: vi.fn((descriptor: any) => {
			const texture = {
				label: descriptor.label,
				width: descriptor.size[0],
				height: descriptor.size[1],
				format: descriptor.format,
				usage: descriptor.usage,
				destroy: vi.fn()
			};
			textures.push(texture);
			return texture;
		}),
		_buffers: buffers,
		_textures: textures
	} as unknown as GPUDevice;
}

// Mock the $app/environment module
vi.mock('$app/environment', () => ({
	browser: true
}));

describe('BufferRing', () => {
	let mockDevice: GPUDevice;

	beforeEach(() => {
		mockDevice = createMockGPUDevice();
	});

	describe('construction', () => {
		it('should create buffer ring with default config', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 1920, 1080);

			expect(ring.size).toBe(3); // Default triple buffering
			expect(ring.dimensions.width).toBe(1920);
			expect(ring.dimensions.height).toBe(1080);
			expect(ring.totalFrames).toBe(0);
		});

		it('should create specified number of frame buffers', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600, { frameCount: 4 });

			expect(ring.size).toBe(4);
		});

		it('should allocate GPU buffers for each frame', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			new BufferRing(mockDevice, 800, 600, { frameCount: 2 });

			// Each frame needs: grayscale, gradientX, gradientY, esdtData,
			// glyphPixels, pixelCount, backgroundSamples, contrastAnalyses
			// = 8 buffers per frame + 1 texture = 9 allocations per frame
			expect(mockDevice.createBuffer).toHaveBeenCalled();
			expect(mockDevice.createTexture).toHaveBeenCalled();
		});
	});

	describe('getNextForCapture', () => {
		it('should return idle buffer when available', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600);

			const buffer1 = ring.getNextForCapture();

			expect(buffer1.status).toBe('capturing');
			expect(buffer1.frameNumber).toBe(1);
		});

		it('should increment frame counter', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600);

			ring.getNextForCapture();
			expect(ring.totalFrames).toBe(1);

			ring.getNextForCapture();
			expect(ring.totalFrames).toBe(2);

			ring.getNextForCapture();
			expect(ring.totalFrames).toBe(3);
		});

		it('should cycle through buffers', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600, { frameCount: 3 });

			const buffer1 = ring.getNextForCapture();
			const buffer2 = ring.getNextForCapture();
			const buffer3 = ring.getNextForCapture();

			expect(buffer1.index).toBe(0);
			expect(buffer2.index).toBe(1);
			expect(buffer3.index).toBe(2);
		});

		it('should reuse oldest buffer when all are busy', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600, { frameCount: 2 });

			const buffer1 = ring.getNextForCapture();
			buffer1.status = 'processing';

			const buffer2 = ring.getNextForCapture();
			buffer2.status = 'processing';

			// All buffers busy, should reuse
			const buffer3 = ring.getNextForCapture();

			// Should have reused one of the existing buffers
			expect(buffer3.index === 0 || buffer3.index === 1).toBe(true);
			expect(buffer3.status).toBe('capturing');
		});
	});

	describe('getReady', () => {
		it('should return null when no buffers are ready', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600);

			expect(ring.getReady()).toBeNull();
		});

		it('should return ready buffer', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600);

			const buffer = ring.getNextForCapture();
			ring.markReady(buffer);

			const ready = ring.getReady();

			expect(ready).toBe(buffer);
			expect(ready?.status).toBe('ready');
		});

		it('should return oldest ready buffer first', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600, { frameCount: 3 });

			const buffer1 = ring.getNextForCapture();
			const buffer2 = ring.getNextForCapture();
			const buffer3 = ring.getNextForCapture();

			// Mark out of order
			ring.markReady(buffer3);
			ring.markReady(buffer1);
			ring.markReady(buffer2);

			// Should return buffer1 (lowest frame number)
			const ready = ring.getReady();
			expect(ready).toBe(buffer1);
		});
	});

	describe('getAllReady', () => {
		it('should return empty array when no buffers ready', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600);

			expect(ring.getAllReady()).toEqual([]);
		});

		it('should return all ready buffers sorted by frame number', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600, { frameCount: 3 });

			const buffer1 = ring.getNextForCapture();
			const buffer2 = ring.getNextForCapture();
			const buffer3 = ring.getNextForCapture();

			ring.markReady(buffer3);
			ring.markReady(buffer1);

			const ready = ring.getAllReady();

			expect(ready.length).toBe(2);
			expect(ready[0]).toBe(buffer1); // Frame 1
			expect(ready[1]).toBe(buffer3); // Frame 3
		});
	});

	describe('status management', () => {
		it('should mark buffer as idle', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600);
			const buffer = ring.getNextForCapture();

			ring.markIdle(buffer);

			expect(buffer.status).toBe('idle');
		});

		it('should mark buffer as processing', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600);
			const buffer = ring.getNextForCapture();

			ring.markProcessing(buffer);

			expect(buffer.status).toBe('processing');
		});

		it('should mark buffer as error', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600);
			const buffer = ring.getNextForCapture();

			ring.markError(buffer, 'Test error');

			expect(buffer.status).toBe('error');
			expect(buffer.error).toBe('Test error');
		});
	});

	describe('getBuffer', () => {
		it('should return buffer by index', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600, { frameCount: 3 });

			const buffer0 = ring.getBuffer(0);
			const buffer1 = ring.getBuffer(1);
			const buffer2 = ring.getBuffer(2);

			expect(buffer0?.index).toBe(0);
			expect(buffer1?.index).toBe(1);
			expect(buffer2?.index).toBe(2);
		});

		it('should return null for invalid index', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600, { frameCount: 2 });

			expect(ring.getBuffer(5)).toBeNull();
			expect(ring.getBuffer(-1)).toBeNull();
		});
	});

	describe('getStatus', () => {
		it('should return status of all buffers', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600, { frameCount: 2 });

			const status = ring.getStatus();

			expect(status.length).toBe(2);
			expect(status[0]).toEqual({ index: 0, status: 'idle', frameNumber: -1 });
			expect(status[1]).toEqual({ index: 1, status: 'idle', frameNumber: -1 });
		});
	});

	describe('getStatusCounts', () => {
		it('should count buffers by status', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600, { frameCount: 3 });

			const counts = ring.getStatusCounts();

			expect(counts.idle).toBe(3);
			expect(counts.capturing).toBe(0);
			expect(counts.processing).toBe(0);
			expect(counts.ready).toBe(0);
			expect(counts.error).toBe(0);
		});

		it('should track status changes', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600, { frameCount: 3 });

			const buffer1 = ring.getNextForCapture();
			ring.markProcessing(buffer1);

			const buffer2 = ring.getNextForCapture();
			ring.markReady(buffer2);

			const counts = ring.getStatusCounts();

			expect(counts.idle).toBe(1);
			expect(counts.capturing).toBe(0);
			expect(counts.processing).toBe(1);
			expect(counts.ready).toBe(1);
		});
	});

	describe('reset', () => {
		it('should reset all buffers to idle', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600, { frameCount: 2 });

			const buffer1 = ring.getNextForCapture();
			ring.markReady(buffer1);

			const buffer2 = ring.getNextForCapture();
			ring.markError(buffer2, 'test');

			ring.reset();

			const counts = ring.getStatusCounts();
			expect(counts.idle).toBe(2);
			expect(ring.totalFrames).toBe(0);
		});
	});

	describe('destroy', () => {
		it('should destroy all GPU resources', async () => {
			const { BufferRing } = await import('$lib/capture/BufferRing');

			const ring = new BufferRing(mockDevice, 800, 600, { frameCount: 2 });

			const buffer0 = ring.getBuffer(0)!;
			const buffer1 = ring.getBuffer(1)!;

			ring.destroy();

			// Check that destroy was called on buffers and textures
			expect(buffer0.grayscale.destroy).toHaveBeenCalled();
			expect(buffer0.outputTexture.destroy).toHaveBeenCalled();
			expect(buffer1.grayscale.destroy).toHaveBeenCalled();
			expect(buffer1.outputTexture.destroy).toHaveBeenCalled();
		});
	});
});

describe('createBufferRing', () => {
	it('should create BufferRing instance', async () => {
		const mockDevice = createMockGPUDevice();
		const { createBufferRing, BufferRing } = await import('$lib/capture/BufferRing');

		const ring = createBufferRing(mockDevice, 1920, 1080);

		expect(ring).toBeInstanceOf(BufferRing);
	});
});

describe('DEFAULT_RING_CONFIG', () => {
	it('should have sensible defaults', async () => {
		const { DEFAULT_RING_CONFIG } = await import('$lib/capture/BufferRing');

		expect(DEFAULT_RING_CONFIG.frameCount).toBe(3);
		expect(DEFAULT_RING_CONFIG.maxGlyphPixels).toBe(100000);
	});
});
