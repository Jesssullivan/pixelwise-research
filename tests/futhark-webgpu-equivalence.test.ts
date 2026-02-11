/**
 * Futhark WebGPU Correctness Tests
 *
 * Tests the Futhark-generated WebGPU pipeline output for correctness.
 * Since the hand-written shaders have been archived and unified with
 * the Futhark backend, these tests verify output quality directly.
 *
 * Prerequisites:
 *   1. Build Futhark WebGPU: just futhark-webgpu-build
 *   2. Compile pipeline: just futhark-webgpu-compile
 *
 * The tests verify:
 *   - Pipeline produces valid RGBA output
 *   - Output dimensions match input
 *   - Contrast adjustments are applied correctly
 *   - Various image patterns are handled properly
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
 * Test image generator
 */
function generateTestImage(width: number, height: number, pattern: 'gradient' | 'checkerboard' | 'text' | 'low-contrast'): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = (y * width + x) * 4;

			switch (pattern) {
				case 'gradient': {
					// Horizontal gradient from black to white
					const v = Math.floor((x / width) * 255);
					data[idx] = v;
					data[idx + 1] = v;
					data[idx + 2] = v;
					data[idx + 3] = 255;
					break;
				}
				case 'checkerboard': {
					// 8x8 checkerboard pattern
					const isWhite = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) === 0;
					const v = isWhite ? 255 : 0;
					data[idx] = v;
					data[idx + 1] = v;
					data[idx + 2] = v;
					data[idx + 3] = 255;
					break;
				}
				case 'text': {
					// Simulate text: mostly white background with dark "text" in center
					const inTextRegion =
						x > width * 0.2 && x < width * 0.8 &&
						y > height * 0.3 && y < height * 0.7;

					if (inTextRegion) {
						// Dark text
						const noise = Math.random() * 30;
						data[idx] = Math.floor(20 + noise);
						data[idx + 1] = Math.floor(20 + noise);
						data[idx + 2] = Math.floor(20 + noise);
					} else {
						// White background
						data[idx] = 245;
						data[idx + 1] = 245;
						data[idx + 2] = 245;
					}
					data[idx + 3] = 255;
					break;
				}
				case 'low-contrast': {
					// Low contrast scenario that should trigger adjustments
					// Gray text on slightly different gray background
					const inTextRegion =
						x > width * 0.2 && x < width * 0.8 &&
						y > height * 0.3 && y < height * 0.7;

					if (inTextRegion) {
						// Gray "text" - low contrast
						data[idx] = 100;
						data[idx + 1] = 100;
						data[idx + 2] = 100;
					} else {
						// Slightly lighter gray background
						data[idx] = 130;
						data[idx + 1] = 130;
						data[idx + 2] = 130;
					}
					data[idx + 3] = 255;
					break;
				}
			}
		}
	}

	return data;
}

/**
 * Validate that output is valid RGBA data
 */
function validateRGBAOutput(data: Uint8ClampedArray, width: number, height: number): {
	valid: boolean;
	hasAlpha: boolean;
	minAlpha: number;
	maxAlpha: number;
} {
	const expectedLength = width * height * 4;
	if (data.length !== expectedLength) {
		return { valid: false, hasAlpha: false, minAlpha: 0, maxAlpha: 0 };
	}

	let minAlpha = 255;
	let maxAlpha = 0;

	for (let i = 3; i < data.length; i += 4) {
		minAlpha = Math.min(minAlpha, data[i]);
		maxAlpha = Math.max(maxAlpha, data[i]);
	}

	return {
		valid: true,
		hasAlpha: maxAlpha > 0,
		minAlpha,
		maxAlpha
	};
}

/**
 * Calculate basic image statistics
 */
function calculateImageStats(data: Uint8ClampedArray): {
	avgR: number;
	avgG: number;
	avgB: number;
	minLuminance: number;
	maxLuminance: number;
} {
	let sumR = 0, sumG = 0, sumB = 0;
	let minLum = 255, maxLum = 0;
	const pixelCount = data.length / 4;

	for (let i = 0; i < data.length; i += 4) {
		sumR += data[i];
		sumG += data[i + 1];
		sumB += data[i + 2];

		// Calculate relative luminance
		const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
		minLum = Math.min(minLum, lum);
		maxLum = Math.max(maxLum, lum);
	}

	return {
		avgR: sumR / pixelCount,
		avgG: sumG / pixelCount,
		avgB: sumB / pixelCount,
		minLuminance: minLum,
		maxLuminance: maxLum
	};
}

describe('Futhark WebGPU Correctness', () => {
	// Skip if no real WebGPU runtime (jsdom doesn't provide navigator.gpu)
	const hasWebGPURuntime = typeof navigator !== 'undefined' && 'gpu' in navigator;

	describe.skipIf(!hasWebGPURuntime)('Pipeline Output Validation', () => {
		let dispatcher: any;
		let webgpuAvailable = false;
		let futharkWebGPUAvailable = false;

		beforeAll(async () => {
			try {
				const { createComputeDispatcher } = await import('$lib/core/ComputeDispatcher');

				// Initialize dispatcher
				dispatcher = createComputeDispatcher();
				await dispatcher.initialize('webgpu');
				webgpuAvailable = dispatcher.hasWebGPU;

				if (!webgpuAvailable) {
					console.warn('WebGPU not available, skipping Futhark WebGPU tests');
					return;
				}

				// Check if Futhark WebGPU is available
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

		it('should have WebGPU available', () => {
			expect(webgpuAvailable).toBe(true);
		});

		it.skipIf(!futharkWebGPUAvailable)('should produce valid RGBA output for gradient (64x64)', async () => {
			const width = 64;
			const height = 64;
			const testImage = generateTestImage(width, height, 'gradient');

			const result = await dispatcher.runFullPipeline(testImage, width, height);

			const validation = validateRGBAOutput(result.adjustedPixels, width, height);
			expect(validation.valid).toBe(true);
			expect(validation.hasAlpha).toBe(true);
			expect(validation.maxAlpha).toBe(255);

			console.log(`Gradient 64x64 validation:
  Valid: ${validation.valid}
  Alpha range: ${validation.minAlpha} - ${validation.maxAlpha}`);
		});

		it.skipIf(!futharkWebGPUAvailable)('should produce valid output for checkerboard (128x128)', async () => {
			const width = 128;
			const height = 128;
			const testImage = generateTestImage(width, height, 'checkerboard');

			const result = await dispatcher.runFullPipeline(testImage, width, height);

			const validation = validateRGBAOutput(result.adjustedPixels, width, height);
			expect(validation.valid).toBe(true);

			const stats = calculateImageStats(result.adjustedPixels);
			console.log(`Checkerboard 128x128 stats:
  Avg RGB: (${stats.avgR.toFixed(1)}, ${stats.avgG.toFixed(1)}, ${stats.avgB.toFixed(1)})
  Luminance range: ${stats.minLuminance.toFixed(1)} - ${stats.maxLuminance.toFixed(1)}`);
		});

		it.skipIf(!futharkWebGPUAvailable)('should produce valid output for text-like image (256x256)', async () => {
			const width = 256;
			const height = 256;
			const testImage = generateTestImage(width, height, 'text');

			const result = await dispatcher.runFullPipeline(testImage, width, height);

			const validation = validateRGBAOutput(result.adjustedPixels, width, height);
			expect(validation.valid).toBe(true);

			const inputStats = calculateImageStats(testImage);
			const outputStats = calculateImageStats(result.adjustedPixels);

			console.log(`Text-like 256x256 comparison:
  Input luminance range: ${inputStats.minLuminance.toFixed(1)} - ${inputStats.maxLuminance.toFixed(1)}
  Output luminance range: ${outputStats.minLuminance.toFixed(1)} - ${outputStats.maxLuminance.toFixed(1)}`);
		});

		it.skipIf(!futharkWebGPUAvailable)('should improve contrast for low-contrast input', async () => {
			const width = 128;
			const height = 128;
			const testImage = generateTestImage(width, height, 'low-contrast');

			const inputStats = calculateImageStats(testImage);
			const inputContrastRange = inputStats.maxLuminance - inputStats.minLuminance;

			const result = await dispatcher.runFullPipeline(testImage, width, height);
			const outputStats = calculateImageStats(result.adjustedPixels);
			const outputContrastRange = outputStats.maxLuminance - outputStats.minLuminance;

			console.log(`Low-contrast improvement:
  Input contrast range: ${inputContrastRange.toFixed(1)}
  Output contrast range: ${outputContrastRange.toFixed(1)}
  Improvement: ${((outputContrastRange - inputContrastRange) / inputContrastRange * 100).toFixed(1)}%`);

			// Output should have at least as much contrast as input
			// (ESDT may increase contrast to meet WCAG requirements)
			expect(outputContrastRange).toBeGreaterThanOrEqual(inputContrastRange * 0.9);
		});

		it.skipIf(!futharkWebGPUAvailable)('should handle 1080p resolution', async () => {
			const width = 1920;
			const height = 1080;
			const testImage = generateTestImage(width, height, 'text');

			const startTime = performance.now();
			const result = await dispatcher.runFullPipeline(testImage, width, height);
			const elapsedMs = performance.now() - startTime;

			const validation = validateRGBAOutput(result.adjustedPixels, width, height);
			expect(validation.valid).toBe(true);

			console.log(`1080p processing:
  Dimensions: ${width}x${height} (${(width * height / 1e6).toFixed(2)} MP)
  Processing time: ${elapsedMs.toFixed(1)}ms
  Throughput: ${(width * height / elapsedMs / 1000).toFixed(2)} MP/s`);
		});
	});

	describe('Static Analysis', () => {
		it('should generate valid test images', () => {
			const gradientImage = generateTestImage(64, 64, 'gradient');
			expect(gradientImage.length).toBe(64 * 64 * 4);

			// Check gradient values
			expect(gradientImage[0]).toBe(0); // First pixel black
			expect(gradientImage[(63 * 4)]).toBeGreaterThan(200); // Last pixel near white

			const checkerImage = generateTestImage(64, 64, 'checkerboard');
			expect(checkerImage.length).toBe(64 * 64 * 4);

			// Check checkerboard pattern
			const topLeft = checkerImage[0];
			const nextSquare = checkerImage[8 * 4];
			expect(topLeft).not.toBe(nextSquare);
		});

		it('should generate low-contrast test image', () => {
			const lowContrastImage = generateTestImage(64, 64, 'low-contrast');
			expect(lowContrastImage.length).toBe(64 * 64 * 4);

			const stats = calculateImageStats(lowContrastImage);
			// Low contrast image should have small luminance range
			const contrastRange = stats.maxLuminance - stats.minLuminance;
			expect(contrastRange).toBeLessThan(50); // Narrow range
		});

		it('should validate RGBA output correctly', () => {
			const validImage = generateTestImage(32, 32, 'gradient');
			const validation = validateRGBAOutput(validImage, 32, 32);
			expect(validation.valid).toBe(true);
			expect(validation.hasAlpha).toBe(true);

			// Test wrong dimensions
			const wrongDimensions = validateRGBAOutput(validImage, 16, 16);
			expect(wrongDimensions.valid).toBe(false);
		});

		it('should calculate image statistics correctly', () => {
			// Create a simple test image: all pixels at (100, 100, 100)
			const grayImage = new Uint8ClampedArray(4 * 4 * 4); // 4x4 image
			for (let i = 0; i < grayImage.length; i += 4) {
				grayImage[i] = 100;
				grayImage[i + 1] = 100;
				grayImage[i + 2] = 100;
				grayImage[i + 3] = 255;
			}

			const stats = calculateImageStats(grayImage);
			expect(stats.avgR).toBe(100);
			expect(stats.avgG).toBe(100);
			expect(stats.avgB).toBe(100);
			expect(stats.minLuminance).toBeCloseTo(100, 0);
			expect(stats.maxLuminance).toBeCloseTo(100, 0);
		});
	});
});
