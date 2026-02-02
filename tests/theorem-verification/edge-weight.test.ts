/**
 * Edge Weight Verification (pixelwise.tex Section 4.1)
 *
 * Verifies the edge weight formula:
 *   w_edge = 4 * alpha * (1 - alpha)
 *
 * Properties:
 * - w_edge peaks at alpha = 0.5 (maximum value = 1.0)
 * - w_edge = 0 when alpha = 0 or alpha = 1
 * - Provides natural contrast emphasis at glyph boundaries
 *
 * Reference: pixelwise.tex Section 4.1
 * Implementation: futhark/esdt.fut:224
 */

import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';

// Coverage arbitrary for testing edge weight
const coverageArbitrary = fc.float({ min: 0, max: 1, noNaN: true });

describe('Edge Weight Verification (pixelwise.tex Section 4.1)', () => {
	/**
	 * Compute edge weight per Section 4.1
	 */
	function edgeWeight(alpha: number): number {
		return 4 * alpha * (1 - alpha);
	}

	it('edge weight formula = 4 * alpha * (1 - alpha)', () => {
		// Test specific values
		expect(edgeWeight(0.0)).toBeCloseTo(0, 10);
		expect(edgeWeight(0.25)).toBeCloseTo(0.75, 10); // 4 * 0.25 * 0.75
		expect(edgeWeight(0.5)).toBeCloseTo(1.0, 10); // Maximum
		expect(edgeWeight(0.75)).toBeCloseTo(0.75, 10); // 4 * 0.75 * 0.25
		expect(edgeWeight(1.0)).toBeCloseTo(0, 10);
	});

	it('edge weight peaks at alpha = 0.5 with value 1.0', () => {
		const peak = edgeWeight(0.5);
		expect(peak).toBeCloseTo(1.0, 10);

		// Verify it's actually a maximum by checking nearby values
		const slightlyLess = edgeWeight(0.49);
		const slightlyMore = edgeWeight(0.51);

		expect(peak).toBeGreaterThanOrEqual(slightlyLess);
		expect(peak).toBeGreaterThanOrEqual(slightlyMore);
	});

	it('edge weight is 0 at alpha = 0 (background)', () => {
		expect(edgeWeight(0)).toBe(0);
	});

	it('edge weight is 0 at alpha = 1 (solid foreground)', () => {
		expect(edgeWeight(1)).toBe(0);
	});

	it.prop([coverageArbitrary])(
		'edge weight = 4*alpha*(1-alpha) per Section 4.1',
		(alpha) => {
			const w = edgeWeight(alpha);

			// Must be in [0, 1]
			expect(w).toBeGreaterThanOrEqual(0);
			expect(w).toBeLessThanOrEqual(1.0001); // Small tolerance for float precision
		}
	);

	it.prop([coverageArbitrary])(
		'edge weight is non-negative for all coverage values',
		(alpha) => {
			const w = edgeWeight(alpha);
			expect(w).toBeGreaterThanOrEqual(0);
		}
	);

	it.prop([coverageArbitrary])(
		'edge weight maximum is at alpha = 0.5',
		(alpha) => {
			const w = edgeWeight(alpha);
			const wMax = edgeWeight(0.5);

			expect(w).toBeLessThanOrEqual(wMax + 0.0001);
		}
	);

	it.prop([fc.float({ min: Math.fround(0.01), max: Math.fround(0.49), noNaN: true })])(
		'edge weight is increasing for alpha < 0.5',
		(alpha) => {
			const w1 = edgeWeight(alpha);
			const w2 = edgeWeight(alpha + 0.01);

			// Should be increasing toward 0.5
			expect(w2).toBeGreaterThanOrEqual(w1 - 0.001); // Small tolerance
		}
	);

	it.prop([fc.float({ min: Math.fround(0.51), max: Math.fround(0.99), noNaN: true })])(
		'edge weight is decreasing for alpha > 0.5',
		(alpha) => {
			const w1 = edgeWeight(alpha);
			const w2 = edgeWeight(alpha + 0.01);

			// Should be decreasing away from 0.5
			expect(w2).toBeLessThanOrEqual(w1 + 0.001); // Small tolerance
		}
	);

	it.prop([coverageArbitrary])(
		'edge weight is symmetric around alpha = 0.5',
		(alpha) => {
			const w1 = edgeWeight(alpha);
			const w2 = edgeWeight(1 - alpha);

			expect(w1).toBeCloseTo(w2, 8);
		}
	);

	it('edge weight formula is parabolic (derivative analysis)', () => {
		// w = 4*alpha*(1-alpha) = 4*alpha - 4*alpha^2
		// dw/dalpha = 4 - 8*alpha
		// At alpha = 0.5: dw/dalpha = 0 (critical point)

		// Numerical derivative at alpha = 0.5
		const h = 0.0001;
		const derivative = (edgeWeight(0.5 + h) - edgeWeight(0.5 - h)) / (2 * h);

		expect(derivative).toBeCloseTo(0, 3);
	});

	it('edge weight correctly emphasizes glyph boundaries', () => {
		// Solid interior (alpha = 1) - no emphasis needed
		expect(edgeWeight(1.0)).toBeCloseTo(0, 10);

		// Pure background (alpha = 0) - no emphasis needed
		expect(edgeWeight(0.0)).toBeCloseTo(0, 10);

		// Anti-aliased edge pixels (alpha around 0.5) - maximum emphasis
		expect(edgeWeight(0.4)).toBeGreaterThan(0.9);
		expect(edgeWeight(0.5)).toBeCloseTo(1.0, 10);
		expect(edgeWeight(0.6)).toBeGreaterThan(0.9);

		// Partial coverage pixels - moderate emphasis
		expect(edgeWeight(0.2)).toBeGreaterThan(0.5);
		expect(edgeWeight(0.8)).toBeGreaterThan(0.5);
	});

	it.prop([
		fc.float({ min: 0, max: 1, noNaN: true }),
		fc.float({ min: 0, max: 1, noNaN: true })
	])(
		'closer to 0.5 has higher edge weight',
		(alpha1, alpha2) => {
			const w1 = edgeWeight(alpha1);
			const w2 = edgeWeight(alpha2);

			const dist1 = Math.abs(alpha1 - 0.5);
			const dist2 = Math.abs(alpha2 - 0.5);

			// If alpha1 is closer to 0.5, its weight should be higher
			if (dist1 < dist2 - 0.001) {
				expect(w1).toBeGreaterThanOrEqual(w2 - 0.001);
			}
		}
	);
});
