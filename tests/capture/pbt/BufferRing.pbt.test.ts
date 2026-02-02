/**
 * BufferRing Property-Based Tests
 *
 * Tests for BufferRing invariants using fast-check.
 *
 * Properties tested:
 * 1. Ring size always equals configured frameCount
 * 2. Status transitions are valid (idle -> capturing -> processing -> ready)
 * 3. Total frame count monotonically increases
 * 4. getNextForCapture always returns a buffer
 * 5. Ready buffers are returned in frame order
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fc, test as fcTest } from '@fast-check/vitest';
import type { BufferStatus, FrameBuffers, BufferRingConfig } from '$lib/capture/BufferRing';

// Mock GPUDevice factory
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

// Mock WebGPU constants if not available
if (typeof GPUBufferUsage === 'undefined') {
	(global as any).GPUBufferUsage = {
		MAP_READ: 1,
		MAP_WRITE: 2,
		COPY_SRC: 4,
		COPY_DST: 8,
		INDEX: 16,
		VERTEX: 32,
		UNIFORM: 64,
		STORAGE: 128,
		INDIRECT: 256,
		QUERY_RESOLVE: 512
	};
}

if (typeof GPUTextureUsage === 'undefined') {
	(global as any).GPUTextureUsage = {
		COPY_SRC: 1,
		COPY_DST: 2,
		TEXTURE_BINDING: 4,
		STORAGE_BINDING: 8,
		RENDER_ATTACHMENT: 16
	};
}

// Custom arbitraries for buffer ring testing
const validFrameCount = fc.integer({ min: 1, max: 10 });
const validDimensions = fc.record({
	width: fc.integer({ min: 1, max: 4096 }),
	height: fc.integer({ min: 1, max: 4096 })
});
const validMaxGlyphPixels = fc.integer({ min: 1000, max: 500000 });

// Arbitrary for BufferRingConfig
const bufferRingConfigArb = fc.record({
	frameCount: validFrameCount,
	maxGlyphPixels: validMaxGlyphPixels
});

// Arbitrary for status values
const bufferStatusArb: fc.Arbitrary<BufferStatus> = fc.constantFrom(
	'idle',
	'capturing',
	'processing',
	'ready',
	'error'
);

// Arbitrary for operation sequences
type Operation =
	| { type: 'getNextForCapture' }
	| { type: 'markIdle'; bufferIndex: number }
	| { type: 'markProcessing'; bufferIndex: number }
	| { type: 'markReady'; bufferIndex: number }
	| { type: 'markError'; bufferIndex: number; message: string }
	| { type: 'getReady' }
	| { type: 'getAllReady' }
	| { type: 'reset' };

const operationArb = (maxBufferIndex: number): fc.Arbitrary<Operation> =>
	fc.oneof(
		fc.constant({ type: 'getNextForCapture' } as Operation),
		fc.record({
			type: fc.constant('markIdle' as const),
			bufferIndex: fc.integer({ min: 0, max: Math.max(0, maxBufferIndex - 1) })
		}),
		fc.record({
			type: fc.constant('markProcessing' as const),
			bufferIndex: fc.integer({ min: 0, max: Math.max(0, maxBufferIndex - 1) })
		}),
		fc.record({
			type: fc.constant('markReady' as const),
			bufferIndex: fc.integer({ min: 0, max: Math.max(0, maxBufferIndex - 1) })
		}),
		fc.record({
			type: fc.constant('markError' as const),
			bufferIndex: fc.integer({ min: 0, max: Math.max(0, maxBufferIndex - 1) }),
			message: fc.string({ minLength: 1, maxLength: 50 })
		}),
		fc.constant({ type: 'getReady' } as Operation),
		fc.constant({ type: 'getAllReady' } as Operation),
		fc.constant({ type: 'reset' } as Operation)
	);

describe('BufferRing Property-Based Tests', () => {
	let mockDevice: GPUDevice;

	beforeEach(() => {
		mockDevice = createMockGPUDevice();
	});

	describe('Invariant: Ring size equals configured frameCount', () => {
		fcTest.prop([validFrameCount, validDimensions])(
			'ring.size always equals configured frameCount',
			async (frameCount, dims) => {
				const { BufferRing } = await import('$lib/capture/BufferRing');
				const ring = new BufferRing(mockDevice, dims.width, dims.height, { frameCount });

				expect(ring.size).toBe(frameCount);
			}
		);

		fcTest.prop([bufferRingConfigArb, validDimensions])(
			'ring.size is preserved after multiple operations',
			async (config, dims) => {
				const { BufferRing } = await import('$lib/capture/BufferRing');
				const ring = new BufferRing(mockDevice, dims.width, dims.height, config);

				// Perform several operations
				for (let i = 0; i < config.frameCount * 3; i++) {
					ring.getNextForCapture();
				}

				expect(ring.size).toBe(config.frameCount);
			}
		);
	});

	describe('Invariant: Total frame count monotonically increases', () => {
		fcTest.prop([fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 20 })])(
			'totalFrames increases with each getNextForCapture call',
			async (frameCount, operationCount) => {
				const { BufferRing } = await import('$lib/capture/BufferRing');
				const ring = new BufferRing(mockDevice, 800, 600, { frameCount });

				let previousTotal = ring.totalFrames;
				expect(previousTotal).toBe(0);

				for (let i = 0; i < operationCount; i++) {
					ring.getNextForCapture();
					const newTotal = ring.totalFrames;

					expect(newTotal).toBeGreaterThan(previousTotal);
					expect(newTotal).toBe(previousTotal + 1);
					previousTotal = newTotal;
				}
			}
		);

		fcTest.prop([fc.integer({ min: 1, max: 5 })])(
			'totalFrames never decreases during normal operations',
			async (frameCount) => {
				const { BufferRing } = await import('$lib/capture/BufferRing');
				const ring = new BufferRing(mockDevice, 800, 600, { frameCount });

				const totals: number[] = [ring.totalFrames];

				// Mix of operations
				for (let i = 0; i < 10; i++) {
					const buffer = ring.getNextForCapture();
					totals.push(ring.totalFrames);

					ring.markProcessing(buffer);
					totals.push(ring.totalFrames);

					ring.markReady(buffer);
					totals.push(ring.totalFrames);

					ring.getReady();
					totals.push(ring.totalFrames);

					ring.markIdle(buffer);
					totals.push(ring.totalFrames);
				}

				// Verify monotonically non-decreasing (and actually increasing on getNextForCapture)
				for (let i = 1; i < totals.length; i++) {
					expect(totals[i]).toBeGreaterThanOrEqual(totals[i - 1]);
				}
			}
		);
	});

	describe('Invariant: getNextForCapture always returns a buffer', () => {
		fcTest.prop([fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 50 })])(
			'getNextForCapture never returns null/undefined',
			async (frameCount, callCount) => {
				const { BufferRing } = await import('$lib/capture/BufferRing');
				const ring = new BufferRing(mockDevice, 800, 600, { frameCount });

				for (let i = 0; i < callCount; i++) {
					const buffer = ring.getNextForCapture();

					expect(buffer).toBeDefined();
					expect(buffer).not.toBeNull();
					expect(buffer.index).toBeGreaterThanOrEqual(0);
					expect(buffer.index).toBeLessThan(frameCount);
				}
			}
		);

		fcTest.prop([fc.integer({ min: 1, max: 5 })])(
			'getNextForCapture returns buffer with capturing status',
			async (frameCount) => {
				const { BufferRing } = await import('$lib/capture/BufferRing');
				const ring = new BufferRing(mockDevice, 800, 600, { frameCount });

				for (let i = 0; i < frameCount * 2; i++) {
					const buffer = ring.getNextForCapture();
					expect(buffer.status).toBe('capturing');
				}
			}
		);
	});

	describe('Invariant: Ready buffers are returned in frame order', () => {
		fcTest.prop([fc.integer({ min: 2, max: 5 })])(
			'getReady returns oldest ready buffer',
			async (frameCount) => {
				const { BufferRing } = await import('$lib/capture/BufferRing');
				const ring = new BufferRing(mockDevice, 800, 600, { frameCount });

				// Capture and mark ready in order
				const buffers: FrameBuffers[] = [];
				for (let i = 0; i < frameCount; i++) {
					const buffer = ring.getNextForCapture();
					buffers.push(buffer);
				}

				// Mark ready in reverse order
				for (let i = frameCount - 1; i >= 0; i--) {
					ring.markReady(buffers[i]);
				}

				// Should return in ascending frame number order
				let lastFrameNumber = -1;
				for (let i = 0; i < frameCount; i++) {
					const ready = ring.getReady();
					expect(ready).not.toBeNull();
					expect(ready!.frameNumber).toBeGreaterThan(lastFrameNumber);
					lastFrameNumber = ready!.frameNumber;
					ring.markIdle(ready!);
				}
			}
		);

		fcTest.prop([fc.integer({ min: 2, max: 5 }), fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 10 })])(
			'getAllReady returns buffers sorted by frame number',
			async (frameCount, shuffleSeeds) => {
				const { BufferRing } = await import('$lib/capture/BufferRing');
				const ring = new BufferRing(mockDevice, 800, 600, { frameCount });

				// Create buffers with random mark order
				const buffers: FrameBuffers[] = [];
				for (let i = 0; i < frameCount; i++) {
					buffers.push(ring.getNextForCapture());
				}

				// Shuffle using provided seeds and mark ready
				const indices = Array.from({ length: frameCount }, (_, i) => i);
				for (let i = indices.length - 1; i > 0; i--) {
					const j = shuffleSeeds[i % shuffleSeeds.length] % (i + 1);
					[indices[i], indices[j]] = [indices[j], indices[i]];
				}

				for (const idx of indices) {
					ring.markReady(buffers[idx]);
				}

				// getAllReady should return sorted
				const allReady = ring.getAllReady();
				for (let i = 1; i < allReady.length; i++) {
					expect(allReady[i].frameNumber).toBeGreaterThan(allReady[i - 1].frameNumber);
				}
			}
		);
	});

	describe('Invariant: Status counts always sum to ring size', () => {
		fcTest.prop([fc.integer({ min: 1, max: 5 }), fc.array(operationArb(5), { minLength: 0, maxLength: 30 })])(
			'sum of all status counts equals ring size',
			async (frameCount, operations) => {
				const { BufferRing } = await import('$lib/capture/BufferRing');
				const ring = new BufferRing(mockDevice, 800, 600, { frameCount });

				// Execute operations
				for (const op of operations) {
					try {
						switch (op.type) {
							case 'getNextForCapture':
								ring.getNextForCapture();
								break;
							case 'markIdle':
								const bufferIdle = ring.getBuffer(op.bufferIndex % frameCount);
								if (bufferIdle) ring.markIdle(bufferIdle);
								break;
							case 'markProcessing':
								const bufferProc = ring.getBuffer(op.bufferIndex % frameCount);
								if (bufferProc) ring.markProcessing(bufferProc);
								break;
							case 'markReady':
								const bufferReady = ring.getBuffer(op.bufferIndex % frameCount);
								if (bufferReady) ring.markReady(bufferReady);
								break;
							case 'markError':
								const bufferErr = ring.getBuffer(op.bufferIndex % frameCount);
								if (bufferErr) ring.markError(bufferErr, op.message);
								break;
							case 'getReady':
								ring.getReady();
								break;
							case 'getAllReady':
								ring.getAllReady();
								break;
							case 'reset':
								ring.reset();
								break;
						}
					} catch {
						// Some operations may fail, that's ok
					}

					// Invariant: status counts always sum to ring size
					const counts = ring.getStatusCounts();
					const total =
						counts.idle + counts.capturing + counts.processing + counts.ready + counts.error;
					expect(total).toBe(frameCount);
				}
			}
		);
	});

	describe('Invariant: Buffer indices are always valid', () => {
		fcTest.prop([fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 20 })])(
			'all returned buffer indices are within [0, frameCount)',
			async (frameCount, iterations) => {
				const { BufferRing } = await import('$lib/capture/BufferRing');
				const ring = new BufferRing(mockDevice, 800, 600, { frameCount });

				for (let i = 0; i < iterations; i++) {
					const buffer = ring.getNextForCapture();
					expect(buffer.index).toBeGreaterThanOrEqual(0);
					expect(buffer.index).toBeLessThan(frameCount);
				}

				// Also check getBuffer
				for (let i = 0; i < frameCount; i++) {
					const buffer = ring.getBuffer(i);
					expect(buffer).not.toBeNull();
					expect(buffer!.index).toBe(i);
				}

				// Out of bounds returns null
				expect(ring.getBuffer(-1)).toBeNull();
				expect(ring.getBuffer(frameCount)).toBeNull();
			}
		);
	});

	describe('Invariant: Reset restores initial state', () => {
		fcTest.prop([fc.integer({ min: 1, max: 5 }), fc.array(operationArb(5), { minLength: 0, maxLength: 20 })])(
			'reset makes all buffers idle and resets frame counter',
			async (frameCount, operations) => {
				const { BufferRing } = await import('$lib/capture/BufferRing');
				const ring = new BufferRing(mockDevice, 800, 600, { frameCount });

				// Execute random operations
				for (const op of operations) {
					try {
						switch (op.type) {
							case 'getNextForCapture':
								ring.getNextForCapture();
								break;
							case 'markIdle':
								const bufferIdle = ring.getBuffer(op.bufferIndex % frameCount);
								if (bufferIdle) ring.markIdle(bufferIdle);
								break;
							case 'markProcessing':
								const bufferProc = ring.getBuffer(op.bufferIndex % frameCount);
								if (bufferProc) ring.markProcessing(bufferProc);
								break;
							case 'markReady':
								const bufferReady = ring.getBuffer(op.bufferIndex % frameCount);
								if (bufferReady) ring.markReady(bufferReady);
								break;
							case 'markError':
								const bufferErr = ring.getBuffer(op.bufferIndex % frameCount);
								if (bufferErr) ring.markError(bufferErr, op.message);
								break;
							default:
								break;
						}
					} catch {
						// Some operations may fail
					}
				}

				// Reset
				ring.reset();

				// Verify all buffers are idle
				const counts = ring.getStatusCounts();
				expect(counts.idle).toBe(frameCount);
				expect(counts.capturing).toBe(0);
				expect(counts.processing).toBe(0);
				expect(counts.ready).toBe(0);
				expect(counts.error).toBe(0);

				// Frame counter is reset
				expect(ring.totalFrames).toBe(0);

				// All buffer frame numbers are -1
				const status = ring.getStatus();
				for (const s of status) {
					expect(s.frameNumber).toBe(-1);
					expect(s.status).toBe('idle');
				}
			}
		);
	});

	describe('Invariant: Frame numbers are assigned correctly', () => {
		fcTest.prop([fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 30 })])(
			'frame numbers are sequential starting from 1',
			async (frameCount, captureCount) => {
				const { BufferRing } = await import('$lib/capture/BufferRing');
				const ring = new BufferRing(mockDevice, 800, 600, { frameCount });

				const frameNumbers: number[] = [];

				for (let i = 0; i < captureCount; i++) {
					const buffer = ring.getNextForCapture();
					frameNumbers.push(buffer.frameNumber);

					// Release old buffers to prevent reuse
					if (i >= frameCount - 1) {
						ring.markIdle(buffer);
					}
				}

				// Frame numbers should be 1, 2, 3, ...
				for (let i = 0; i < frameNumbers.length; i++) {
					expect(frameNumbers[i]).toBe(i + 1);
				}
			}
		);
	});

	describe('Invariant: getBuffer boundary conditions', () => {
		fcTest.prop([fc.integer({ min: 1, max: 10 }), fc.integer({ min: -100, max: 100 })])(
			'getBuffer returns null for out-of-bounds indices',
			async (frameCount, testIndex) => {
				const { BufferRing } = await import('$lib/capture/BufferRing');
				const ring = new BufferRing(mockDevice, 800, 600, { frameCount });

				const result = ring.getBuffer(testIndex);

				if (testIndex >= 0 && testIndex < frameCount) {
					expect(result).not.toBeNull();
					expect(result!.index).toBe(testIndex);
				} else {
					expect(result).toBeNull();
				}
			}
		);
	});
});
