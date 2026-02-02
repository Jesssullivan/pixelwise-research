/**
 * Gray Pixel Offset Verification (pixelwise.tex Definition 2.3)
 *
 * Verifies the gray pixel offset formula:
 *   offset = L - 0.5
 *
 * where L is the pixel opacity level in (0, 1).
 *
 * Properties:
 * - L = 0.5: Edge passes through pixel center (offset = 0)
 * - L > 0.5: Edge toward glyph interior (positive offset)
 * - L < 0.5: Edge toward background (negative offset)
 *
 * Reference: pixelwise.tex Section 2.3, Definition 2.3
 * Implementation: futhark/esdt.fut:76
 */

import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';

describe('Gray Pixel Offset Verification (pixelwise.tex Definition 2.3)', () => {
	/**
	 * Compute gray pixel offset per Definition 2.3
	 */
	function grayPixelOffset(level: number): number {
		return level - 0.5;
	}

	it('offset = L - 0.5 exactly per Definition 2.3', () => {
		// Test exact values
		expect(grayPixelOffset(0.0)).toBeCloseTo(-0.5, 10);
		expect(grayPixelOffset(0.25)).toBeCloseTo(-0.25, 10);
		expect(grayPixelOffset(0.5)).toBeCloseTo(0.0, 10);
		expect(grayPixelOffset(0.75)).toBeCloseTo(0.25, 10);
		expect(grayPixelOffset(1.0)).toBeCloseTo(0.5, 10);
	});

	it('L = 0.5 produces zero offset (edge at pixel center)', () => {
		const offset = grayPixelOffset(0.5);
		expect(offset).toBe(0);
	});

	it('L > 0.5 produces positive offset (toward glyph interior)', () => {
		expect(grayPixelOffset(0.51)).toBeGreaterThan(0);
		expect(grayPixelOffset(0.75)).toBeGreaterThan(0);
		expect(grayPixelOffset(0.99)).toBeGreaterThan(0);
	});

	it('L < 0.5 produces negative offset (toward background)', () => {
		expect(grayPixelOffset(0.49)).toBeLessThan(0);
		expect(grayPixelOffset(0.25)).toBeLessThan(0);
		expect(grayPixelOffset(0.01)).toBeLessThan(0);
	});

	it.prop([fc.float({ min: Math.fround(0.01), max: Math.fround(0.99), noNaN: true })])(
		'gray pixel offset = L - 0.5 for all L in (0, 1) per Definition 2.3',
		(level) => {
			const offset = grayPixelOffset(level);

			// Offset must be in range [-0.5, 0.5]
			expect(offset).toBeGreaterThanOrEqual(-0.5);
			expect(offset).toBeLessThanOrEqual(0.5);

			// Verify formula
			expect(offset).toBeCloseTo(level - 0.5, 5);
		}
	);

	it.prop([fc.float({ min: Math.fround(0.01), max: Math.fround(0.49), noNaN: true })])(
		'L < 0.5 implies negative offset per Observation',
		(level) => {
			const offset = grayPixelOffset(level);
			expect(offset).toBeLessThan(0);
		}
	);

	it.prop([fc.float({ min: Math.fround(0.51), max: Math.fround(0.99), noNaN: true })])(
		'L > 0.5 implies positive offset per Observation',
		(level) => {
			const offset = grayPixelOffset(level);
			expect(offset).toBeGreaterThan(0);
		}
	);

	it.prop([fc.float({ min: Math.fround(0.0), max: Math.fround(1.0), noNaN: true })])(
		'offset is bounded by [-0.5, 0.5] for all valid L',
		(level) => {
			const offset = grayPixelOffset(level);
			expect(offset).toBeGreaterThanOrEqual(-0.5);
			expect(offset).toBeLessThanOrEqual(0.5);
		}
	);

	it.prop([
		fc.float({ min: Math.fround(0.01), max: Math.fround(0.99), noNaN: true }),
		fc.float({ min: Math.fround(0.01), max: Math.fround(0.99), noNaN: true })
	])(
		'offset preserves ordering: L1 > L2 implies offset1 > offset2',
		(l1, l2) => {
			const offset1 = grayPixelOffset(l1);
			const offset2 = grayPixelOffset(l2);

			if (l1 > l2) {
				expect(offset1).toBeGreaterThan(offset2);
			} else if (l1 < l2) {
				expect(offset1).toBeLessThan(offset2);
			} else {
				expect(offset1).toBeCloseTo(offset2, 10);
			}
		}
	);

	it('offset is continuous at L = 0.5', () => {
		const epsilon = 1e-10;
		const leftLimit = grayPixelOffset(0.5 - epsilon);
		const rightLimit = grayPixelOffset(0.5 + epsilon);
		const atPoint = grayPixelOffset(0.5);

		expect(Math.abs(leftLimit - atPoint)).toBeLessThan(1e-9);
		expect(Math.abs(rightLimit - atPoint)).toBeLessThan(1e-9);
	});
});
