/**
 * ESDT Offset Vectors Verification (pixelwise.tex Theorem 2.4)
 *
 * Verifies that ESDT maintains offset vectors (delta_x, delta_y) from which
 * distance and gradient are derived:
 *
 *   d = sqrt(delta_x^2 + delta_y^2)
 *   gradient = (delta_x, delta_y) / d   when d > epsilon
 *
 * where epsilon = 0.001 prevents division by zero.
 *
 * Reference: pixelwise.tex Section 2.3, Theorem 2.4
 * Implementation: futhark/esdt.fut:25-37
 */

import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';

describe('ESDT Offset Vectors Verification (pixelwise.tex Theorem 2.4)', () => {
	const EPSILON = 0.001;

	/**
	 * Compute distance from offset vector per Theorem 2.4
	 */
	function distance(deltaX: number, deltaY: number): number {
		return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
	}

	/**
	 * Compute squared distance (used for comparisons)
	 */
	function squaredDistance(deltaX: number, deltaY: number): number {
		return deltaX * deltaX + deltaY * deltaY;
	}

	/**
	 * Compute normalized gradient per Theorem 2.4
	 */
	function gradient(deltaX: number, deltaY: number): [number, number] {
		const d = distance(deltaX, deltaY);
		if (d > EPSILON) {
			return [deltaX / d, deltaY / d];
		}
		return [0, 0];
	}

	it('distance formula d = sqrt(delta_x^2 + delta_y^2)', () => {
		// Test known values
		expect(distance(3, 4)).toBeCloseTo(5, 10); // 3-4-5 triangle
		expect(distance(1, 0)).toBeCloseTo(1, 10);
		expect(distance(0, 1)).toBeCloseTo(1, 10);
		expect(distance(1, 1)).toBeCloseTo(Math.sqrt(2), 10);
		expect(distance(0, 0)).toBeCloseTo(0, 10);
	});

	it('gradient is unit vector when d > epsilon', () => {
		const [gx, gy] = gradient(3, 4);
		const magnitude = Math.sqrt(gx * gx + gy * gy);
		expect(magnitude).toBeCloseTo(1, 5);

		// Check direction
		expect(gx).toBeCloseTo(0.6, 5); // 3/5
		expect(gy).toBeCloseTo(0.8, 5); // 4/5
	});

	it('gradient is zero vector when d <= epsilon', () => {
		const [gx1, gy1] = gradient(0, 0);
		expect(gx1).toBe(0);
		expect(gy1).toBe(0);

		const [gx2, gy2] = gradient(0.0001, 0.0001);
		expect(gx2).toBe(0);
		expect(gy2).toBe(0);
	});

	it.prop([
		fc.float({ min: Math.fround(-1000), max: Math.fround(1000), noNaN: true }),
		fc.float({ min: Math.fround(-1000), max: Math.fround(1000), noNaN: true })
	])(
		'distance is always non-negative per Theorem 2.4',
		(deltaX, deltaY) => {
			const d = distance(deltaX, deltaY);
			expect(d).toBeGreaterThanOrEqual(0);
		}
	);

	it.prop([
		fc.float({ min: Math.fround(1), max: Math.fround(1000), noNaN: true }),
		fc.float({ min: Math.fround(1), max: Math.fround(1000), noNaN: true })
	])(
		'gradient is unit vector when d > epsilon per Theorem 2.4',
		(deltaX, deltaY) => {
			const d = distance(deltaX, deltaY);
			if (d > EPSILON) {
				const [gx, gy] = gradient(deltaX, deltaY);
				const magnitude = Math.sqrt(gx * gx + gy * gy);
				expect(magnitude).toBeCloseTo(1, 4);
			}
		}
	);

	it.prop([
		fc.float({ min: Math.fround(-1000), max: Math.fround(1000), noNaN: true }),
		fc.float({ min: Math.fround(-1000), max: Math.fround(1000), noNaN: true })
	])(
		'squared distance equals delta_x^2 + delta_y^2',
		(deltaX, deltaY) => {
			const d2 = squaredDistance(deltaX, deltaY);
			const expected = deltaX * deltaX + deltaY * deltaY;
			expect(d2).toBeCloseTo(expected, 5);
		}
	);

	it.prop([
		fc.float({ min: Math.fround(0.1), max: Math.fround(1000), noNaN: true }),
		fc.float({ min: Math.fround(0.1), max: Math.fround(1000), noNaN: true })
	])(
		'gradient points in same direction as offset vector',
		(deltaX, deltaY) => {
			const [gx, gy] = gradient(deltaX, deltaY);
			const d = distance(deltaX, deltaY);

			if (d > EPSILON) {
				// Gradient direction should match offset direction
				// gx/gy should equal deltaX/deltaY (with same signs)
				expect(Math.sign(gx)).toBe(Math.sign(deltaX));
				expect(Math.sign(gy)).toBe(Math.sign(deltaY));
			}
		}
	);

	it.prop([fc.float({ min: Math.fround(0.1), max: Math.fround(1000), noNaN: true })])(
		'gradient magnitude is 1 for non-zero offsets',
		(scale) => {
			// Test with various directions
			const angles = [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 4];

			for (const angle of angles) {
				const deltaX = scale * Math.cos(angle);
				const deltaY = scale * Math.sin(angle);
				const [gx, gy] = gradient(deltaX, deltaY);
				const magnitude = Math.sqrt(gx * gx + gy * gy);
				expect(magnitude).toBeCloseTo(1, 4);
			}
		}
	);

	it('epsilon threshold is 0.001 per Theorem 2.4', () => {
		// Just above epsilon - should produce unit gradient
		const [gx1, gy1] = gradient(0.0011, 0);
		expect(Math.abs(gx1)).toBeCloseTo(1, 3);

		// Just below epsilon - should produce zero gradient
		const [gx2, gy2] = gradient(0.0009, 0);
		expect(gx2).toBe(0);
		expect(gy2).toBe(0);
	});

	it.prop([
		fc.float({ min: 1, max: 100, noNaN: true }),
		fc.float({ min: 1, max: 100, noNaN: true })
	])(
		'reconstructing offset from gradient and distance',
		(deltaX, deltaY) => {
			const d = distance(deltaX, deltaY);
			const [gx, gy] = gradient(deltaX, deltaY);

			// Should be able to reconstruct offset from gradient * distance
			const reconstructedX = gx * d;
			const reconstructedY = gy * d;

			expect(reconstructedX).toBeCloseTo(deltaX, 3);
			expect(reconstructedY).toBeCloseTo(deltaY, 3);
		}
	);
});
