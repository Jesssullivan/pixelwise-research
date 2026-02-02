/**
 * GlyphFrameSynchronizer Tests
 *
 * Tests for glyph-frame coordination and caching.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Mock window and document for DOM APIs
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

// Set up global mocks
Object.defineProperty(global, 'window', {
	value: mockWindow,
	writable: true
});

Object.defineProperty(global, 'document', {
	value: mockDocument,
	writable: true
});

Object.defineProperty(global, 'MutationObserver', {
	value: vi.fn(() => ({
		observe: vi.fn(),
		disconnect: vi.fn()
	})),
	writable: true
});

Object.defineProperty(global, 'ResizeObserver', {
	value: vi.fn(() => ({
		observe: vi.fn(),
		disconnect: vi.fn()
	})),
	writable: true
});

describe('GlyphFrameSynchronizer', () => {
	let mockDevice: GPUDevice;

	beforeEach(() => {
		mockDevice = createMockGPUDevice();
		vi.clearAllMocks();
	});

	describe('construction', () => {
		it('should create instance with default config', async () => {
			const { GlyphFrameSynchronizer, DEFAULT_SYNC_CONFIG } = await import(
				'$lib/capture/GlyphFrameSynchronizer'
			);

			const sync = new GlyphFrameSynchronizer(mockDevice, 1920, 1080);

			expect(sync.coordinateTransformer).toBeDefined();
			expect(sync.isCacheValid).toBe(false);
			expect(sync.cachedFrameCount).toBe(0);
		});

		it('should create instance with custom config', async () => {
			const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');

			const sync = new GlyphFrameSynchronizer(mockDevice, 1920, 1080, {
				cacheFrames: 5,
				maxGlyphs: 50000
			});

			expect(sync.coordinateTransformer).toBeDefined();
		});

		it('should set up MutationObserver when autoDetectChanges is true', async () => {
			const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');

			new GlyphFrameSynchronizer(mockDevice, 1920, 1080, {
				autoDetectChanges: true
			});

			expect(global.MutationObserver).toHaveBeenCalled();
		});
	});

	describe('updateDimensions', () => {
		it('should update transformer with new dimensions', async () => {
			const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');

			const sync = new GlyphFrameSynchronizer(mockDevice, 800, 600);

			sync.updateDimensions(1920, 1080);

			expect(sync.coordinateTransformer.textureWidth).toBe(1920);
			expect(sync.coordinateTransformer.textureHeight).toBe(1080);
		});

		it('should invalidate cache on dimension change', async () => {
			const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');

			const sync = new GlyphFrameSynchronizer(mockDevice, 800, 600);

			sync.updateDimensions(1920, 1080);

			expect(sync.isCacheValid).toBe(false);
		});

		it('should accept custom DPR', async () => {
			const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');

			const sync = new GlyphFrameSynchronizer(mockDevice, 800, 600);

			sync.updateDimensions(1920, 1080, 3.0);

			expect(sync.coordinateTransformer.dpr).toBe(3.0);
		});
	});

	describe('invalidateCache', () => {
		it('should mark cache as invalid', async () => {
			const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');

			const sync = new GlyphFrameSynchronizer(mockDevice, 800, 600);

			sync.invalidateCache();

			expect(sync.isCacheValid).toBe(false);
			expect(sync.cachedFrameCount).toBe(0);
		});
	});

	describe('extractForFrame', () => {
		it('should return extraction result', async () => {
			const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');

			const sync = new GlyphFrameSynchronizer(mockDevice, 800, 600);

			const result = sync.extractForFrame(1);

			expect(result).toBeDefined();
			expect(result.frameNumber).toBe(1);
			expect(result.glyphs).toBeInstanceOf(Array);
			expect(typeof result.wasCached).toBe('boolean');
			expect(typeof result.extractionTime).toBe('number');
		});

		it('should increment cache when extracting new frame', async () => {
			const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');

			const sync = new GlyphFrameSynchronizer(mockDevice, 800, 600);

			sync.extractForFrame(1);

			expect(sync.cachedFrameCount).toBe(1);
		});
	});

	describe('uploadToGPU', () => {
		it('should write glyph data to GPU buffer', async () => {
			const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');

			const sync = new GlyphFrameSynchronizer(mockDevice, 800, 600);

			const mockBuffer = {
				label: 'test-buffer',
				size: 1000
			} as unknown as GPUBuffer;

			const mockGlyphs = [
				{
					x: 100,
					y: 50,
					width: 10,
					height: 16,
					baseline: 12,
					ascent: 12,
					descent: 4,
					char: 'A',
					codepoint: 65,
					charIndex: 0,
					isLigature: false,
					isRTL: false,
					texelX: 200,
					texelY: 100,
					fracX: 0,
					fracY: 0,
					zIndex: 0,
					stackingContextId: 0,
					regionId: 0
				}
			];

			sync.uploadToGPU(mockBuffer, mockGlyphs);

			expect(mockDevice.queue.writeBuffer).toHaveBeenCalledWith(
				mockBuffer,
				0,
				expect.any(Float32Array)
			);
		});
	});

	describe('destroy', () => {
		it('should clean up resources', async () => {
			const { GlyphFrameSynchronizer } = await import('$lib/capture/GlyphFrameSynchronizer');

			const sync = new GlyphFrameSynchronizer(mockDevice, 800, 600, {
				autoDetectChanges: true
			});

			// Set a mock root element to trigger observer setup
			const mockElement = { children: [] } as unknown as Element;
			sync.setRootElement(mockElement);

			sync.destroy();

			// Cache should be cleared
			expect(sync.cachedFrameCount).toBe(0);
		});
	});
});

describe('DEFAULT_SYNC_CONFIG', () => {
	it('should have sensible defaults', async () => {
		const { DEFAULT_SYNC_CONFIG } = await import('$lib/capture/GlyphFrameSynchronizer');

		expect(DEFAULT_SYNC_CONFIG.cacheFrames).toBe(3);
		expect(DEFAULT_SYNC_CONFIG.autoDetectChanges).toBe(true);
		expect(DEFAULT_SYNC_CONFIG.maxGlyphs).toBe(100000);
		expect(DEFAULT_SYNC_CONFIG.skipWhitespace).toBe(true);
	});
});

describe('createGlyphFrameSynchronizer', () => {
	it('should create GlyphFrameSynchronizer instance', async () => {
		const mockDevice = createMockGPUDevice();
		const { createGlyphFrameSynchronizer, GlyphFrameSynchronizer } = await import(
			'$lib/capture/GlyphFrameSynchronizer'
		);

		const sync = createGlyphFrameSynchronizer(mockDevice, 1920, 1080);

		expect(sync).toBeInstanceOf(GlyphFrameSynchronizer);
	});
});
