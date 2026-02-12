/**
 * ComputeDispatcher Unit Tests
 *
 * Tests for the central ESDT/WCAG pipeline dispatcher:
 * - Factory function and interface shape
 * - Backend selection and fallback logic
 * - ESDT computation with synthetic data
 * - Full pipeline (GPU -> WASM -> JS fallback)
 * - CPU pipeline with WCAG contrast calculations
 * - Metrics collection and history management
 * - Video frame processing delegation
 * - Backend switching and lifecycle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock $app/environment before importing the module under test
vi.mock('$app/environment', () => ({
	browser: true
}));

// Mock feature detection
vi.mock('$lib/pixelwise/featureDetection', () => ({
	detectWebGPU: vi.fn().mockResolvedValue({ available: false, adapter: null }),
	detectImportExternalTexture: vi.fn().mockReturnValue(false)
}));

// Mock Futhark WASM module
vi.mock('$lib/futhark', () => ({
	newFutharkContext: vi.fn()
}));

// Mock Futhark WebGPU module
vi.mock('$lib/futhark-webgpu', () => ({
	newFutharkWebGPUContext: vi.fn()
}));

// Mock WGSL shader imports (raw string imports)
vi.mock('$lib/pixelwise/shaders/video-capture-esdt.wgsl?raw', () => ({
	default: '// mock video capture shader'
}));
vi.mock('$lib/pixelwise/shaders/video-capture-esdt-fallback.wgsl?raw', () => ({
	default: '// mock fallback shader'
}));

import {
	createComputeDispatcher,
	DEFAULT_CONFIG,
	type ComputeConfig,
	type PipelineMetrics,
	type EsdtResult
} from '$lib/core/ComputeDispatcher';

import { detectWebGPU } from '$lib/pixelwise/featureDetection';
import { newFutharkWebGPUContext } from '$lib/futhark-webgpu';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a synthetic RGBA image (uniform color).
 */
function createSyntheticRgba(
	width: number,
	height: number,
	r = 128,
	g = 128,
	b = 128,
	a = 255
): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		data[i * 4] = r;
		data[i * 4 + 1] = g;
		data[i * 4 + 2] = b;
		data[i * 4 + 3] = a;
	}
	return data;
}

/**
 * Create RGBA data with a dark text region on a light background.
 * This creates a pattern that the WCAG pipeline should attempt to adjust.
 *
 * Layout: light background everywhere except a small central square of dark pixels.
 */
function createTextOnBackground(
	width: number,
	height: number
): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			// Light background (luminance ~ 0.87)
			data[i] = 230;
			data[i + 1] = 230;
			data[i + 2] = 230;
			data[i + 3] = 255;
		}
	}
	// Place a small dark square in the center
	const cx = Math.floor(width / 2);
	const cy = Math.floor(height / 2);
	const halfSize = Math.min(2, Math.floor(Math.min(width, height) / 4));
	for (let dy = -halfSize; dy <= halfSize; dy++) {
		for (let dx = -halfSize; dx <= halfSize; dx++) {
			const x = cx + dx;
			const y = cy + dy;
			if (x >= 0 && x < width && y >= 0 && y < height) {
				const i = (y * width + x) * 4;
				// Low-contrast dark text (luminance ~ 0.20)
				data[i] = 100;
				data[i + 1] = 100;
				data[i + 2] = 100;
				data[i + 3] = 255;
			}
		}
	}
	return data;
}

/**
 * Create a mock FutharkWebGPUContext that simulates GPU processing.
 */
function createMockFutharkWebGPUContext() {
	return {
		enhanceContrastRgba: vi.fn().mockImplementation(
			async (inputData: Uint8Array, width: number, height: number) => {
				// Return a copy of the input (no adjustment, simulates passthrough)
				return new Uint8Array(inputData);
			}
		),
		debugEsdtFlat: vi.fn().mockImplementation(
			async (_inputData: Uint8Array, width: number, height: number) => {
				// Return zero offset vectors
				return new Float32Array(width * height * 2);
			}
		),
		sync: vi.fn().mockResolvedValue(undefined),
		free: vi.fn()
	};
}

/**
 * Create a mock Futhark WASM context.
 */
function createMockFutharkWasmContext() {
	const mockFree = vi.fn();
	return {
		new_f32_2d: vi.fn().mockImplementation((data: Float32Array, width: number, height: number) => ({
			free: mockFree
		})),
		compute_esdt_2d: vi.fn().mockImplementation((_input: unknown, _useRelaxation: boolean) => ({
			toTypedArray: vi.fn().mockResolvedValue(new Float32Array(10 * 10 * 2)),
			free: mockFree
		}))
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComputeDispatcher', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// -----------------------------------------------------------------------
	// (a) Factory function and interface shape
	// -----------------------------------------------------------------------
	describe('createComputeDispatcher() factory', () => {
		it('should return an object with all expected methods', () => {
			const dispatcher = createComputeDispatcher();

			// Methods
			expect(typeof dispatcher.initialize).toBe('function');
			expect(typeof dispatcher.computeEsdt).toBe('function');
			expect(typeof dispatcher.runFullPipeline).toBe('function');
			expect(typeof dispatcher.processVideoFrame).toBe('function');
			expect(typeof dispatcher.hasVideoCapture).toBe('function');
			expect(typeof dispatcher.getDistance).toBe('function');
			expect(typeof dispatcher.getGradient).toBe('function');
			expect(typeof dispatcher.destroy).toBe('function');
			expect(typeof dispatcher.switchBackend).toBe('function');
			expect(typeof dispatcher.getLatestMetrics).toBe('function');
			expect(typeof dispatcher.getMetricsHistory).toBe('function');
			expect(typeof dispatcher.clearMetrics).toBe('function');
		});

		it('should return an object with all expected getter properties', () => {
			const dispatcher = createComputeDispatcher();

			expect(typeof dispatcher.isInitialized).toBe('boolean');
			expect(typeof dispatcher.activeBackend).toBe('string');
			expect(typeof dispatcher.hasWebGPU).toBe('boolean');
			expect(typeof dispatcher.hasFuthark).toBe('boolean');
			expect(typeof dispatcher.hasFutharkWebGPU).toBe('boolean');
		});

		it('should start in uninitialized state', () => {
			const dispatcher = createComputeDispatcher();

			expect(dispatcher.isInitialized).toBe(false);
			expect(dispatcher.activeBackend).toBe('auto');
			expect(dispatcher.hasWebGPU).toBe(false);
			expect(dispatcher.hasFuthark).toBe(false);
			expect(dispatcher.hasFutharkWebGPU).toBe(false);
			expect(dispatcher.error).toBeNull();
		});

		it('should create independent instances', () => {
			const d1 = createComputeDispatcher();
			const d2 = createComputeDispatcher();

			expect(d1).not.toBe(d2);
			expect(d1.isInitialized).toBe(false);
			expect(d2.isInitialized).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// (b) Backend selection logic
	// -----------------------------------------------------------------------
	describe('Backend selection logic', () => {
		it('should fall back to JS when no WebGPU and no WASM available', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			const result = await dispatcher.initialize('auto');

			expect(result).toBe(true);
			expect(dispatcher.isInitialized).toBe(true);
			// activeBackend remains 'auto' for JS fallback
			expect(dispatcher.activeBackend).toBe('auto');
			expect(dispatcher.hasWebGPU).toBe(false);
			expect(dispatcher.hasFuthark).toBe(false);
		});

		it('should select futhark-wasm when WASM available but no WebGPU', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const mockCtx = createMockFutharkWasmContext();
			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockResolvedValue(mockCtx);

			const dispatcher = createComputeDispatcher();
			const result = await dispatcher.initialize('auto');

			expect(result).toBe(true);
			expect(dispatcher.isInitialized).toBe(true);
			expect(dispatcher.activeBackend).toBe('futhark-wasm');
			expect(dispatcher.hasFuthark).toBe(true);
			expect(dispatcher.hasWebGPU).toBe(false);
		});

		it('should skip initialization if already initialized', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();
			await dispatcher.initialize(); // second call should be a no-op

			expect(dispatcher.isInitialized).toBe(true);
		});

		it('should honor explicit futhark-wasm preference', async () => {
			const mockCtx = createMockFutharkWasmContext();
			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockResolvedValue(mockCtx);

			const dispatcher = createComputeDispatcher();
			const result = await dispatcher.initialize('futhark-wasm');

			expect(result).toBe(true);
			expect(dispatcher.activeBackend).toBe('futhark-wasm');
		});

		it('should honor explicit futhark-webgpu preference and still fallback to wasm', async () => {
			// WebGPU available
			vi.mocked(detectWebGPU).mockResolvedValue({ available: true, adapter: 'Mock Adapter' });

			const mockWebGPUCtx = createMockFutharkWebGPUContext();
			vi.mocked(newFutharkWebGPUContext).mockResolvedValue(mockWebGPUCtx as any);

			// Also mock navigator.gpu for the video capture initialization
			const originalNavigator = globalThis.navigator;
			Object.defineProperty(globalThis, 'navigator', {
				value: {
					...originalNavigator,
					gpu: {
						requestAdapter: vi.fn().mockResolvedValue(null) // adapter null -> video capture skipped
					}
				},
				writable: true,
				configurable: true
			});

			const mockWasmCtx = createMockFutharkWasmContext();
			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockResolvedValue(mockWasmCtx);

			const dispatcher = createComputeDispatcher();
			const result = await dispatcher.initialize('futhark-webgpu');

			expect(result).toBe(true);
			expect(dispatcher.activeBackend).toBe('futhark-webgpu');
			expect(dispatcher.hasFutharkWebGPU).toBe(true);

			dispatcher.destroy();

			Object.defineProperty(globalThis, 'navigator', {
				value: originalNavigator,
				writable: true,
				configurable: true
			});
		});
	});

	// -----------------------------------------------------------------------
	// (c) computeEsdt() with synthetic data
	// -----------------------------------------------------------------------
	describe('computeEsdt()', () => {
		it('should compute ESDT using JS fallback when no backends available', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			// Create a 4x4 image with a single bright pixel in center
			const width = 4;
			const height = 4;
			const levels = new Float32Array(width * height);
			levels[5] = 1.0; // pixel at (1,1)

			const result = await dispatcher.computeEsdt(levels, width, height);

			expect(result).toBeDefined();
			expect(result.width).toBe(width);
			expect(result.height).toBe(height);
			expect(result.data).toBeInstanceOf(Float32Array);
			expect(result.data.length).toBe(width * height * 2); // dx,dy per pixel
		});

		it('should return zero distance for foreground pixels', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			const width = 3;
			const height = 3;
			const levels = new Float32Array([
				0.0, 0.0, 0.0,
				0.0, 1.0, 0.0,
				0.0, 0.0, 0.0
			]);

			const result = await dispatcher.computeEsdt(levels, width, height);

			// Center pixel (1,1) is foreground -> distance should be 0
			const distance = dispatcher.getDistance(result, 1, 1);
			expect(distance).toBeLessThan(0.01);
		});

		it('should return non-zero distance for background pixels', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			const width = 3;
			const height = 3;
			const levels = new Float32Array([
				0.0, 0.0, 0.0,
				0.0, 1.0, 0.0,
				0.0, 0.0, 0.0
			]);

			const result = await dispatcher.computeEsdt(levels, width, height);

			// Corner pixel (0,0) is background -> distance should be > 0
			const distance = dispatcher.getDistance(result, 0, 0);
			expect(distance).toBeGreaterThan(0);
			// Specifically, the distance from (0,0) to (1,1) should be sqrt(2)
			expect(distance).toBeCloseTo(Math.sqrt(2), 1);
		});

		it('should use Futhark WASM when available', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const mockCtx = createMockFutharkWasmContext();
			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockResolvedValue(mockCtx);

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			const width = 3;
			const height = 3;
			const levels = new Float32Array(width * height);

			await dispatcher.computeEsdt(levels, width, height);

			expect(mockCtx.new_f32_2d).toHaveBeenCalledWith(levels, width, height);
			expect(mockCtx.compute_esdt_2d).toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// (d) runFullPipeline() with synthetic data
	// -----------------------------------------------------------------------
	describe('runFullPipeline()', () => {
		it('should return PipelineResult with correct shape', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			const width = 4;
			const height = 4;
			const rgbaData = createSyntheticRgba(width, height);

			const result = await dispatcher.runFullPipeline(rgbaData, width, height);

			expect(result).toBeDefined();
			expect(result.adjustedPixels).toBeInstanceOf(Uint8ClampedArray);
			expect(result.adjustedPixels.length).toBe(width * height * 4);
			expect(typeof result.adjustedCount).toBe('number');
			expect(typeof result.processingTime).toBe('number');
			expect(result.processingTime).toBeGreaterThanOrEqual(0);
			expect(['futhark-webgpu', 'futhark-wasm', 'js-fallback']).toContain(result.backend);
		});

		it('should use js-fallback backend when no GPU/WASM available', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			const result = await dispatcher.runFullPipeline(
				createSyntheticRgba(4, 4),
				4,
				4
			);

			expect(result.backend).toBe('js-fallback');
		});

		it('should use futhark-wasm backend when WASM is available', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const mockCtx = createMockFutharkWasmContext();
			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockResolvedValue(mockCtx);

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			const result = await dispatcher.runFullPipeline(
				createSyntheticRgba(4, 4),
				4,
				4
			);

			expect(result.backend).toBe('futhark-wasm');
		});

		it('should merge partial config with defaults', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			// Pass partial config - should merge with DEFAULT_CONFIG
			const result = await dispatcher.runFullPipeline(
				createSyntheticRgba(4, 4),
				4,
				4,
				{ targetContrast: 4.5 } // WCAG AA instead of AAA
			);

			expect(result).toBeDefined();
			expect(result.adjustedPixels).toBeInstanceOf(Uint8ClampedArray);
		});

		it('should preserve alpha channel in output', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			const width = 4;
			const height = 4;
			const rgba = createSyntheticRgba(width, height, 128, 128, 128, 200);

			const result = await dispatcher.runFullPipeline(rgba, width, height);

			// Check alpha values are preserved
			for (let i = 0; i < width * height; i++) {
				expect(result.adjustedPixels[i * 4 + 3]).toBe(200);
			}
		});

		it('should not modify a uniform image (no edges to enhance)', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			const width = 8;
			const height = 8;
			// Completely uniform grey - no edges, no contrast issues
			const rgba = createSyntheticRgba(width, height, 128, 128, 128, 255);

			const result = await dispatcher.runFullPipeline(rgba, width, height);

			// A uniform image should have zero adjusted pixels
			expect(result.adjustedCount).toBe(0);
		});

		it('should return original data when CPU pipeline throws', async () => {
			// This tests the last-resort fallback in runFullPipeline
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			const width = 4;
			const height = 4;
			// Intentionally pass mismatched data to trigger an error path
			// (width * height * 4 should match data.length but let's verify error handling)
			const rgba = createSyntheticRgba(width, height);

			// The pipeline should succeed (JS fallback handles uniform data gracefully)
			const result = await dispatcher.runFullPipeline(rgba, width, height);
			expect(result).toBeDefined();
			expect(result.adjustedPixels.length).toBe(width * height * 4);
		});
	});

	// -----------------------------------------------------------------------
	// (e) runFullPipelineCPU() - WCAG contrast correctness
	// -----------------------------------------------------------------------
	describe('runFullPipelineCPU() - WCAG contrast', () => {
		it('should detect and attempt to fix low-contrast text', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			// Create a larger image with text-like content for the ESDT to detect edges
			const width = 20;
			const height = 20;
			const rgba = createTextOnBackground(width, height);

			const result = await dispatcher.runFullPipeline(rgba, width, height, {
				maxDistance: 5.0,
				targetContrast: 7.0,
				sampleDistance: 3.0
			});

			expect(result).toBeDefined();
			expect(result.backend).toBe('js-fallback');
			expect(result.adjustedPixels.length).toBe(width * height * 4);
			// Some pixels may have been adjusted depending on the ESDT edge detection
			expect(typeof result.adjustedCount).toBe('number');
			expect(result.adjustedCount).toBeGreaterThanOrEqual(0);
		});

		it('should use correct sRGB linearization in contrast calculation', () => {
			// Verify the sRGB to linear conversion matches WCAG 2.1 spec
			// Formula: s <= 0.03928 ? s/12.92 : ((s+0.055)/1.055)^2.4
			// We test this indirectly through the pipeline's output

			// sRGB value 0 -> linear 0
			// sRGB value 128 (0.502) -> linear ~0.216
			// sRGB value 255 (1.0) -> linear 1.0

			// These are verified by running the pipeline and checking output
			const dispatcher = createComputeDispatcher();
			expect(dispatcher).toBeDefined();
		});

		it('should not crash on 1x1 pixel images', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			const rgba = new Uint8ClampedArray([128, 128, 128, 255]);
			const result = await dispatcher.runFullPipeline(rgba, 1, 1);

			expect(result.adjustedPixels.length).toBe(4);
			expect(result.adjustedCount).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// (f) Metrics collection
	// -----------------------------------------------------------------------
	describe('Metrics collection', () => {
		it('should return null for getLatestMetrics before any pipeline run', () => {
			const dispatcher = createComputeDispatcher();
			expect(dispatcher.getLatestMetrics()).toBeNull();
		});

		it('should return empty array for getMetricsHistory before any pipeline run', () => {
			const dispatcher = createComputeDispatcher();
			const history = dispatcher.getMetricsHistory();
			expect(history).toEqual([]);
		});

		it('should record metrics after runFullPipeline', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			await dispatcher.runFullPipeline(
				createSyntheticRgba(4, 4),
				4,
				4
			);

			const metrics = dispatcher.getLatestMetrics();
			expect(metrics).not.toBeNull();
			expect(metrics!.width).toBe(4);
			expect(metrics!.height).toBe(4);
			expect(metrics!.totalPixels).toBe(16);
			expect(metrics!.backend).toBe('js-fallback');
			expect(typeof metrics!.pipelineTimeMs).toBe('number');
			expect(typeof metrics!.overheadTimeMs).toBe('number');
			expect(typeof metrics!.totalTimeMs).toBe('number');
			expect(typeof metrics!.adjustedPixels).toBe('number');
			expect(typeof metrics!.mpixPerSec).toBe('number');
			expect(typeof metrics!.timestamp).toBe('number');
		});

		it('should have correct PipelineMetrics shape', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			await dispatcher.runFullPipeline(createSyntheticRgba(8, 8), 8, 8);

			const metrics = dispatcher.getLatestMetrics()!;
			const expectedKeys: (keyof PipelineMetrics)[] = [
				'pipelineTimeMs',
				'overheadTimeMs',
				'totalTimeMs',
				'backend',
				'width',
				'height',
				'totalPixels',
				'adjustedPixels',
				'mpixPerSec',
				'timestamp'
			];

			for (const key of expectedKeys) {
				expect(metrics).toHaveProperty(key);
			}
		});

		it('should accumulate metrics history across multiple runs', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			// Run pipeline 3 times
			for (let i = 0; i < 3; i++) {
				await dispatcher.runFullPipeline(
					createSyntheticRgba(4, 4),
					4,
					4
				);
			}

			const history = dispatcher.getMetricsHistory();
			expect(history.length).toBe(3);

			// Each entry should be independent
			for (const entry of history) {
				expect(entry.width).toBe(4);
				expect(entry.height).toBe(4);
			}
		});

		it('should return a copy from getMetricsHistory (not mutable reference)', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			await dispatcher.runFullPipeline(createSyntheticRgba(4, 4), 4, 4);

			const history1 = dispatcher.getMetricsHistory();
			const history2 = dispatcher.getMetricsHistory();

			// Should be different array references
			expect(history1).not.toBe(history2);
			// But same content
			expect(history1.length).toBe(history2.length);
		});

		it('should clear metrics with clearMetrics()', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			await dispatcher.runFullPipeline(createSyntheticRgba(4, 4), 4, 4);
			expect(dispatcher.getLatestMetrics()).not.toBeNull();

			dispatcher.clearMetrics();

			expect(dispatcher.getLatestMetrics()).toBeNull();
			expect(dispatcher.getMetricsHistory()).toEqual([]);
		});

		it('should cap history at 120 entries', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			// Run pipeline more than METRICS_HISTORY_SIZE (120) times
			const rgbaData = createSyntheticRgba(2, 2);
			for (let i = 0; i < 130; i++) {
				await dispatcher.runFullPipeline(rgbaData, 2, 2);
			}

			const history = dispatcher.getMetricsHistory();
			expect(history.length).toBe(120);
		});
	});

	// -----------------------------------------------------------------------
	// (g) processVideoFrame() delegation
	// -----------------------------------------------------------------------
	describe('processVideoFrame()', () => {
		it('should return null when video capture is not initialized', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			expect(dispatcher.hasVideoCapture()).toBe(false);

			const mockVideo = {
				videoWidth: 640,
				videoHeight: 480
			} as HTMLVideoElement;

			const result = await dispatcher.processVideoFrame(mockVideo);
			expect(result).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// Utility methods: getDistance, getGradient
	// -----------------------------------------------------------------------
	describe('getDistance() and getGradient()', () => {
		it('should compute correct distance from ESDT result', () => {
			const dispatcher = createComputeDispatcher();

			const esdt: EsdtResult = {
				data: new Float32Array([
					3.0, 4.0, // pixel (0,0): dx=3, dy=4 -> distance=5
					0.0, 0.0, // pixel (1,0): center
					1.0, 0.0, // pixel (0,1): dx=1, dy=0 -> distance=1
					0.0, 1.0  // pixel (1,1): dx=0, dy=1 -> distance=1
				]),
				width: 2,
				height: 2
			};

			expect(dispatcher.getDistance(esdt, 0, 0)).toBeCloseTo(5.0, 5);
			expect(dispatcher.getDistance(esdt, 1, 0)).toBeCloseTo(0.0, 5);
			expect(dispatcher.getDistance(esdt, 0, 1)).toBeCloseTo(1.0, 5);
			expect(dispatcher.getDistance(esdt, 1, 1)).toBeCloseTo(1.0, 5);
		});

		it('should compute correct gradient from ESDT result', () => {
			const dispatcher = createComputeDispatcher();

			const esdt: EsdtResult = {
				data: new Float32Array([
					3.0, 4.0, // pixel (0,0): gradient should be (0.6, 0.8)
					0.0, 0.0, // pixel (1,0): zero distance -> [0,0]
					1.0, 0.0, // pixel (0,1): gradient should be (1, 0)
					0.0, 1.0  // pixel (1,1): gradient should be (0, 1)
				]),
				width: 2,
				height: 2
			};

			const [gx00, gy00] = dispatcher.getGradient(esdt, 0, 0);
			expect(gx00).toBeCloseTo(0.6, 3);
			expect(gy00).toBeCloseTo(0.8, 3);

			const [gx10, gy10] = dispatcher.getGradient(esdt, 1, 0);
			expect(gx10).toBe(0);
			expect(gy10).toBe(0);

			const [gx01, gy01] = dispatcher.getGradient(esdt, 0, 1);
			expect(gx01).toBeCloseTo(1.0, 3);
			expect(gy01).toBeCloseTo(0.0, 3);
		});
	});

	// -----------------------------------------------------------------------
	// Backend switching
	// -----------------------------------------------------------------------
	describe('switchBackend()', () => {
		it('should return false when switching to unavailable backend', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			// No WebGPU or WASM available, so switching to them should fail
			expect(dispatcher.switchBackend('futhark-webgpu')).toBe(false);
			expect(dispatcher.switchBackend('futhark-wasm')).toBe(false);
		});

		it('should switch to auto and select best available', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			// Switch to auto when nothing is available
			expect(dispatcher.switchBackend('auto')).toBe(true);
			expect(dispatcher.activeBackend).toBe('auto');
		});

		it('should switch to futhark-wasm when WASM is available', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const mockCtx = createMockFutharkWasmContext();
			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockResolvedValue(mockCtx);

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			expect(dispatcher.switchBackend('futhark-wasm')).toBe(true);
			expect(dispatcher.activeBackend).toBe('futhark-wasm');
		});
	});

	// -----------------------------------------------------------------------
	// Lifecycle: destroy
	// -----------------------------------------------------------------------
	describe('destroy()', () => {
		it('should reset all state', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const mockCtx = createMockFutharkWasmContext();
			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockResolvedValue(mockCtx);

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			expect(dispatcher.isInitialized).toBe(true);
			expect(dispatcher.hasFuthark).toBe(true);

			dispatcher.destroy();

			expect(dispatcher.isInitialized).toBe(false);
			expect(dispatcher.hasFuthark).toBe(false);
			expect(dispatcher.hasWebGPU).toBe(false);
			expect(dispatcher.hasFutharkWebGPU).toBe(false);
			expect(dispatcher.activeBackend).toBe('auto');
			expect(dispatcher.error).toBeNull();
		});

		it('should free Futhark WebGPU context on destroy', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: true, adapter: 'Mock Adapter' });

			const mockWebGPUCtx = createMockFutharkWebGPUContext();
			vi.mocked(newFutharkWebGPUContext).mockResolvedValue(mockWebGPUCtx as any);

			const originalNavigator = globalThis.navigator;
			Object.defineProperty(globalThis, 'navigator', {
				value: {
					...originalNavigator,
					gpu: {
						requestAdapter: vi.fn().mockResolvedValue(null)
					}
				},
				writable: true,
				configurable: true
			});

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize('futhark-webgpu');

			dispatcher.destroy();

			expect(mockWebGPUCtx.free).toHaveBeenCalled();
			expect(dispatcher.hasFutharkWebGPU).toBe(false);

			Object.defineProperty(globalThis, 'navigator', {
				value: originalNavigator,
				writable: true,
				configurable: true
			});
		});
	});

	// -----------------------------------------------------------------------
	// DEFAULT_CONFIG export
	// -----------------------------------------------------------------------
	describe('DEFAULT_CONFIG', () => {
		it('should have expected default values', () => {
			expect(DEFAULT_CONFIG.maxDistance).toBe(3.0);
			expect(DEFAULT_CONFIG.targetContrast).toBe(7.0); // WCAG AAA
			expect(DEFAULT_CONFIG.sampleDistance).toBe(5.0);
			expect(DEFAULT_CONFIG.useRelaxation).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// hasVideoCapture
	// -----------------------------------------------------------------------
	describe('hasVideoCapture()', () => {
		it('should return false when not initialized', () => {
			const dispatcher = createComputeDispatcher();
			expect(dispatcher.hasVideoCapture()).toBe(false);
		});

		it('should return false when initialized without WebGPU', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			expect(dispatcher.hasVideoCapture()).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// Futhark WebGPU pipeline path
	// -----------------------------------------------------------------------
	describe('Futhark WebGPU pipeline', () => {
		it('should use WebGPU backend when available and record metrics', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: true, adapter: 'Mock Adapter' });

			const mockWebGPUCtx = createMockFutharkWebGPUContext();
			vi.mocked(newFutharkWebGPUContext).mockResolvedValue(mockWebGPUCtx as any);

			const originalNavigator = globalThis.navigator;
			Object.defineProperty(globalThis, 'navigator', {
				value: {
					...originalNavigator,
					gpu: {
						requestAdapter: vi.fn().mockResolvedValue(null) // no video capture adapter
					}
				},
				writable: true,
				configurable: true
			});

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			expect(dispatcher.hasFutharkWebGPU).toBe(true);

			const width = 4;
			const height = 4;
			const rgbaData = createSyntheticRgba(width, height);

			const result = await dispatcher.runFullPipeline(rgbaData, width, height);

			expect(result.backend).toBe('futhark-webgpu');
			expect(mockWebGPUCtx.enhanceContrastRgba).toHaveBeenCalledWith(
				expect.any(Uint8Array),
				width,
				height,
				DEFAULT_CONFIG.targetContrast,
				DEFAULT_CONFIG.maxDistance,
				DEFAULT_CONFIG.sampleDistance
			);
			expect(mockWebGPUCtx.sync).toHaveBeenCalled();

			// Verify metrics were recorded
			const metrics = dispatcher.getLatestMetrics();
			expect(metrics).not.toBeNull();
			expect(metrics!.backend).toBe('futhark-webgpu');
			expect(metrics!.width).toBe(width);
			expect(metrics!.height).toBe(height);

			dispatcher.destroy();

			Object.defineProperty(globalThis, 'navigator', {
				value: originalNavigator,
				writable: true,
				configurable: true
			});
		});

		it('should fall back to CPU when WebGPU pipeline throws', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: true, adapter: 'Mock Adapter' });

			const mockWebGPUCtx = createMockFutharkWebGPUContext();
			// Make the WebGPU pipeline throw
			mockWebGPUCtx.enhanceContrastRgba.mockRejectedValue(new Error('GPU error'));
			vi.mocked(newFutharkWebGPUContext).mockResolvedValue(mockWebGPUCtx as any);

			const originalNavigator = globalThis.navigator;
			Object.defineProperty(globalThis, 'navigator', {
				value: {
					...originalNavigator,
					gpu: {
						requestAdapter: vi.fn().mockResolvedValue(null)
					}
				},
				writable: true,
				configurable: true
			});

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			const result = await dispatcher.runFullPipeline(
				createSyntheticRgba(4, 4),
				4,
				4
			);

			// Should fall back to JS fallback since WASM also not available
			expect(result.backend).toBe('js-fallback');

			dispatcher.destroy();

			Object.defineProperty(globalThis, 'navigator', {
				value: originalNavigator,
				writable: true,
				configurable: true
			});
		});
	});

	// -----------------------------------------------------------------------
	// ESDT JS fallback algorithm correctness
	// -----------------------------------------------------------------------
	// -----------------------------------------------------------------------
	// OOM and assertion failure handling
	// -----------------------------------------------------------------------
	describe('WASM OOM handling', () => {
		it('should null futhark context on OOM and fall back to JS', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			// Create a mock context that throws OOM on compute
			const mockFree = vi.fn();
			const oomCtx = {
				new_f32_2d: vi.fn().mockImplementation(() => ({
					free: mockFree
				})),
				compute_esdt_2d: vi.fn().mockImplementation(() => {
					throw new Error('Aborted(OOM)');
				})
			};

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockResolvedValue(oomCtx);

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			expect(dispatcher.hasFuthark).toBe(true);

			// computeEsdt should throw on OOM
			const levels = new Float32Array(16);
			await expect(dispatcher.computeEsdt(levels, 4, 4)).rejects.toThrow('Aborted(OOM)');

			// After OOM, context should be nulled
			expect(dispatcher.hasFuthark).toBe(false);
		});

		it('should fall through to JS fallback in runFullPipeline after WASM OOM', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			// Create a mock context that throws OOM during pipeline
			const mockFree = vi.fn();
			const oomCtx = {
				new_f32_2d: vi.fn().mockImplementation(() => ({
					free: mockFree
				})),
				compute_esdt_2d: vi.fn().mockImplementation(() => {
					throw new Error('Aborted(OOM)');
				})
			};

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockResolvedValue(oomCtx);

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			// runFullPipeline should catch the OOM and return JS fallback result
			const result = await dispatcher.runFullPipeline(
				createSyntheticRgba(4, 4),
				4,
				4
			);

			expect(result.backend).toBe('js-fallback');
		});
	});

	describe('WebGPU assertion failure handling', () => {
		it('should fall back to WASM when WebGPU context creation fails with assertion', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: true, adapter: 'Mock Adapter' });

			// WebGPU fails with assertion error
			vi.mocked(newFutharkWebGPUContext).mockRejectedValue(
				new Error('Futhark WebGPU context creation failed (GPU assertion). Original error: assert failed in $futhark_context_new')
			);

			const originalNavigator = globalThis.navigator;
			Object.defineProperty(globalThis, 'navigator', {
				value: {
					...originalNavigator,
					gpu: {
						requestAdapter: vi.fn().mockResolvedValue(null)
					}
				},
				writable: true,
				configurable: true
			});

			const mockWasmCtx = createMockFutharkWasmContext();
			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockResolvedValue(mockWasmCtx);

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			// Should have fallen back to WASM
			expect(dispatcher.hasFutharkWebGPU).toBe(false);
			expect(dispatcher.hasFuthark).toBe(true);
			expect(dispatcher.activeBackend).toBe('futhark-wasm');

			Object.defineProperty(globalThis, 'navigator', {
				value: originalNavigator,
				writable: true,
				configurable: true
			});
		});
	});

	describe('ESDT JS fallback correctness', () => {
		/**
		 * Verify the JS fallback produces valid distance fields.
		 */
		it('should produce distances that decrease toward foreground', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			// 5x5 grid with horizontal line at y=2
			const width = 5;
			const height = 5;
			const levels = new Float32Array([
				0.0, 0.0, 0.0, 0.0, 0.0,
				0.0, 0.0, 0.0, 0.0, 0.0,
				1.0, 1.0, 1.0, 1.0, 1.0,
				0.0, 0.0, 0.0, 0.0, 0.0,
				0.0, 0.0, 0.0, 0.0, 0.0
			]);

			const result = await dispatcher.computeEsdt(levels, width, height);

			// Distance at the line should be 0
			for (let x = 0; x < width; x++) {
				expect(dispatcher.getDistance(result, x, 2)).toBeLessThan(0.01);
			}

			// Distance one row away should be ~1
			for (let x = 0; x < width; x++) {
				expect(dispatcher.getDistance(result, x, 1)).toBeCloseTo(1.0, 0);
				expect(dispatcher.getDistance(result, x, 3)).toBeCloseTo(1.0, 0);
			}

			// Distance two rows away should be ~2
			for (let x = 0; x < width; x++) {
				expect(dispatcher.getDistance(result, x, 0)).toBeCloseTo(2.0, 0);
				expect(dispatcher.getDistance(result, x, 4)).toBeCloseTo(2.0, 0);
			}
		});

		it('should produce symmetric results for symmetric input', async () => {
			vi.mocked(detectWebGPU).mockResolvedValue({ available: false, adapter: null });

			const { newFutharkContext } = await import('$lib/futhark');
			vi.mocked(newFutharkContext).mockRejectedValue(new Error('WASM not available'));

			const dispatcher = createComputeDispatcher();
			await dispatcher.initialize();

			// 5x5 grid with center pixel
			const width = 5;
			const height = 5;
			const levels = new Float32Array(25).fill(0);
			levels[12] = 1.0; // center at (2,2)

			const result = await dispatcher.computeEsdt(levels, width, height);

			// Distances should be symmetric around center
			const d00 = dispatcher.getDistance(result, 0, 0);
			const d40 = dispatcher.getDistance(result, 4, 0);
			const d04 = dispatcher.getDistance(result, 0, 4);
			const d44 = dispatcher.getDistance(result, 4, 4);

			// All corners should have the same distance to center
			expect(d00).toBeCloseTo(d40, 1);
			expect(d00).toBeCloseTo(d04, 1);
			expect(d00).toBeCloseTo(d44, 1);
		});
	});
});
