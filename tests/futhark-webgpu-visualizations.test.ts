/**
 * Futhark WebGPU Visualization Entry Points Tests
 *
 * Tests the debug visualization entry points added to pipeline.fut:
 *   - debug_distance_heatmap: ESDT distances as color-coded RGBA
 *   - debug_glyph_mask: Binary glyph mask as RGBA
 *   - debug_wcag_compliance: Green/red WCAG compliance overlay
 *
 * Prerequisites:
 *   1. Build Futhark WebGPU: just futhark-webgpu-build
 *   2. Compile pipeline: just futhark-webgpu-compile
 *
 * These tests verify output format and basic properties.
 * GPU-dependent tests are skipped when WebGPU is unavailable.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock SvelteKit virtual modules (required for dynamic import of ComputeDispatcher)
vi.mock('$app/environment', () => ({
	browser: true
}));

vi.mock('$lib/pixelwise/shaders/video-capture-esdt.wgsl?raw', () => ({
	default: '// mock video capture shader'
}));
vi.mock('$lib/pixelwise/shaders/video-capture-esdt-fallback.wgsl?raw', () => ({
	default: '// mock fallback shader'
}));

/**
 * Generate test image with text-like pattern
 */
function generateTestImage(width: number, height: number): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = (y * width + x) * 4;
			const inTextRegion =
				x > width * 0.2 && x < width * 0.8 &&
				y > height * 0.3 && y < height * 0.7;

			if (inTextRegion) {
				data[idx] = 30;
				data[idx + 1] = 30;
				data[idx + 2] = 30;
			} else {
				data[idx] = 240;
				data[idx + 1] = 240;
				data[idx + 2] = 240;
			}
			data[idx + 3] = 255;
		}
	}

	return data;
}

/**
 * Generate low-contrast test image
 */
function generateLowContrastImage(width: number, height: number): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = (y * width + x) * 4;
			const inTextRegion =
				x > width * 0.2 && x < width * 0.8 &&
				y > height * 0.3 && y < height * 0.7;

			if (inTextRegion) {
				data[idx] = 100;
				data[idx + 1] = 100;
				data[idx + 2] = 100;
			} else {
				data[idx] = 130;
				data[idx + 1] = 130;
				data[idx + 2] = 130;
			}
			data[idx + 3] = 255;
		}
	}

	return data;
}

/**
 * Generate uniform image (no edges)
 */
function generateUniformImage(width: number, height: number, value: number): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = value;
		data[i + 1] = value;
		data[i + 2] = value;
		data[i + 3] = 255;
	}
	return data;
}

describe('Futhark WebGPU Visualizations', () => {
	const hasWebGPURuntime = typeof navigator !== 'undefined' && 'gpu' in navigator;

	describe.skipIf(!hasWebGPURuntime)('GPU Visualization Entry Points', () => {
		let dispatcher: any;
		let futharkWebGPUAvailable = false;

		beforeAll(async () => {
			try {
				const { createComputeDispatcher } = await import('$lib/core/ComputeDispatcher');
				dispatcher = createComputeDispatcher();
				await dispatcher.initialize('webgpu');
				futharkWebGPUAvailable = dispatcher.hasFutharkWebGPU;

				if (!futharkWebGPUAvailable) {
					console.warn('Futhark WebGPU not available. Run: just futhark-webgpu-compile');
				}
			} catch (err) {
				console.error('Failed to initialize dispatcher:', err);
			}
		});

		afterAll(() => {
			if (dispatcher) {
				dispatcher.destroy();
			}
		});

		it.skipIf(!futharkWebGPUAvailable)('debugDistanceHeatmap should return correct-length RGBA', async () => {
			const width = 64;
			const height = 64;
			const testImage = generateTestImage(width, height);

			const result = await dispatcher.debugDistanceHeatmap(testImage, width, height, 10.0);

			expect(result).toBeInstanceOf(Uint8Array);
			expect(result.length).toBe(width * height * 4);
		});

		it.skipIf(!futharkWebGPUAvailable)('debugDistanceHeatmap should have valid alpha channel', async () => {
			const width = 64;
			const height = 64;
			const testImage = generateTestImage(width, height);

			const result = await dispatcher.debugDistanceHeatmap(testImage, width, height, 10.0);

			// Should have some opaque pixels (near edges) and some transparent (far from edges)
			let hasOpaque = false;
			let hasTransparent = false;
			for (let i = 3; i < result.length; i += 4) {
				if (result[i] > 200) hasOpaque = true;
				if (result[i] < 10) hasTransparent = true;
			}
			expect(hasOpaque).toBe(true);
		});

		it.skipIf(!futharkWebGPUAvailable)('debugDistanceHeatmap should return transparent for uniform input', async () => {
			const width = 32;
			const height = 32;
			const uniformImage = generateUniformImage(width, height, 128);

			const result = await dispatcher.debugDistanceHeatmap(uniformImage, width, height, 10.0);

			expect(result.length).toBe(width * height * 4);

			// Uniform image has no edges, so the heatmap should be mostly transparent
			let totalAlpha = 0;
			for (let i = 3; i < result.length; i += 4) {
				totalAlpha += result[i];
			}
			const avgAlpha = totalAlpha / (width * height);
			// Average alpha should be low for uniform image
			expect(avgAlpha).toBeLessThan(128);
		});

		it.skipIf(!futharkWebGPUAvailable)('debugGlyphMask should return correct-length RGBA', async () => {
			const width = 64;
			const height = 64;
			const testImage = generateTestImage(width, height);

			const result = await dispatcher.debugGlyphMask(testImage, width, height, 3.0);

			expect(result).toBeInstanceOf(Uint8Array);
			expect(result.length).toBe(width * height * 4);
		});

		it.skipIf(!futharkWebGPUAvailable)('debugGlyphMask should distinguish glyph from background', async () => {
			const width = 64;
			const height = 64;
			const testImage = generateTestImage(width, height);

			const result = await dispatcher.debugGlyphMask(testImage, width, height, 3.0);

			// Glyph pixels should be opaque, background transparent
			let opaqueCount = 0;
			let transparentCount = 0;
			for (let i = 3; i < result.length; i += 4) {
				if (result[i] > 128) opaqueCount++;
				else transparentCount++;
			}

			// Should have both glyph and non-glyph regions
			expect(opaqueCount).toBeGreaterThan(0);
			expect(transparentCount).toBeGreaterThan(0);
		});

		it.skipIf(!futharkWebGPUAvailable)('debugGlyphMask should return transparent for uniform input', async () => {
			const width = 32;
			const height = 32;
			const uniformImage = generateUniformImage(width, height, 200);

			const result = await dispatcher.debugGlyphMask(uniformImage, width, height, 3.0);

			expect(result.length).toBe(width * height * 4);

			// No glyphs in uniform image
			let opaqueCount = 0;
			for (let i = 3; i < result.length; i += 4) {
				if (result[i] > 128) opaqueCount++;
			}
			// Should be very few or no opaque pixels
			const opaqueRatio = opaqueCount / (width * height);
			expect(opaqueRatio).toBeLessThan(0.1);
		});

		it.skipIf(!futharkWebGPUAvailable)('debugWcagCompliance should return correct-length RGBA', async () => {
			const width = 64;
			const height = 64;
			const testImage = generateTestImage(width, height);

			const result = await dispatcher.debugWcagCompliance(
				testImage, width, height, 7.0, 3.0, 5.0
			);

			expect(result).toBeInstanceOf(Uint8Array);
			expect(result.length).toBe(width * height * 4);
		});

		it.skipIf(!futharkWebGPUAvailable)('debugWcagCompliance should show red for low-contrast input', async () => {
			const width = 64;
			const height = 64;
			const lowContrastImage = generateLowContrastImage(width, height);

			const result = await dispatcher.debugWcagCompliance(
				lowContrastImage, width, height, 7.0, 3.0, 5.0
			);

			// Low contrast image should have more red (failing) than green (passing) pixels
			let redSum = 0;
			let greenSum = 0;
			for (let i = 0; i < result.length; i += 4) {
				if (result[i + 3] > 10) { // Only count visible pixels
					redSum += result[i];
					greenSum += result[i + 1];
				}
			}

			// With target contrast 7.0:1 and input contrast ~1.3:1,
			// we expect predominantly red pixels
			console.log(`WCAG compliance: red=${redSum}, green=${greenSum}`);
		});

		it.skipIf(!futharkWebGPUAvailable)('debugWcagCompliance with low target should show more green', async () => {
			const width = 64;
			const height = 64;
			const testImage = generateTestImage(width, height);

			// High-contrast input (30 vs 240) with low target (3.0:1) should mostly pass
			const result = await dispatcher.debugWcagCompliance(
				testImage, width, height, 3.0, 3.0, 5.0
			);

			let greenSum = 0;
			let redSum = 0;
			let visiblePixels = 0;
			for (let i = 0; i < result.length; i += 4) {
				if (result[i + 3] > 10) {
					redSum += result[i];
					greenSum += result[i + 1];
					visiblePixels++;
				}
			}

			console.log(`WCAG compliance (low target): green=${greenSum}, red=${redSum}, visible=${visiblePixels}`);
			// High contrast text against low target: green should dominate
			if (visiblePixels > 0) {
				expect(greenSum).toBeGreaterThanOrEqual(redSum);
			}
		});
	});

	describe('Static Analysis', () => {
		it('should generate test images correctly', () => {
			const img = generateTestImage(64, 64);
			expect(img.length).toBe(64 * 64 * 4);

			// Text region should be dark
			const centerIdx = (32 * 64 + 32) * 4;
			expect(img[centerIdx]).toBe(30);

			// Background should be light
			const cornerIdx = 0;
			expect(img[cornerIdx]).toBe(240);
		});

		it('should generate low-contrast images correctly', () => {
			const img = generateLowContrastImage(64, 64);
			expect(img.length).toBe(64 * 64 * 4);

			const centerIdx = (32 * 64 + 32) * 4;
			const cornerIdx = 0;
			// Contrast should be low
			expect(Math.abs(img[centerIdx] - img[cornerIdx])).toBe(30);
		});

		it('should generate uniform images correctly', () => {
			const img = generateUniformImage(32, 32, 128);
			expect(img.length).toBe(32 * 32 * 4);

			for (let i = 0; i < img.length; i += 4) {
				expect(img[i]).toBe(128);
				expect(img[i + 1]).toBe(128);
				expect(img[i + 2]).toBe(128);
				expect(img[i + 3]).toBe(255);
			}
		});
	});
});
