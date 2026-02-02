/**
 * Property-Based Tests for WebGPU Pipeline
 *
 * Tests critical invariants:
 * 1. bytesPerRow alignment (must be multiple of 256)
 * 2. Buffer size calculations
 * 3. Row padding/unpadding correctness
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Calculate aligned bytesPerRow for WebGPU texture-buffer copies
 * Must be a multiple of 256 per WebGPU spec
 */
function alignedBytesPerRow(width: number, bytesPerPixel: number = 4): number {
	const unaligned = width * bytesPerPixel;
	return Math.ceil(unaligned / 256) * 256;
}

/**
 * Calculate padded buffer size for texture readback
 */
function paddedBufferSize(width: number, height: number, bytesPerPixel: number = 4): number {
	return alignedBytesPerRow(width, bytesPerPixel) * height;
}

/**
 * Strip row padding from buffer data
 */
function stripRowPadding(
	paddedData: Uint8Array,
	width: number,
	height: number,
	bytesPerPixel: number = 4
): Uint8Array {
	const aligned = alignedBytesPerRow(width, bytesPerPixel);
	const unaligned = width * bytesPerPixel;

	if (aligned === unaligned) {
		return paddedData.slice(0, width * height * bytesPerPixel);
	}

	const result = new Uint8Array(width * height * bytesPerPixel);
	for (let y = 0; y < height; y++) {
		const srcOffset = y * aligned;
		const dstOffset = y * unaligned;
		result.set(paddedData.subarray(srcOffset, srcOffset + unaligned), dstOffset);
	}
	return result;
}

describe('WebGPU bytesPerRow Alignment', () => {
	it('should always return a multiple of 256', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 8192 }), // width
				fc.integer({ min: 1, max: 8 }), // bytesPerPixel (1, 2, 4, 8)
				(width, bytesPerPixel) => {
					const aligned = alignedBytesPerRow(width, bytesPerPixel);
					expect(aligned % 256).toBe(0);
				}
			),
			{ numRuns: 1000 }
		);
	});

	it('should be >= unaligned size', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 8192 }),
				fc.integer({ min: 1, max: 8 }),
				(width, bytesPerPixel) => {
					const unaligned = width * bytesPerPixel;
					const aligned = alignedBytesPerRow(width, bytesPerPixel);
					expect(aligned).toBeGreaterThanOrEqual(unaligned);
				}
			),
			{ numRuns: 1000 }
		);
	});

	it('should be minimal (< unaligned + 256)', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 8192 }),
				fc.integer({ min: 1, max: 8 }),
				(width, bytesPerPixel) => {
					const unaligned = width * bytesPerPixel;
					const aligned = alignedBytesPerRow(width, bytesPerPixel);
					expect(aligned).toBeLessThan(unaligned + 256);
				}
			),
			{ numRuns: 1000 }
		);
	});

	it('should handle edge cases correctly', () => {
		// Width of 64 with 4 bytes/pixel = 256 (already aligned)
		expect(alignedBytesPerRow(64, 4)).toBe(256);

		// Width of 65 with 4 bytes/pixel = 260 -> 512
		expect(alignedBytesPerRow(65, 4)).toBe(512);

		// Width of 1 with 4 bytes/pixel = 4 -> 256
		expect(alignedBytesPerRow(1, 4)).toBe(256);

		// Width of 1327 (from the error) with 4 bytes/pixel = 5308 -> 5376
		expect(alignedBytesPerRow(1327, 4)).toBe(5376);
		expect(5376 % 256).toBe(0);
	});
});

describe('Padded Buffer Size', () => {
	it('should be height * alignedBytesPerRow', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 4096 }), // width
				fc.integer({ min: 1, max: 4096 }), // height
				(width, height) => {
					const size = paddedBufferSize(width, height);
					const aligned = alignedBytesPerRow(width);
					expect(size).toBe(aligned * height);
				}
			),
			{ numRuns: 500 }
		);
	});

	it('should be >= unpadded pixel count * 4', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 4096 }),
				fc.integer({ min: 1, max: 4096 }),
				(width, height) => {
					const paddedSize = paddedBufferSize(width, height);
					const unpaddedSize = width * height * 4;
					expect(paddedSize).toBeGreaterThanOrEqual(unpaddedSize);
				}
			),
			{ numRuns: 500 }
		);
	});
});

describe('Row Padding Strip', () => {
	it('should preserve pixel data after round-trip', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 64 }), // smaller dimensions for fast tests
				fc.integer({ min: 1, max: 64 }),
				fc.integer({ min: 0, max: 255 }), // single seed value for pattern
				(width, height, seed) => {
					const pixelCount = width * height;
					const unpaddedSize = pixelCount * 4;

					// Create source data with deterministic pattern
					const sourceData = new Uint8Array(unpaddedSize);
					for (let i = 0; i < unpaddedSize; i++) {
						sourceData[i] = (seed + i * 17) % 256; // Simple deterministic pattern
					}

					// Simulate padding (what WebGPU would do)
					const aligned = alignedBytesPerRow(width);
					const paddedData = new Uint8Array(aligned * height);
					for (let y = 0; y < height; y++) {
						const srcOffset = y * width * 4;
						const dstOffset = y * aligned;
						paddedData.set(sourceData.subarray(srcOffset, srcOffset + width * 4), dstOffset);
						// Padding bytes are left as 0
					}

					// Strip padding
					const stripped = stripRowPadding(paddedData, width, height);

					// Should match original
					expect(stripped.length).toBe(sourceData.length);
					// Check first, middle, and last values for performance
					expect(stripped[0]).toBe(sourceData[0]);
					expect(stripped[Math.floor(unpaddedSize / 2)]).toBe(sourceData[Math.floor(unpaddedSize / 2)]);
					expect(stripped[unpaddedSize - 1]).toBe(sourceData[unpaddedSize - 1]);
					// Full comparison for small arrays only
					if (unpaddedSize <= 1024) {
						for (let i = 0; i < sourceData.length; i++) {
							expect(stripped[i]).toBe(sourceData[i]);
						}
					}
				}
			),
			{ numRuns: 50 }
		);
	});

	it('should handle already-aligned widths (no-op)', () => {
		const width = 64; // 64 * 4 = 256, already aligned
		const height = 10;
		const data = new Uint8Array(256 * height);
		for (let i = 0; i < data.length; i++) {
			data[i] = i % 256;
		}

		const stripped = stripRowPadding(data, width, height);

		// Should be identical since no padding was needed
		expect(stripped.length).toBe(width * height * 4);
		for (let i = 0; i < stripped.length; i++) {
			expect(stripped[i]).toBe(data[i]);
		}
	});
});

describe('WCAG Luminance Properties', () => {
	/**
	 * sRGB to linear conversion per WCAG 2.1
	 */
	function srgbToLinear(c: number): number {
		const v = c / 255;
		if (v <= 0.03928) {
			return v / 12.92;
		}
		return Math.pow((v + 0.055) / 1.055, 2.4);
	}

	/**
	 * Compute relative luminance per WCAG 2.1
	 */
	function luminance(r: number, g: number, b: number): number {
		return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
	}

	/**
	 * Compute WCAG contrast ratio
	 */
	function contrastRatio(l1: number, l2: number): number {
		const lighter = Math.max(l1, l2);
		const darker = Math.min(l1, l2);
		return (lighter + 0.05) / (darker + 0.05);
	}

	it('luminance should be in [0, 1]', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 255 }),
				fc.integer({ min: 0, max: 255 }),
				fc.integer({ min: 0, max: 255 }),
				(r, g, b) => {
					const l = luminance(r, g, b);
					expect(l).toBeGreaterThanOrEqual(0);
					expect(l).toBeLessThanOrEqual(1);
				}
			),
			{ numRuns: 1000 }
		);
	});

	it('black should have luminance 0', () => {
		expect(luminance(0, 0, 0)).toBe(0);
	});

	it('white should have luminance 1', () => {
		expect(luminance(255, 255, 255)).toBeCloseTo(1, 5);
	});

	it('contrast ratio should be in [1, 21]', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 255 }),
				fc.integer({ min: 0, max: 255 }),
				fc.integer({ min: 0, max: 255 }),
				fc.integer({ min: 0, max: 255 }),
				fc.integer({ min: 0, max: 255 }),
				fc.integer({ min: 0, max: 255 }),
				(r1, g1, b1, r2, g2, b2) => {
					const l1 = luminance(r1, g1, b1);
					const l2 = luminance(r2, g2, b2);
					const cr = contrastRatio(l1, l2);
					expect(cr).toBeGreaterThanOrEqual(1);
					expect(cr).toBeLessThanOrEqual(21);
				}
			),
			{ numRuns: 1000 }
		);
	});

	it('black vs white should have maximum contrast (21:1)', () => {
		const lBlack = luminance(0, 0, 0);
		const lWhite = luminance(255, 255, 255);
		const cr = contrastRatio(lBlack, lWhite);
		expect(cr).toBeCloseTo(21, 1);
	});

	it('same color should have minimum contrast (1:1)', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 255 }),
				fc.integer({ min: 0, max: 255 }),
				fc.integer({ min: 0, max: 255 }),
				(r, g, b) => {
					const l = luminance(r, g, b);
					const cr = contrastRatio(l, l);
					expect(cr).toBe(1);
				}
			),
			{ numRuns: 100 }
		);
	});
});
