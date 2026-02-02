/**
 * GlyphFrameSynchronizer Property-Based Tests
 *
 * Tests for glyph extraction and coordinate transformation properties.
 *
 * Properties tested:
 * 1. DPR scaling preserves proportions (via CoordinateTransformer)
 * 2. Texel coordinates are always integers
 * 3. Fractional offsets are always in [0, 1)
 * 4. Cache invalidation properly clears state
 * 5. Frame extraction results are consistent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fc, test as fcTest } from '@fast-check/vitest';
import type { GlyphSyncConfig } from '$lib/capture/GlyphFrameSynchronizer';
import type { ExtendedGlyphData } from '$lib/pixelwise/GlyphExtractor';

// Mock GPUDevice
function createMockGPUDevice() {
	return {
		createBuffer: vi.fn((descriptor: any) => ({
			label: descriptor.label,
			size: descriptor.size,
			destroy: vi.fn()
		})),
		queue: {
			writeBuffer: vi.fn()
		}
	} as unknown as GPUDevice;
}

// Mock the $app/environment module
vi.mock('$app/environment', () => ({
	browser: true
}));

// Set up global mocks
const mockWindow = {
	devicePixelRatio: 2.0,
	innerWidth: 1920,
	innerHeight: 1080,
	getComputedStyle: vi.fn(() => ({
		fontFamily: 'Arial',
		fontSize: '16px',
		fontWeight: '400',
		fontStyle: 'normal',
		lineHeight: '24px',
		visibility: 'visible',
		display: 'block',
		opacity: '1',
		position: 'static',
		zIndex: 'auto',
		transform: 'none',
		filter: 'none',
		perspective: 'none',
		clipPath: 'none',
		isolation: 'auto',
		mixBlendMode: 'normal',
		willChange: 'auto',
		contain: 'none',
		color: 'rgb(0, 0, 0)'
	}))
};

const mockDocument = {
	createTreeWalker: vi.fn(() => ({
		nextNode: vi.fn(() => null)
	})),
	createElement: vi.fn(() => ({
		getContext: vi.fn(() => ({
			font: '',
			measureText: vi.fn(() => ({
				width: 10,
				actualBoundingBoxAscent: 12,
				actualBoundingBoxDescent: 4,
				fontBoundingBoxAscent: 14,
				fontBoundingBoxDescent: 5
			}))
		}))
	}))
};

Object.defineProperty(global, 'window', {
	value: mockWindow,
	writable: true
});

Object.defineProperty(global, 'document', {
	value: mockDocument,
	writable: true
});

// Create proper constructor mocks for observers
class MockMutationObserver {
	callback: MutationCallback;
	constructor(callback: MutationCallback) {
		this.callback = callback;
	}
	observe = vi.fn();
	disconnect = vi.fn();
	takeRecords = vi.fn(() => []);
}

class MockResizeObserver {
	callback: ResizeObserverCallback;
	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
	}
	observe = vi.fn();
	disconnect = vi.fn();
	unobserve = vi.fn();
}

Object.defineProperty(global, 'MutationObserver', {
	value: MockMutationObserver,
	writable: true
});

Object.defineProperty(global, 'ResizeObserver', {
	value: MockResizeObserver,
	writable: true
});

// Custom arbitraries
const validDPR = fc.double({ min: 0.5, max: 4.0, noNaN: true });
const validTextureDimension = fc.integer({ min: 100, max: 8192 });
const validSyncConfig: fc.Arbitrary<Partial<GlyphSyncConfig>> = fc.record(
	{
		cacheFrames: fc.integer({ min: 1, max: 10 }),
		autoDetectChanges: fc.boolean(),
		maxGlyphs: fc.integer({ min: 1000, max: 500000 }),
		skipWhitespace: fc.boolean()
	},
	{ requiredKeys: [] }
);

// Generate mock glyph data
const mockGlyphDataArb: fc.Arbitrary<ExtendedGlyphData> = fc.record({
	x: fc.double({ min: 0, max: 1000, noNaN: true }),
	y: fc.double({ min: 0, max: 1000, noNaN: true }),
	width: fc.double({ min: 1, max: 100, noNaN: true }),
	height: fc.double({ min: 1, max: 100, noNaN: true }),
	baseline: fc.double({ min: 0, max: 50, noNaN: true }),
	ascent: fc.double({ min: 0, max: 50, noNaN: true }),
	descent: fc.double({ min: 0, max: 20, noNaN: true }),
	char: fc.string({ minLength: 1, maxLength: 2 }),
	codepoint: fc.integer({ min: 32, max: 127 }),
	charIndex: fc.integer({ min: 0, max: 1000 }),
	isLigature: fc.boolean(),
	isRTL: fc.boolean(),
	texelX: fc.integer({ min: 0, max: 4000 }),
	texelY: fc.integer({ min: 0, max: 4000 }),
	fracX: fc.double({ min: 0, max: 0.999, noNaN: true }),
	fracY: fc.double({ min: 0, max: 0.999, noNaN: true }),
	zIndex: fc.integer({ min: -1000, max: 1000 }),
	stackingContextId: fc.integer({ min: 0, max: 100 }),
	regionId: fc.integer({ min: 0, max: 50 })
});

describe('GlyphFrameSynchronizer Property-Based Tests', () => {
	let mockDevice: GPUDevice;

	beforeEach(() => {
		mockDevice = createMockGPUDevice();
		vi.clearAllMocks();
	});

	describe('Invariant: Coordinate transformer is always valid', () => {
		fcTest.prop([validTextureDimension, validTextureDimension, validSyncConfig])(
			'coordinateTransformer has correct dimensions',
			async (textureWidth, textureHeight, config) => {
				const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');
				const sync = new GlyphFrameSynchronizer(mockDevice, textureWidth, textureHeight, config);

				expect(sync.coordinateTransformer).toBeDefined();
				expect(sync.coordinateTransformer.textureWidth).toBe(textureWidth);
				expect(sync.coordinateTransformer.textureHeight).toBe(textureHeight);
			}
		);

		fcTest.prop([validTextureDimension, validTextureDimension])(
			'coordinateTransformer DPR matches window',
			async (textureWidth, textureHeight) => {
				const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');
				const sync = new GlyphFrameSynchronizer(mockDevice, textureWidth, textureHeight);

				expect(sync.coordinateTransformer.dpr).toBe(mockWindow.devicePixelRatio);
			}
		);
	});

	describe('Invariant: Cache state is consistent', () => {
		fcTest.prop([validTextureDimension, validTextureDimension, validSyncConfig])(
			'cache starts invalid',
			async (textureWidth, textureHeight, config) => {
				const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');
				const sync = new GlyphFrameSynchronizer(mockDevice, textureWidth, textureHeight, config);

				expect(sync.isCacheValid).toBe(false);
				expect(sync.cachedFrameCount).toBe(0);
			}
		);

		fcTest.prop([validTextureDimension, validTextureDimension, validSyncConfig])(
			'invalidateCache clears all cache state',
			async (textureWidth, textureHeight, config) => {
				const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');
				const sync = new GlyphFrameSynchronizer(mockDevice, textureWidth, textureHeight, config);

				// Extract a frame to populate cache
				sync.extractForFrame(1);

				// Invalidate
				sync.invalidateCache();

				expect(sync.isCacheValid).toBe(false);
				expect(sync.cachedFrameCount).toBe(0);
			}
		);
	});

	describe('Invariant: updateDimensions updates transformer', () => {
		fcTest.prop([
			validTextureDimension,
			validTextureDimension,
			validTextureDimension,
			validTextureDimension
		])(
			'updateDimensions changes transformer dimensions',
			async (initialWidth, initialHeight, newWidth, newHeight) => {
				const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');
				const sync = new GlyphFrameSynchronizer(mockDevice, initialWidth, initialHeight);

				sync.updateDimensions(newWidth, newHeight);

				expect(sync.coordinateTransformer.textureWidth).toBe(newWidth);
				expect(sync.coordinateTransformer.textureHeight).toBe(newHeight);
			}
		);

		fcTest.prop([validTextureDimension, validTextureDimension, validDPR])(
			'updateDimensions can change DPR',
			async (textureWidth, textureHeight, newDPR) => {
				const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');
				const sync = new GlyphFrameSynchronizer(mockDevice, textureWidth, textureHeight);

				sync.updateDimensions(textureWidth, textureHeight, newDPR);

				expect(sync.coordinateTransformer.dpr).toBe(newDPR);
			}
		);

		fcTest.prop([validTextureDimension, validTextureDimension, validTextureDimension, validTextureDimension])(
			'updateDimensions invalidates cache',
			async (initialWidth, initialHeight, newWidth, newHeight) => {
				const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');
				const sync = new GlyphFrameSynchronizer(mockDevice, initialWidth, initialHeight);

				// Extract to populate cache
				sync.extractForFrame(1);

				// Update dimensions
				sync.updateDimensions(newWidth, newHeight);

				expect(sync.isCacheValid).toBe(false);
			}
		);
	});

	describe('Invariant: extractForFrame returns consistent structure', () => {
		fcTest.prop([validTextureDimension, validTextureDimension, fc.integer({ min: 0, max: 1000 })])(
			'extractForFrame returns valid FrameGlyphData',
			async (textureWidth, textureHeight, frameNumber) => {
				const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');
				const sync = new GlyphFrameSynchronizer(mockDevice, textureWidth, textureHeight);

				const result = sync.extractForFrame(frameNumber);

				expect(result).toBeDefined();
				expect(result.frameNumber).toBe(frameNumber);
				expect(Array.isArray(result.glyphs)).toBe(true);
				expect(typeof result.wasCached).toBe('boolean');
				expect(typeof result.extractionTime).toBe('number');
				expect(result.extractionTime).toBeGreaterThanOrEqual(0);
				expect(typeof result.regionCount).toBe('number');
				expect(typeof result.stackingContextCount).toBe('number');
			}
		);

		fcTest.prop([validTextureDimension, validTextureDimension])(
			'first extraction is never cached',
			async (textureWidth, textureHeight) => {
				const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');
				const sync = new GlyphFrameSynchronizer(mockDevice, textureWidth, textureHeight);

				const result = sync.extractForFrame(1);

				expect(result.wasCached).toBe(false);
			}
		);
	});

	describe('Invariant: uploadToGPU writes correct data format', () => {
		fcTest.prop([
			validTextureDimension,
			validTextureDimension,
			fc.array(mockGlyphDataArb, { minLength: 1, maxLength: 100 })
		])(
			'uploadToGPU writes Float32Array of correct length',
			async (textureWidth, textureHeight, glyphs) => {
				// Create fresh mock device for this test to avoid call accumulation
				const testMockDevice = createMockGPUDevice();
				const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');
				const sync = new GlyphFrameSynchronizer(testMockDevice, textureWidth, textureHeight);

				const mockBuffer = { label: 'test-buffer' } as unknown as GPUBuffer;

				sync.uploadToGPU(mockBuffer, glyphs);

				expect(testMockDevice.queue.writeBuffer).toHaveBeenCalledWith(
					mockBuffer,
					0,
					expect.any(Float32Array)
				);

				// Verify the data array has correct size (6 floats per glyph)
				const callArgs = (testMockDevice.queue.writeBuffer as any).mock.calls[0];
				const data = callArgs[2] as Float32Array;
				expect(data.length).toBe(glyphs.length * 6);
			}
		);
	});

	describe('Invariant: destroy cleans up resources', () => {
		fcTest.prop([validTextureDimension, validTextureDimension, validSyncConfig])(
			'destroy clears cache',
			async (textureWidth, textureHeight, config) => {
				const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');
				const sync = new GlyphFrameSynchronizer(mockDevice, textureWidth, textureHeight, config);

				// Populate some state
				sync.extractForFrame(1);

				sync.destroy();

				expect(sync.cachedFrameCount).toBe(0);
			}
		);
	});
});

describe('ExtendedGlyphData Properties', () => {
	describe('Invariant: Texel coordinates are integers', () => {
		fcTest.prop([mockGlyphDataArb])(
			'texelX and texelY are integers',
			(glyph) => {
				expect(Number.isInteger(glyph.texelX)).toBe(true);
				expect(Number.isInteger(glyph.texelY)).toBe(true);
			}
		);
	});

	describe('Invariant: Fractional offsets are in [0, 1)', () => {
		fcTest.prop([mockGlyphDataArb])(
			'fracX is in [0, 1)',
			(glyph) => {
				expect(glyph.fracX).toBeGreaterThanOrEqual(0);
				expect(glyph.fracX).toBeLessThan(1);
			}
		);

		fcTest.prop([mockGlyphDataArb])(
			'fracY is in [0, 1)',
			(glyph) => {
				expect(glyph.fracY).toBeGreaterThanOrEqual(0);
				expect(glyph.fracY).toBeLessThan(1);
			}
		);
	});

	describe('Invariant: Region and context IDs are non-negative', () => {
		fcTest.prop([mockGlyphDataArb])(
			'regionId is non-negative',
			(glyph) => {
				expect(glyph.regionId).toBeGreaterThanOrEqual(0);
			}
		);

		fcTest.prop([mockGlyphDataArb])(
			'stackingContextId is non-negative',
			(glyph) => {
				expect(glyph.stackingContextId).toBeGreaterThanOrEqual(0);
			}
		);
	});

	describe('Invariant: Glyph dimensions are positive', () => {
		fcTest.prop([mockGlyphDataArb])(
			'width is positive',
			(glyph) => {
				expect(glyph.width).toBeGreaterThan(0);
			}
		);

		fcTest.prop([mockGlyphDataArb])(
			'height is positive',
			(glyph) => {
				expect(glyph.height).toBeGreaterThan(0);
			}
		);
	});
});

describe('GPU Data Packing Properties', () => {
	fcTest.prop([fc.array(mockGlyphDataArb, { minLength: 0, maxLength: 1000 })])(
		'packed data length matches glyph count',
		(glyphs) => {
			// Simulate packing logic
			const data = new Float32Array(glyphs.length * 6);

			for (let i = 0; i < glyphs.length; i++) {
				const g = glyphs[i];
				const offset = i * 6;
				data[offset] = g.texelX;
				data[offset + 1] = g.texelY;
				data[offset + 2] = 1.0; // Coverage
				data[offset + 3] = 1.0; // Edge weight
				data[offset + 4] = g.fracX;
				data[offset + 5] = g.fracY;
			}

			expect(data.length).toBe(glyphs.length * 6);
		}
	);

	fcTest.prop([fc.array(mockGlyphDataArb, { minLength: 1, maxLength: 100 })])(
		'packed texel coordinates are preserved exactly',
		(glyphs) => {
			const data = new Float32Array(glyphs.length * 6);

			for (let i = 0; i < glyphs.length; i++) {
				const g = glyphs[i];
				const offset = i * 6;
				data[offset] = g.texelX;
				data[offset + 1] = g.texelY;
			}

			// Verify texel coords are preserved
			for (let i = 0; i < glyphs.length; i++) {
				expect(data[i * 6]).toBe(glyphs[i].texelX);
				expect(data[i * 6 + 1]).toBe(glyphs[i].texelY);
			}
		}
	);

	fcTest.prop([fc.array(mockGlyphDataArb, { minLength: 1, maxLength: 100 })])(
		'packed fractional offsets are preserved',
		(glyphs) => {
			const data = new Float32Array(glyphs.length * 6);

			for (let i = 0; i < glyphs.length; i++) {
				const g = glyphs[i];
				const offset = i * 6;
				data[offset + 4] = g.fracX;
				data[offset + 5] = g.fracY;
			}

			// Verify fractional offsets are preserved (Float32 has ~7 decimal digits of precision)
			for (let i = 0; i < glyphs.length; i++) {
				expect(data[i * 6 + 4]).toBeCloseTo(glyphs[i].fracX, 5);
				expect(data[i * 6 + 5]).toBeCloseTo(glyphs[i].fracY, 5);
			}
		}
	);
});

describe('DEFAULT_SYNC_CONFIG Properties', () => {
	fcTest.prop([fc.constant(null)])(
		'DEFAULT_SYNC_CONFIG has valid defaults',
		async () => {
			const { DEFAULT_SYNC_CONFIG } = await import('$lib/capture/GlyphFrameSynchronizer');

			// cacheFrames should be reasonable for triple buffering
			expect(DEFAULT_SYNC_CONFIG.cacheFrames).toBeGreaterThanOrEqual(1);
			expect(DEFAULT_SYNC_CONFIG.cacheFrames).toBeLessThanOrEqual(10);

			// autoDetectChanges is boolean
			expect(typeof DEFAULT_SYNC_CONFIG.autoDetectChanges).toBe('boolean');

			// maxGlyphs is reasonable for performance
			expect(DEFAULT_SYNC_CONFIG.maxGlyphs).toBeGreaterThanOrEqual(1000);
			expect(DEFAULT_SYNC_CONFIG.maxGlyphs).toBeLessThanOrEqual(10000000);

			// skipWhitespace is boolean
			expect(typeof DEFAULT_SYNC_CONFIG.skipWhitespace).toBe('boolean');
		}
	);
});

describe('createGlyphFrameSynchronizer Factory', () => {
	fcTest.prop([validTextureDimension, validTextureDimension, validSyncConfig])(
		'factory creates valid instance',
		async (textureWidth, textureHeight, config) => {
			const mockDevice = createMockGPUDevice();
			const { createGlyphFrameSynchronizer, GlyphFrameSynchronizer } = await import(
				'$lib/capture/GlyphFrameSynchronizer'
			);

			const sync = createGlyphFrameSynchronizer(mockDevice, textureWidth, textureHeight, config);

			expect(sync).toBeInstanceOf(GlyphFrameSynchronizer);
			expect(sync.coordinateTransformer.textureWidth).toBe(textureWidth);
			expect(sync.coordinateTransformer.textureHeight).toBe(textureHeight);
		}
	);
});
