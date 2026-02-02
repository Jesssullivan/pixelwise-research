/**
 * ESDT Algorithm Passes Verification (pixelwise.tex Algorithms 1-2)
 *
 * Verifies the correctness of ESDT X-pass and Y-pass propagation:
 *
 * X-Pass (Algorithm 2):
 * - Forward: candidate = (pixels[x-1].delta_x + 1, pixels[x-1].delta_y)
 * - Backward: candidate = (pixels[x+1].delta_x - 1, pixels[x+1].delta_y)
 *
 * Y-Pass (analogous):
 * - Forward: candidate = (pixels[y-1].delta_x, pixels[y-1].delta_y + 1)
 * - Backward: candidate = (pixels[y+1].delta_x, pixels[y+1].delta_y - 1)
 *
 * Reference: pixelwise.tex Section 2.3, Algorithms 1-2
 * Implementation: futhark/esdt.fut:82-130
 */

import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';

// Sentinel value for infinite distance
const ESDT_INF = 1e10;

interface EsdtPixel {
	deltaX: number;
	deltaY: number;
}

describe('ESDT Algorithm Passes Verification (pixelwise.tex Algorithms 1-2)', () => {
	function squaredDistance(p: EsdtPixel): number {
		return p.deltaX * p.deltaX + p.deltaY * p.deltaY;
	}

	function esdtInf(): EsdtPixel {
		return { deltaX: ESDT_INF, deltaY: ESDT_INF };
	}

	function esdtZero(): EsdtPixel {
		return { deltaX: 0, deltaY: 0 };
	}

	/**
	 * Initialize ESDT from grayscale levels (Algorithm 1)
	 * Simplified: uses 0/1 binary for testing
	 */
	function esdtInitialize(levels: number[][]): EsdtPixel[][] {
		const height = levels.length;
		const width = levels[0].length;
		const pixels: EsdtPixel[][] = [];

		for (let y = 0; y < height; y++) {
			pixels[y] = [];
			for (let x = 0; x < width; x++) {
				if (levels[y][x] <= 0) {
					pixels[y][x] = esdtInf(); // Background
				} else if (levels[y][x] >= 1) {
					pixels[y][x] = esdtZero(); // Foreground
				} else {
					// Gray pixel - simplified (no gradient computation)
					const offset = levels[y][x] - 0.5;
					pixels[y][x] = { deltaX: offset, deltaY: 0 };
				}
			}
		}

		return pixels;
	}

	/**
	 * X-Pass per Algorithm 2
	 */
	function esdtXPass(pixels: EsdtPixel[][]): EsdtPixel[][] {
		const height = pixels.length;
		const width = pixels[0].length;
		const result: EsdtPixel[][] = pixels.map((row) => row.map((p) => ({ ...p })));

		for (let y = 0; y < height; y++) {
			// Forward pass (left to right)
			for (let x = 1; x < width; x++) {
				const prev = result[y][x - 1];
				const candidate: EsdtPixel = {
					deltaX: prev.deltaX + 1,
					deltaY: prev.deltaY
				};
				if (squaredDistance(candidate) < squaredDistance(result[y][x])) {
					result[y][x] = candidate;
				}
			}

			// Backward pass (right to left)
			for (let x = width - 2; x >= 0; x--) {
				const next = result[y][x + 1];
				const candidate: EsdtPixel = {
					deltaX: next.deltaX - 1,
					deltaY: next.deltaY
				};
				if (squaredDistance(candidate) < squaredDistance(result[y][x])) {
					result[y][x] = candidate;
				}
			}
		}

		return result;
	}

	/**
	 * Y-Pass (analogous to X-Pass)
	 */
	function esdtYPass(pixels: EsdtPixel[][]): EsdtPixel[][] {
		const height = pixels.length;
		const width = pixels[0].length;
		const result: EsdtPixel[][] = pixels.map((row) => row.map((p) => ({ ...p })));

		for (let x = 0; x < width; x++) {
			// Forward pass (top to bottom)
			for (let y = 1; y < height; y++) {
				const prev = result[y - 1][x];
				const candidate: EsdtPixel = {
					deltaX: prev.deltaX,
					deltaY: prev.deltaY + 1
				};
				if (squaredDistance(candidate) < squaredDistance(result[y][x])) {
					result[y][x] = candidate;
				}
			}

			// Backward pass (bottom to top)
			for (let y = height - 2; y >= 0; y--) {
				const next = result[y + 1][x];
				const candidate: EsdtPixel = {
					deltaX: next.deltaX,
					deltaY: next.deltaY - 1
				};
				if (squaredDistance(candidate) < squaredDistance(result[y][x])) {
					result[y][x] = candidate;
				}
			}
		}

		return result;
	}

	/**
	 * Complete ESDT computation
	 */
	function computeEsdt(levels: number[][]): EsdtPixel[][] {
		let pixels = esdtInitialize(levels);
		pixels = esdtXPass(pixels);
		pixels = esdtYPass(pixels);
		return pixels;
	}

	it('X-pass forward propagation: candidate.delta_x = prev.delta_x + 1', () => {
		// Single foreground pixel at x=2
		const levels = [[0, 0, 1, 0, 0]];
		const initialized = esdtInitialize(levels);

		const afterXPass = esdtXPass(initialized);

		// x=3 should have delta_x = 1 (from x=2 with delta_x=0)
		expect(afterXPass[0][3].deltaX).toBe(1);
		// x=4 should have delta_x = 2 (from x=3 with delta_x=1)
		expect(afterXPass[0][4].deltaX).toBe(2);
	});

	it('X-pass backward propagation: candidate.delta_x = next.delta_x - 1', () => {
		const levels = [[0, 0, 1, 0, 0]];
		const initialized = esdtInitialize(levels);

		const afterXPass = esdtXPass(initialized);

		// x=1 should have delta_x = -1 (from x=2 with delta_x=0)
		expect(afterXPass[0][1].deltaX).toBe(-1);
		// x=0 should have delta_x = -2 (from x=1 with delta_x=-1)
		expect(afterXPass[0][0].deltaX).toBe(-2);
	});

	it('Y-pass forward propagation: candidate.delta_y = prev.delta_y + 1', () => {
		// Single foreground pixel at y=2
		const levels = [[0], [0], [1], [0], [0]];
		const initialized = esdtInitialize(levels);
		const afterXPass = esdtXPass(initialized);

		const afterYPass = esdtYPass(afterXPass);

		// y=3 should have delta_y = 1
		expect(afterYPass[3][0].deltaY).toBe(1);
		// y=4 should have delta_y = 2
		expect(afterYPass[4][0].deltaY).toBe(2);
	});

	it('Y-pass backward propagation: candidate.delta_y = next.delta_y - 1', () => {
		const levels = [[0], [0], [1], [0], [0]];
		const initialized = esdtInitialize(levels);
		const afterXPass = esdtXPass(initialized);

		const afterYPass = esdtYPass(afterXPass);

		// y=1 should have delta_y = -1
		expect(afterYPass[1][0].deltaY).toBe(-1);
		// y=0 should have delta_y = -2
		expect(afterYPass[0][0].deltaY).toBe(-2);
	});

	it('single point ESDT produces correct distances (pixelwise.tex test case)', () => {
		const levels = [
			[0, 0, 0],
			[0, 1, 0],
			[0, 0, 0]
		];

		const esdt = computeEsdt(levels);

		// Center should have zero distance
		const centerD = Math.sqrt(squaredDistance(esdt[1][1]));
		expect(centerD).toBeLessThan(0.01);

		// Corners should have distance ~sqrt(2)
		const cornerD = Math.sqrt(squaredDistance(esdt[0][0]));
		expect(Math.abs(cornerD - Math.sqrt(2))).toBeLessThan(0.15);
	});

	it('horizontal line ESDT produces correct distances (pixelwise.tex test case)', () => {
		const levels = [
			[0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0],
			[1, 1, 1, 1, 1],
			[0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0]
		];

		const esdt = computeEsdt(levels);

		// Line pixels should have zero distance
		for (let x = 0; x < 5; x++) {
			const d = Math.sqrt(squaredDistance(esdt[2][x]));
			expect(d).toBeLessThan(0.01);
		}

		// Adjacent rows should have distance ~1
		for (let x = 0; x < 5; x++) {
			const above = Math.sqrt(squaredDistance(esdt[1][x]));
			const below = Math.sqrt(squaredDistance(esdt[3][x]));
			expect(Math.abs(above - 1)).toBeLessThan(0.15);
			expect(Math.abs(below - 1)).toBeLessThan(0.15);
		}
	});

	it.prop([
		fc.integer({ min: 3, max: 8 }),
		fc.integer({ min: 3, max: 8 })
	])(
		'ESDT produces finite distances when foreground exists',
		(width, height) => {
			// Create grid with foreground at center
			const levels: number[][] = [];
			for (let y = 0; y < height; y++) {
				levels[y] = [];
				for (let x = 0; x < width; x++) {
					levels[y][x] = 0;
				}
			}
			levels[Math.floor(height / 2)][Math.floor(width / 2)] = 1;

			const esdt = computeEsdt(levels);

			// All pixels should have finite distance
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					const d = Math.sqrt(squaredDistance(esdt[y][x]));
					expect(d).toBeLessThan(ESDT_INF);
					expect(d).toBeGreaterThanOrEqual(0);
				}
			}
		}
	);

	it.prop([
		fc.integer({ min: 3, max: 8 }),
		fc.integer({ min: 3, max: 8 })
	])(
		'foreground pixels always have zero distance',
		(width, height) => {
			const levels: number[][] = [];
			for (let y = 0; y < height; y++) {
				levels[y] = [];
				for (let x = 0; x < width; x++) {
					levels[y][x] = 0;
				}
			}
			const fx = Math.floor(width / 2);
			const fy = Math.floor(height / 2);
			levels[fy][fx] = 1;

			const esdt = computeEsdt(levels);

			// Foreground pixel should have zero distance
			const d = Math.sqrt(squaredDistance(esdt[fy][fx]));
			expect(d).toBeLessThan(0.01);
		}
	);

	it('X-pass preserves delta_y', () => {
		// Initialize with non-zero delta_y
		const pixels: EsdtPixel[][] = [
			[esdtInf(), esdtInf(), { deltaX: 0, deltaY: 0.5 }, esdtInf(), esdtInf()]
		];

		const afterXPass = esdtXPass(pixels);

		// delta_y should be preserved during X propagation
		expect(afterXPass[0][2].deltaY).toBe(0.5);
		expect(afterXPass[0][3].deltaY).toBe(0.5);
		expect(afterXPass[0][1].deltaY).toBe(0.5);
	});

	it('Y-pass preserves delta_x', () => {
		// Initialize with non-zero delta_x
		const pixels: EsdtPixel[][] = [
			[esdtInf()],
			[esdtInf()],
			[{ deltaX: 0.5, deltaY: 0 }],
			[esdtInf()],
			[esdtInf()]
		];

		const afterYPass = esdtYPass(pixels);

		// delta_x should be preserved during Y propagation
		expect(afterYPass[2][0].deltaX).toBe(0.5);
		expect(afterYPass[3][0].deltaX).toBe(0.5);
		expect(afterYPass[1][0].deltaX).toBe(0.5);
	});

	it('squared distance comparison determines winner', () => {
		// Two potential sources at different distances
		const levels = [
			[1, 0, 0, 0, 1],
			[0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0]
		];

		const esdt = computeEsdt(levels);

		// Center column should have distance = 2 (from either end)
		const centerD = Math.sqrt(squaredDistance(esdt[0][2]));
		expect(centerD).toBeCloseTo(2, 1);
	});
});
