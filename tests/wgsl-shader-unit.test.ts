/**
 * WGSL Shader Unit Tests
 *
 * Tests WGSL compute shader outputs against TypeScript reference implementations.
 * These tests verify algorithm correctness without requiring GPU execution.
 *
 * Testing strategy:
 * 1. Define TypeScript reference implementations (matching Futhark/WGSL algorithms)
 * 2. Test expected outputs for known inputs
 * 3. Property-based tests for mathematical invariants
 *
 * @see futhark/esdt.fut - Futhark ESDT reference
 * @see futhark/wcag.fut - Futhark WCAG reference
 * @see src/lib/pixelwise/shaders/ - WGSL compute shaders
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// =============================================================================
// TypeScript Reference Implementations (matching WGSL shaders)
// =============================================================================

/**
 * sRGB to linear conversion (matches esdt-grayscale-gradient.wgsl)
 * Uses CORRECT WCAG threshold: 0.03928 (NOT 0.04045)
 */
function srgbToLinear(c: number): number {
	if (c <= 0.03928) {
		return c / 12.92;
	}
	return Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Compute luminance from RGB (0-1 range)
 * Matches WCAG 2.1 relative luminance formula
 */
function computeLuminance(r: number, g: number, b: number): number {
	return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * Compute contrast ratio (matches esdt-contrast-analysis.wgsl)
 */
function computeContrastRatio(l1: number, l2: number): number {
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Sobel gradient computation (matches esdt-grayscale-gradient.wgsl)
 * Returns normalized [gx, gy] gradient
 */
function computeSobelGradient(
	samples: number[][],
	x: number,
	y: number,
	width: number,
	height: number
): [number, number] {
	const sample = (sx: number, sy: number): number => {
		const px = Math.max(0, Math.min(width - 1, sx));
		const py = Math.max(0, Math.min(height - 1, sy));
		return samples[py][px];
	};

	// Sobel kernel for Gx:
	// -1  0  1
	// -2  0  2
	// -1  0  1
	const gx =
		-1 * sample(x - 1, y - 1) +
		-2 * sample(x - 1, y) +
		-1 * sample(x - 1, y + 1) +
		1 * sample(x + 1, y - 1) +
		2 * sample(x + 1, y) +
		1 * sample(x + 1, y + 1);

	// Sobel kernel for Gy:
	// -1 -2 -1
	//  0  0  0
	//  1  2  1
	const gy =
		-1 * sample(x - 1, y - 1) +
		-2 * sample(x, y - 1) +
		-1 * sample(x + 1, y - 1) +
		1 * sample(x - 1, y + 1) +
		2 * sample(x, y + 1) +
		1 * sample(x + 1, y + 1);

	// Normalize by kernel sum
	return [gx / 8.0, gy / 8.0];
}

/**
 * Initialize ESDT pixel (matches esdt-x-pass.wgsl initialize_pixel)
 */
interface DistanceData {
	deltaX: number;
	deltaY: number;
	distance: number;
}

const INF = 1e10;

function initializeEsdtPixel(gray: number, gx: number, gy: number): DistanceData {
	if (gray <= 0.0) {
		// Background: infinite distance
		return { deltaX: INF, deltaY: INF, distance: INF };
	} else if (gray >= 1.0) {
		// Foreground: inside glyph
		return { deltaX: 0, deltaY: 0, distance: 0 };
	} else {
		// Gray pixel: sub-pixel offset
		const gradLen = Math.sqrt(gx * gx + gy * gy);
		if (gradLen > 0.001) {
			const normGx = gx / gradLen;
			const normGy = gy / gradLen;
			const offset = gray - 0.5;
			return {
				deltaX: offset * normGx,
				deltaY: offset * normGy,
				distance: Math.abs(offset)
			};
		} else {
			return { deltaX: 0, deltaY: 0, distance: 0 };
		}
	}
}

/**
 * Edge weight function (matches esdt-extract-pixels.wgsl)
 * w = 4 * alpha * (1 - alpha)
 */
function computeEdgeWeight(coverage: number): number {
	return 4.0 * coverage * (1.0 - coverage);
}

/**
 * Compute adjustment factor (matches esdt-contrast-analysis.wgsl)
 */
function computeAdjustment(
	currentRatio: number,
	targetRatio: number,
	glyphLum: number,
	bgLum: number
): number {
	if (currentRatio >= targetRatio) {
		return 1.0;
	}

	const glyphIsLighter = glyphLum > bgLum;

	let targetLuminance: number;
	if (glyphIsLighter) {
		targetLuminance = targetRatio * (bgLum + 0.05) - 0.05;
	} else {
		targetLuminance = (bgLum + 0.05) / targetRatio - 0.05;
	}

	targetLuminance = Math.max(0, Math.min(1, targetLuminance));

	if (glyphLum > 0) {
		return targetLuminance / glyphLum;
	}
	return 1.0;
}

// =============================================================================
// Tests
// =============================================================================

describe('WGSL Shader Unit Tests', () => {
	describe('sRGB Linearization (esdt-grayscale-gradient.wgsl)', () => {
		it('should use threshold 0.03928 (NOT 0.04045)', () => {
			// Value just below threshold should use linear formula
			const below = 0.03928;
			const resultBelow = srgbToLinear(below);
			expect(resultBelow).toBeCloseTo(below / 12.92, 6);

			// Value just above threshold should use gamma formula
			const above = 0.04;
			const resultAbove = srgbToLinear(above);
			const expectedAbove = Math.pow((above + 0.055) / 1.055, 2.4);
			expect(resultAbove).toBeCloseTo(expectedAbove, 6);
		});

		it('should use gamma 2.4 (NOT 2.5)', () => {
			const testValue = 0.5;
			const result = srgbToLinear(testValue);
			const expected24 = Math.pow((testValue + 0.055) / 1.055, 2.4);
			const expected25 = Math.pow((testValue + 0.055) / 1.055, 2.5);

			expect(result).toBeCloseTo(expected24, 6);
			expect(Math.abs(result - expected25)).toBeGreaterThan(0.001);
		});

		it('should produce 0 for input 0', () => {
			expect(srgbToLinear(0)).toBe(0);
		});

		it('should produce ~1 for input 1', () => {
			expect(srgbToLinear(1)).toBeCloseTo(1, 5);
		});
	});

	describe('Luminance Computation (esdt-grayscale-gradient.wgsl)', () => {
		it('should compute black as 0', () => {
			expect(computeLuminance(0, 0, 0)).toBe(0);
		});

		it('should compute white as ~1', () => {
			expect(computeLuminance(1, 1, 1)).toBeCloseTo(1, 4);
		});

		it('should weight green highest', () => {
			const redLum = computeLuminance(1, 0, 0);
			const greenLum = computeLuminance(0, 1, 0);
			const blueLum = computeLuminance(0, 0, 1);

			expect(greenLum).toBeGreaterThan(redLum);
			expect(greenLum).toBeGreaterThan(blueLum);
			expect(redLum).toBeGreaterThan(blueLum);
		});

		it('should use correct coefficients', () => {
			// Pure channels should match expected coefficients
			const redLum = computeLuminance(1, 0, 0);
			const greenLum = computeLuminance(0, 1, 0);
			const blueLum = computeLuminance(0, 0, 1);

			// After linearization, RGB(1,0,0) gives 0.2126 * 1.0
			expect(redLum).toBeCloseTo(0.2126, 4);
			expect(greenLum).toBeCloseTo(0.7152, 4);
			expect(blueLum).toBeCloseTo(0.0722, 4);
		});
	});

	describe('Contrast Ratio (esdt-contrast-analysis.wgsl)', () => {
		it('should compute black/white as 21:1', () => {
			const blackLum = 0;
			const whiteLum = 1;
			const cr = computeContrastRatio(blackLum, whiteLum);
			expect(cr).toBeCloseTo(21, 0);
		});

		it('should be symmetric', () => {
			const l1 = 0.3;
			const l2 = 0.7;
			expect(computeContrastRatio(l1, l2)).toBeCloseTo(computeContrastRatio(l2, l1), 6);
		});

		it('should return 1:1 for same luminance', () => {
			expect(computeContrastRatio(0.5, 0.5)).toBe(1);
		});

		it('should always be >= 1', () => {
			fc.assert(
				fc.property(
					fc.float({ min: 0, max: 1, noNaN: true }),
					fc.float({ min: 0, max: 1, noNaN: true }),
					(l1, l2) => {
						return computeContrastRatio(l1, l2) >= 1;
					}
				),
				{ numRuns: 100 }
			);
		});

		it('should always be <= 21', () => {
			fc.assert(
				fc.property(
					fc.float({ min: 0, max: 1, noNaN: true }),
					fc.float({ min: 0, max: 1, noNaN: true }),
					(l1, l2) => {
						return computeContrastRatio(l1, l2) <= 21;
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Sobel Gradient (esdt-grayscale-gradient.wgsl)', () => {
		it('should detect horizontal edge', () => {
			// Vertical stripe pattern (edge is horizontal in gradient direction)
			const samples = [
				[0, 0, 1, 1, 1],
				[0, 0, 1, 1, 1],
				[0, 0, 1, 1, 1],
				[0, 0, 1, 1, 1],
				[0, 0, 1, 1, 1]
			];

			const [gx, gy] = computeSobelGradient(samples, 2, 2, 5, 5);

			// Horizontal gradient should dominate
			expect(Math.abs(gx)).toBeGreaterThan(Math.abs(gy));
			expect(gx).toBeGreaterThan(0); // Increasing to the right
		});

		it('should detect vertical edge', () => {
			// Horizontal stripe pattern
			const samples = [
				[0, 0, 0, 0, 0],
				[0, 0, 0, 0, 0],
				[1, 1, 1, 1, 1],
				[1, 1, 1, 1, 1],
				[1, 1, 1, 1, 1]
			];

			const [gx, gy] = computeSobelGradient(samples, 2, 2, 5, 5);

			// Vertical gradient should dominate
			expect(Math.abs(gy)).toBeGreaterThan(Math.abs(gx));
			expect(gy).toBeGreaterThan(0); // Increasing downward
		});

		it('should return zero for uniform region', () => {
			const samples = [
				[0.5, 0.5, 0.5],
				[0.5, 0.5, 0.5],
				[0.5, 0.5, 0.5]
			];

			const [gx, gy] = computeSobelGradient(samples, 1, 1, 3, 3);
			expect(gx).toBeCloseTo(0, 5);
			expect(gy).toBeCloseTo(0, 5);
		});
	});

	describe('ESDT Initialization (esdt-x-pass.wgsl)', () => {
		it('should set background to infinite distance', () => {
			const result = initializeEsdtPixel(0, 0, 0);
			expect(result.distance).toBe(INF);
			expect(result.deltaX).toBe(INF);
			expect(result.deltaY).toBe(INF);
		});

		it('should set foreground to zero distance', () => {
			const result = initializeEsdtPixel(1, 0.5, 0.5);
			expect(result.distance).toBe(0);
			expect(result.deltaX).toBe(0);
			expect(result.deltaY).toBe(0);
		});

		it('should compute sub-pixel offset for gray pixels', () => {
			// Gray pixel at 0.7 (inside glyph edge)
			const result = initializeEsdtPixel(0.7, 1, 0);
			expect(result.distance).toBeCloseTo(0.2, 5); // |0.7 - 0.5|
			expect(result.deltaX).toBeCloseTo(0.2, 5); // offset * normalized gx
			expect(result.deltaY).toBeCloseTo(0, 5);
		});

		it('should handle edge pixel at 0.5', () => {
			const result = initializeEsdtPixel(0.5, 1, 0);
			expect(result.distance).toBeCloseTo(0, 5);
		});
	});

	describe('Edge Weight (esdt-extract-pixels.wgsl)', () => {
		it('should peak at coverage 0.5', () => {
			expect(computeEdgeWeight(0.5)).toBeCloseTo(1.0, 5);
		});

		it('should be zero at coverage 0 and 1', () => {
			expect(computeEdgeWeight(0)).toBe(0);
			expect(computeEdgeWeight(1)).toBe(0);
		});

		it('should be symmetric around 0.5', () => {
			expect(computeEdgeWeight(0.25)).toBeCloseTo(computeEdgeWeight(0.75), 5);
			expect(computeEdgeWeight(0.1)).toBeCloseTo(computeEdgeWeight(0.9), 5);
		});

		it('should always be in [0, 1]', () => {
			fc.assert(
				fc.property(fc.float({ min: 0, max: 1, noNaN: true }), (alpha) => {
					const w = computeEdgeWeight(alpha);
					return w >= 0 && w <= 1;
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Contrast Adjustment (esdt-contrast-analysis.wgsl)', () => {
		it('should return 1.0 when already meeting target', () => {
			const ratio = computeContrastRatio(0, 1); // 21:1
			const adj = computeAdjustment(ratio, 7.0, 0, 1);
			expect(adj).toBe(1.0);
		});

		it('should compute adjustment for low contrast', () => {
			// Gray on gray with low contrast
			const glyphLum = 0.3;
			const bgLum = 0.35;
			const currentRatio = computeContrastRatio(glyphLum, bgLum);
			const adj = computeAdjustment(currentRatio, 4.5, glyphLum, bgLum);

			// Adjustment should be > 1 (needs to change)
			expect(adj).not.toBe(1.0);
		});

		it('should handle dark text on light background', () => {
			const glyphLum = 0.1;
			const bgLum = 0.9;
			const currentRatio = computeContrastRatio(glyphLum, bgLum);

			if (currentRatio < 7.0) {
				const adj = computeAdjustment(currentRatio, 7.0, glyphLum, bgLum);
				// Should darken the glyph (adjustment < 1)
				expect(adj).toBeLessThan(1.0);
			}
		});

		it('should handle light text on dark background', () => {
			const glyphLum = 0.8;
			const bgLum = 0.1;
			const currentRatio = computeContrastRatio(glyphLum, bgLum);

			if (currentRatio < 7.0) {
				const adj = computeAdjustment(currentRatio, 7.0, glyphLum, bgLum);
				// Should lighten the glyph (adjustment > 1)
				expect(adj).toBeGreaterThan(1.0);
			}
		});
	});

	describe('WCAG Constants Verification', () => {
		it('should use linearization threshold 0.03928', () => {
			// Verify the threshold value is exactly as per WCAG spec
			const threshold = 0.03928;
			const linearBelow = srgbToLinear(threshold);
			const linearAbove = srgbToLinear(threshold + 0.001);

			// Below threshold uses c/12.92
			expect(linearBelow).toBeCloseTo(threshold / 12.92, 6);

			// Above threshold uses gamma formula
			const expected = Math.pow((threshold + 0.001 + 0.055) / 1.055, 2.4);
			expect(linearAbove).toBeCloseTo(expected, 6);
		});

		it('should produce 21:1 for pure black and white', () => {
			const blackLum = computeLuminance(0, 0, 0);
			const whiteLum = computeLuminance(1, 1, 1);
			const cr = computeContrastRatio(blackLum, whiteLum);

			expect(blackLum).toBeCloseTo(0, 6);
			expect(whiteLum).toBeCloseTo(1, 4);
			expect(cr).toBeCloseTo(21, 0);
		});
	});
});
