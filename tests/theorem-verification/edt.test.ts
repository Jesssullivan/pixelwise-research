/**
 * EDT Definition Verification (pixelwise.tex Definition 2.1)
 *
 * Verifies the Euclidean Distance Transform definition:
 *   D(p) = min_{q in B} ||p - q||_2
 *
 * where B = {q : I(q) = 1} is the set of boundary (foreground) pixels.
 *
 * Reference: pixelwise.tex Section 2.1, Definition 2.1
 */

import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';

describe('EDT Definition Verification (pixelwise.tex Definition 2.1)', () => {
	/**
	 * Compute squared Euclidean distance between two points.
	 * Uses squared distance to match esdt.fut:squared_distance
	 */
	function squaredEuclideanDistance(
		x1: number,
		y1: number,
		x2: number,
		y2: number
	): number {
		const dx = x1 - x2;
		const dy = y1 - y2;
		return dx * dx + dy * dy;
	}

	/**
	 * Naive O(n^2) EDT for verification - directly implements Definition 2.1
	 */
	function naiveEDT(grid: number[][], width: number, height: number): number[][] {
		const distances: number[][] = [];

		for (let y = 0; y < height; y++) {
			distances[y] = [];
			for (let x = 0; x < width; x++) {
				let minDist = Infinity;

				// Find minimum distance to any foreground pixel
				for (let by = 0; by < height; by++) {
					for (let bx = 0; bx < width; bx++) {
						if (grid[by][bx] >= 1.0) {
							const d2 = squaredEuclideanDistance(x, y, bx, by);
							if (d2 < minDist) {
								minDist = d2;
							}
						}
					}
				}

				distances[y][x] = minDist;
			}
		}

		return distances;
	}

	it('squared_distance matches EDT definition for single point', () => {
		// Single foreground pixel at center
		const grid = [
			[0, 0, 0],
			[0, 1, 0],
			[0, 0, 0]
		];

		const distances = naiveEDT(grid, 3, 3);

		// Center pixel (foreground) should have distance 0
		expect(distances[1][1]).toBe(0);

		// Adjacent pixels should have squared distance 1
		expect(distances[0][1]).toBe(1); // Above
		expect(distances[1][0]).toBe(1); // Left
		expect(distances[1][2]).toBe(1); // Right
		expect(distances[2][1]).toBe(1); // Below

		// Corner pixels should have squared distance 2 (sqrt(2)^2)
		expect(distances[0][0]).toBe(2);
		expect(distances[0][2]).toBe(2);
		expect(distances[2][0]).toBe(2);
		expect(distances[2][2]).toBe(2);
	});

	it('squared_distance matches EDT definition for horizontal line', () => {
		// Horizontal line of foreground pixels
		const grid = [
			[0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0],
			[1, 1, 1, 1, 1],
			[0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0]
		];

		const distances = naiveEDT(grid, 5, 5);

		// Line pixels should have distance 0
		for (let x = 0; x < 5; x++) {
			expect(distances[2][x]).toBe(0);
		}

		// Row above/below should have squared distance 1
		for (let x = 0; x < 5; x++) {
			expect(distances[1][x]).toBe(1);
			expect(distances[3][x]).toBe(1);
		}

		// Two rows away should have squared distance 4
		for (let x = 0; x < 5; x++) {
			expect(distances[0][x]).toBe(4);
			expect(distances[4][x]).toBe(4);
		}
	});

	it.prop([
		fc.integer({ min: 3, max: 10 }), // width
		fc.integer({ min: 3, max: 10 }) // height
	])(
		'EDT produces non-negative squared distances per Definition 2.1',
		(width, height) => {
			// Create grid with at least one foreground pixel
			const grid: number[][] = [];
			for (let y = 0; y < height; y++) {
				grid[y] = [];
				for (let x = 0; x < width; x++) {
					grid[y][x] = 0;
				}
			}
			// Place foreground pixel at center
			grid[Math.floor(height / 2)][Math.floor(width / 2)] = 1;

			const distances = naiveEDT(grid, width, height);

			// All squared distances must be non-negative
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					expect(distances[y][x]).toBeGreaterThanOrEqual(0);
				}
			}
		}
	);

	it.prop([
		fc.integer({ min: 3, max: 8 }),
		fc.integer({ min: 3, max: 8 })
	])(
		'foreground pixels have zero squared distance per Definition 2.1',
		(width, height) => {
			const grid: number[][] = [];
			for (let y = 0; y < height; y++) {
				grid[y] = [];
				for (let x = 0; x < width; x++) {
					grid[y][x] = 0;
				}
			}
			// Place foreground pixel
			const fx = Math.floor(width / 2);
			const fy = Math.floor(height / 2);
			grid[fy][fx] = 1;

			const distances = naiveEDT(grid, width, height);

			// Foreground pixel should have distance 0
			expect(distances[fy][fx]).toBe(0);
		}
	);

	it('Euclidean distance (sqrt of squared) matches expected values', () => {
		const grid = [
			[0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0],
			[0, 0, 1, 0, 0],
			[0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0]
		];

		const distances = naiveEDT(grid, 5, 5);

		// Verify actual Euclidean distances (not squared)
		expect(Math.sqrt(distances[2][2])).toBeCloseTo(0, 5); // Center
		expect(Math.sqrt(distances[2][0])).toBeCloseTo(2, 5); // 2 units left
		expect(Math.sqrt(distances[0][0])).toBeCloseTo(Math.sqrt(8), 5); // Diagonal (2,2)
		expect(Math.sqrt(distances[0][2])).toBeCloseTo(2, 5); // 2 units up
	});
});
