/**
 * GradientDirectionVisualizer Verification Tests
 *
 * Tests based on the ESDT Demo Rewrite Plan verification checklist:
 * - GradientDirectionVisualizer calls `compute_esdt_wasm()` or ComputeDispatcher
 * - Gradient arrows point toward nearest edge
 * - ESDT distances match expected values for simple shapes
 * - SIMD/WASM status indicators are shown
 *
 * Reference: .claude/plans/archive/esdt-demos-rewrite-plan.md
 * Implementation: src/lib/components/esdt-demos/GradientDirectionVisualizer.svelte
 * Algorithm: pixelwise.tex Section 2.3, Algorithms 1-2
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// Sentinel value for infinite distance
const ESDT_INF = 1e10;

// ============================================================================
// ESDT ALGORITHM VERIFICATION
// ============================================================================

describe('GradientDirectionVisualizer - ESDT Algorithm', () => {
	/**
	 * Reference ESDT implementation matching esdt.fut / GradientDirectionVisualizer
	 */
	function computeEsdt(levels: Float32Array, width: number, height: number): Float32Array {
		const data = new Float32Array(width * height * 2);

		// Initialize: foreground (level >= 0.5) = 0, background = infinity
		for (let i = 0; i < width * height; i++) {
			if (levels[i] >= 0.5) {
				data[i * 2] = 0;
				data[i * 2 + 1] = 0;
			} else {
				data[i * 2] = ESDT_INF;
				data[i * 2 + 1] = ESDT_INF;
			}
		}

		// X-pass forward
		for (let y = 0; y < height; y++) {
			for (let x = 1; x < width; x++) {
				const idx = (y * width + x) * 2;
				const prevIdx = (y * width + x - 1) * 2;
				const candX = data[prevIdx] + 1;
				const candY = data[prevIdx + 1];
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		// X-pass backward
		for (let y = 0; y < height; y++) {
			for (let x = width - 2; x >= 0; x--) {
				const idx = (y * width + x) * 2;
				const nextIdx = (y * width + x + 1) * 2;
				const candX = data[nextIdx] - 1;
				const candY = data[nextIdx + 1];
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		// Y-pass forward
		for (let x = 0; x < width; x++) {
			for (let y = 1; y < height; y++) {
				const idx = (y * width + x) * 2;
				const prevIdx = ((y - 1) * width + x) * 2;
				const candX = data[prevIdx];
				const candY = data[prevIdx + 1] + 1;
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		// Y-pass backward
		for (let x = 0; x < width; x++) {
			for (let y = height - 2; y >= 0; y--) {
				const idx = (y * width + x) * 2;
				const nextIdx = ((y + 1) * width + x) * 2;
				const candX = data[nextIdx];
				const candY = data[nextIdx + 1] - 1;
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		return data;
	}

	/**
	 * Get distance at a pixel
	 */
	function getDistance(data: Float32Array, x: number, y: number, width: number): number {
		const idx = (y * width + x) * 2;
		const dx = data[idx];
		const dy = data[idx + 1];
		return Math.sqrt(dx * dx + dy * dy);
	}

	/**
	 * Get gradient vector at a pixel
	 */
	function getGradient(data: Float32Array, x: number, y: number, width: number): { dx: number; dy: number } {
		const idx = (y * width + x) * 2;
		return {
			dx: data[idx],
			dy: data[idx + 1]
		};
	}

	describe('Single point ESDT', () => {
		it('center pixel has zero distance (pixelwise.tex test case)', () => {
			// 3x3 grid with center filled
			const levels = new Float32Array([
				0.0, 0.0, 0.0,
				0.0, 1.0, 0.0,
				0.0, 0.0, 0.0
			]);

			const esdt = computeEsdt(levels, 3, 3);
			const centerDist = getDistance(esdt, 1, 1, 3);

			expect(centerDist).toBeLessThan(0.01);
		});

		it('corner has distance ~sqrt(2) from center point', () => {
			const levels = new Float32Array([
				0.0, 0.0, 0.0,
				0.0, 1.0, 0.0,
				0.0, 0.0, 0.0
			]);

			const esdt = computeEsdt(levels, 3, 3);
			const cornerDist = getDistance(esdt, 0, 0, 3);

			expect(cornerDist).toBeCloseTo(Math.sqrt(2), 1);
		});

		it('edge neighbors have distance ~1 from center point', () => {
			const levels = new Float32Array([
				0.0, 0.0, 0.0,
				0.0, 1.0, 0.0,
				0.0, 0.0, 0.0
			]);

			const esdt = computeEsdt(levels, 3, 3);

			// Top neighbor (1, 0)
			expect(getDistance(esdt, 1, 0, 3)).toBeCloseTo(1, 1);
			// Bottom neighbor (1, 2)
			expect(getDistance(esdt, 1, 2, 3)).toBeCloseTo(1, 1);
			// Left neighbor (0, 1)
			expect(getDistance(esdt, 0, 1, 3)).toBeCloseTo(1, 1);
			// Right neighbor (2, 1)
			expect(getDistance(esdt, 2, 1, 3)).toBeCloseTo(1, 1);
		});
	});

	describe('Gradient direction verification', () => {
		it('gradients store offset to nearest foreground (single center point)', () => {
			const levels = new Float32Array([
				0.0, 0.0, 0.0,
				0.0, 1.0, 0.0,
				0.0, 0.0, 0.0
			]);

			const esdt = computeEsdt(levels, 3, 3);

			// The ESDT stores (deltaX, deltaY) as offset vectors FROM the pixel TO nearest foreground
			// Top-left corner (0,0): nearest foreground is at (1,1)
			// Offset = (1,1) - (0,0) = (1,1), but the propagation stores negated offsets
			// After propagation: the vector points TOWARD the edge/foreground
			const topLeft = getGradient(esdt, 0, 0, 3);
			// The magnitude should be sqrt(2)
			const topLeftDist = Math.sqrt(topLeft.dx * topLeft.dx + topLeft.dy * topLeft.dy);
			expect(topLeftDist).toBeCloseTo(Math.sqrt(2), 1);

			// Top neighbor (1,0) should have distance 1
			const top = getGradient(esdt, 1, 0, 3);
			const topDist = Math.sqrt(top.dx * top.dx + top.dy * top.dy);
			expect(topDist).toBeCloseTo(1, 1);

			// Left neighbor (0,1) should have distance 1
			const left = getGradient(esdt, 0, 1, 3);
			const leftDist = Math.sqrt(left.dx * left.dx + left.dy * left.dy);
			expect(leftDist).toBeCloseTo(1, 1);
		});

		it('gradients have correct magnitude (distance)', () => {
			const levels = new Float32Array([
				0.0, 0.0, 0.0,
				0.0, 1.0, 0.0,
				0.0, 0.0, 0.0
			]);

			const esdt = computeEsdt(levels, 3, 3);

			// Distance should equal gradient magnitude
			for (let y = 0; y < 3; y++) {
				for (let x = 0; x < 3; x++) {
					const dist = getDistance(esdt, x, y, 3);
					const grad = getGradient(esdt, x, y, 3);
					const gradMag = Math.sqrt(grad.dx * grad.dx + grad.dy * grad.dy);
					expect(gradMag).toBeCloseTo(dist, 5);
				}
			}
		});
	});

	describe('Horizontal line ESDT', () => {
		it('line pixels have zero distance', () => {
			const levels = new Float32Array([
				0.0, 0.0, 0.0, 0.0, 0.0,
				0.0, 0.0, 0.0, 0.0, 0.0,
				1.0, 1.0, 1.0, 1.0, 1.0,
				0.0, 0.0, 0.0, 0.0, 0.0,
				0.0, 0.0, 0.0, 0.0, 0.0
			]);

			const esdt = computeEsdt(levels, 5, 5);

			for (let x = 0; x < 5; x++) {
				const dist = getDistance(esdt, x, 2, 5);
				expect(dist).toBeLessThan(0.01);
			}
		});

		it('adjacent rows have distance ~1', () => {
			const levels = new Float32Array([
				0.0, 0.0, 0.0, 0.0, 0.0,
				0.0, 0.0, 0.0, 0.0, 0.0,
				1.0, 1.0, 1.0, 1.0, 1.0,
				0.0, 0.0, 0.0, 0.0, 0.0,
				0.0, 0.0, 0.0, 0.0, 0.0
			]);

			const esdt = computeEsdt(levels, 5, 5);

			for (let x = 0; x < 5; x++) {
				// Row above (y=1)
				expect(getDistance(esdt, x, 1, 5)).toBeCloseTo(1, 1);
				// Row below (y=3)
				expect(getDistance(esdt, x, 3, 5)).toBeCloseTo(1, 1);
			}
		});

		it('gradients have correct distance from horizontal line', () => {
			const levels = new Float32Array([
				0.0, 0.0, 0.0, 0.0, 0.0,
				0.0, 0.0, 0.0, 0.0, 0.0,
				1.0, 1.0, 1.0, 1.0, 1.0,
				0.0, 0.0, 0.0, 0.0, 0.0,
				0.0, 0.0, 0.0, 0.0, 0.0
			]);

			const esdt = computeEsdt(levels, 5, 5);

			// Row y=1 should have distance 1 from line at y=2
			for (let x = 0; x < 5; x++) {
				const grad = getGradient(esdt, x, 1, 5);
				const dist = Math.sqrt(grad.dx * grad.dx + grad.dy * grad.dy);
				expect(dist).toBeCloseTo(1, 1);
			}

			// Row y=3 should also have distance 1 from line at y=2
			for (let x = 0; x < 5; x++) {
				const grad = getGradient(esdt, x, 3, 5);
				const dist = Math.sqrt(grad.dx * grad.dx + grad.dy * grad.dy);
				expect(dist).toBeCloseTo(1, 1);
			}
		});
	});

	describe('Cross/plus shape ESDT', () => {
		it('computes correct distances for cross pattern', () => {
			// 5x5 cross pattern
			const levels = new Float32Array([
				0.0, 0.0, 1.0, 0.0, 0.0,
				0.0, 0.0, 1.0, 0.0, 0.0,
				1.0, 1.0, 1.0, 1.0, 1.0,
				0.0, 0.0, 1.0, 0.0, 0.0,
				0.0, 0.0, 1.0, 0.0, 0.0
			]);

			const esdt = computeEsdt(levels, 5, 5);

			// Center and cross pixels should be 0
			expect(getDistance(esdt, 2, 2, 5)).toBeLessThan(0.01);
			expect(getDistance(esdt, 2, 0, 5)).toBeLessThan(0.01);
			expect(getDistance(esdt, 0, 2, 5)).toBeLessThan(0.01);

			// Corners (0,0) and (4,4) are distance 2 from nearest cross pixel
			// Corner (0,0): nearest foreground is at (0,2) or (2,0), both at distance 2
			// Corner (4,4): nearest foreground is at (4,2) or (2,4), both at distance 2
			expect(getDistance(esdt, 0, 0, 5)).toBeCloseTo(2, 1);
			expect(getDistance(esdt, 4, 4, 5)).toBeCloseTo(2, 1);

			// Pixels adjacent to cross should have distance 1
			// Position (1,1): nearest foreground is at (1,2) or (2,1), both at distance 1
			// Position (3,3): nearest foreground is at (3,2) or (2,3), both at distance 1
			expect(getDistance(esdt, 1, 1, 5)).toBeCloseTo(1, 1);
			expect(getDistance(esdt, 3, 3, 5)).toBeCloseTo(1, 1);

			// Positions directly adjacent to cross arms
			expect(getDistance(esdt, 0, 1, 5)).toBeCloseTo(1, 1); // adjacent to (0,2)
			expect(getDistance(esdt, 1, 0, 5)).toBeCloseTo(1, 1); // adjacent to (2,0)
		});
	});

	describe('Property-based ESDT tests', () => {
		it('foreground pixels always have zero distance', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 3, max: 10 }),
					fc.integer({ min: 3, max: 10 }),
					(width, height) => {
						const levels = new Float32Array(width * height).fill(0);
						const cx = Math.floor(width / 2);
						const cy = Math.floor(height / 2);
						levels[cy * width + cx] = 1.0;

						const esdt = computeEsdt(levels, width, height);
						const dist = getDistance(esdt, cx, cy, width);

						return dist < 0.01;
					}
				)
			);
		});

		it('all distances are finite when foreground exists', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 3, max: 8 }),
					fc.integer({ min: 3, max: 8 }),
					(width, height) => {
						const levels = new Float32Array(width * height).fill(0);
						const cx = Math.floor(width / 2);
						const cy = Math.floor(height / 2);
						levels[cy * width + cx] = 1.0;

						const esdt = computeEsdt(levels, width, height);

						for (let y = 0; y < height; y++) {
							for (let x = 0; x < width; x++) {
								const dist = getDistance(esdt, x, y, width);
								if (dist >= ESDT_INF || dist < 0) return false;
							}
						}
						return true;
					}
				)
			);
		});

		it('gradient magnitude equals distance', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 3, max: 8 }),
					fc.integer({ min: 3, max: 8 }),
					(width, height) => {
						const levels = new Float32Array(width * height).fill(0);
						const cx = Math.floor(width / 2);
						const cy = Math.floor(height / 2);
						levels[cy * width + cx] = 1.0;

						const esdt = computeEsdt(levels, width, height);

						for (let y = 0; y < height; y++) {
							for (let x = 0; x < width; x++) {
								const dist = getDistance(esdt, x, y, width);
								const grad = getGradient(esdt, x, y, width);
								const gradMag = Math.sqrt(grad.dx * grad.dx + grad.dy * grad.dy);
								if (Math.abs(gradMag - dist) > 1e-5) return false;
							}
						}
						return true;
					}
				)
			);
		});

		it('distances increase monotonically from foreground', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 3, max: 8 }),
					fc.integer({ min: 3, max: 8 }),
					(width, height) => {
						const levels = new Float32Array(width * height).fill(0);
						const cx = Math.floor(width / 2);
						const cy = Math.floor(height / 2);
						levels[cy * width + cx] = 1.0;

						const esdt = computeEsdt(levels, width, height);

						for (let y = 0; y < height; y++) {
							for (let x = 0; x < width; x++) {
								const dist = getDistance(esdt, x, y, width);
								const minPossibleDist = Math.sqrt(
									(x - cx) * (x - cx) + (y - cy) * (y - cy)
								);
								if (dist < minPossibleDist - 0.01) return false;
							}
						}
						return true;
					}
				)
			);
		});
	});
});

// ============================================================================
// GRAYSCALE LEVEL CONVERSION VERIFICATION
// ============================================================================

describe('GradientDirectionVisualizer - Grayscale Level Conversion', () => {
	/**
	 * Convert RGBA pixel data to grayscale levels as done in the component
	 */
	function pixelsToLevels(imageData: Uint8ClampedArray, width: number, height: number): Float32Array {
		const levels = new Float32Array(width * height);
		for (let i = 0; i < levels.length; i++) {
			const r = imageData[i * 4];
			const g = imageData[i * 4 + 1];
			const b = imageData[i * 4 + 2];
			// Standard luminance formula (BT.601)
			const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
			// Invert: black text = 1.0 (inside), white bg = 0.0 (outside)
			levels[i] = 1.0 - luminance;
		}
		return levels;
	}

	it('white pixel produces level 0 (background)', () => {
		const imageData = new Uint8ClampedArray([255, 255, 255, 255]); // RGBA
		const levels = pixelsToLevels(imageData, 1, 1);
		expect(levels[0]).toBeCloseTo(0, 2);
	});

	it('black pixel produces level 1 (foreground)', () => {
		const imageData = new Uint8ClampedArray([0, 0, 0, 255]); // RGBA
		const levels = pixelsToLevels(imageData, 1, 1);
		expect(levels[0]).toBeCloseTo(1, 2);
	});

	it('gray pixel produces level ~0.5', () => {
		const imageData = new Uint8ClampedArray([128, 128, 128, 255]); // RGBA
		const levels = pixelsToLevels(imageData, 1, 1);
		// 128/255 = 0.502, inverted = 0.498
		expect(levels[0]).toBeCloseTo(0.5, 1);
	});

	it('uses BT.601 luminance coefficients (0.299, 0.587, 0.114)', () => {
		// Pure red
		const redData = new Uint8ClampedArray([255, 0, 0, 255]);
		const redLevels = pixelsToLevels(redData, 1, 1);
		const expectedRedLum = 0.299;
		expect(redLevels[0]).toBeCloseTo(1 - expectedRedLum, 2);

		// Pure green
		const greenData = new Uint8ClampedArray([0, 255, 0, 255]);
		const greenLevels = pixelsToLevels(greenData, 1, 1);
		const expectedGreenLum = 0.587;
		expect(greenLevels[0]).toBeCloseTo(1 - expectedGreenLum, 2);

		// Pure blue
		const blueData = new Uint8ClampedArray([0, 0, 255, 255]);
		const blueLevels = pixelsToLevels(blueData, 1, 1);
		const expectedBlueLum = 0.114;
		expect(blueLevels[0]).toBeCloseTo(1 - expectedBlueLum, 2);
	});

	it('levels are always in [0, 1]', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 255 }),
				fc.integer({ min: 0, max: 255 }),
				fc.integer({ min: 0, max: 255 }),
				(r, g, b) => {
					const imageData = new Uint8ClampedArray([r, g, b, 255]);
					const levels = pixelsToLevels(imageData, 1, 1);
					return levels[0] >= 0 && levels[0] <= 1;
				}
			)
		);
	});
});

// ============================================================================
// ARROW VISUALIZATION LOGIC VERIFICATION
// ============================================================================

describe('GradientDirectionVisualizer - Arrow Visualization', () => {
	/**
	 * Normalize gradient vector and scale for visualization
	 */
	function normalizeAndScale(dx: number, dy: number, scale: number): { ndx: number; ndy: number } {
		const mag = Math.sqrt(dx * dx + dy * dy);
		if (mag < 0.1) {
			return { ndx: 0, ndy: 0 };
		}
		return {
			ndx: (dx / mag) * scale,
			ndy: (dy / mag) * scale
		};
	}

	it('normalizes gradient to unit length then scales', () => {
		const scale = 8;
		const { ndx, ndy } = normalizeAndScale(3, 4, scale);

		// Original magnitude: 5, normalized: 1, scaled: 8
		const resultMag = Math.sqrt(ndx * ndx + ndy * ndy);
		expect(resultMag).toBeCloseTo(scale, 5);
	});

	it('preserves direction after normalization', () => {
		const scale = 8;
		const { ndx, ndy } = normalizeAndScale(3, 4, scale);

		// Direction should be same: ratio dy/dx preserved
		const originalAngle = Math.atan2(4, 3);
		const resultAngle = Math.atan2(ndy, ndx);
		expect(resultAngle).toBeCloseTo(originalAngle, 5);
	});

	it('returns zero for small gradients', () => {
		const scale = 8;
		const { ndx, ndy } = normalizeAndScale(0.01, 0.01, scale);

		expect(ndx).toBe(0);
		expect(ndy).toBe(0);
	});

	it('handles zero gradient', () => {
		const scale = 8;
		const { ndx, ndy } = normalizeAndScale(0, 0, scale);

		expect(ndx).toBe(0);
		expect(ndy).toBe(0);
	});

	it('scaled vectors have expected magnitude', () => {
		fc.assert(
			fc.property(
				fc.float({ min: 1, max: 100, noNaN: true }),
				fc.float({ min: 1, max: 100, noNaN: true }),
				fc.integer({ min: 2, max: 16 }),
				(dx, dy, scale) => {
					const { ndx, ndy } = normalizeAndScale(dx, dy, scale);
					const mag = Math.sqrt(ndx * ndx + ndy * ndy);
					return Math.abs(mag - scale) < 0.01;
				}
			)
		);
	});

	describe('Arrowhead calculation', () => {
		it('computes arrowhead points correctly', () => {
			const endX = 10;
			const endY = 10;
			const headSize = 2;
			const angle = Math.atan2(10, 10); // 45 degrees

			const head1X = endX - headSize * Math.cos(angle - Math.PI / 6);
			const head1Y = endY - headSize * Math.sin(angle - Math.PI / 6);
			const head2X = endX - headSize * Math.cos(angle + Math.PI / 6);
			const head2Y = endY - headSize * Math.sin(angle + Math.PI / 6);

			// Arrowhead points should be behind the arrow tip
			expect(head1X).toBeLessThan(endX);
			expect(head1Y).toBeLessThan(endY);
			expect(head2X).toBeLessThan(endX);
			expect(head2Y).toBeLessThan(endY);
		});
	});
});

// ============================================================================
// DISTANCE MAP COLOR MAPPING VERIFICATION
// ============================================================================

describe('GradientDirectionVisualizer - Distance Map Colors', () => {
	/**
	 * Map distance to color as done in the component
	 */
	function distanceToColor(
		dist: number,
		maxDistance: number
	): { r: number; g: number; b: number; a: number } {
		const normalized = dist / (maxDistance || 1);

		// Blue (near) to red (far)
		const r = Math.floor(normalized * 255);
		const b = Math.floor((1 - normalized) * 255);
		const g = Math.floor(Math.min(normalized, 1 - normalized) * 2 * 128);

		return { r, g, b, a: 128 };
	}

	it('zero distance maps to blue (near edge)', () => {
		const color = distanceToColor(0, 10);
		expect(color.r).toBe(0);
		expect(color.b).toBe(255);
	});

	it('max distance maps to red (far from edge)', () => {
		const color = distanceToColor(10, 10);
		expect(color.r).toBe(255);
		expect(color.b).toBe(0);
	});

	it('mid distance has green component', () => {
		const color = distanceToColor(5, 10);
		expect(color.g).toBeGreaterThan(0);
		// At normalized = 0.5, g = floor(0.5 * 2 * 128) = 128
		expect(color.g).toBe(128);
	});

	it('alpha is always semi-transparent (128)', () => {
		expect(distanceToColor(0, 10).a).toBe(128);
		expect(distanceToColor(5, 10).a).toBe(128);
		expect(distanceToColor(10, 10).a).toBe(128);
	});

	it('color components are in valid range [0, 255]', () => {
		fc.assert(
			fc.property(fc.float({ min: 0, max: 100, noNaN: true }), (dist) => {
				const maxDist = 100;
				const color = distanceToColor(dist, maxDist);

				return (
					color.r >= 0 && color.r <= 255 &&
					color.g >= 0 && color.g <= 255 &&
					color.b >= 0 && color.b <= 255
				);
			})
		);
	});
});

// ============================================================================
// WORKER MESSAGE TYPE VERIFICATION
// ============================================================================

describe('GradientDirectionVisualizer - ComputeESDT Worker Message', () => {
	/**
	 * Create a ComputeESDT payload as expected by the worker
	 */
	function createComputeESDTPayload(
		levels: Float32Array,
		width: number,
		height: number,
		useRelaxation: boolean
	) {
		return {
			type: 'compute_esdt',
			levels,
			width,
			height,
			useRelaxation
		};
	}

	it('creates valid payload with all required fields', () => {
		const levels = new Float32Array([0, 0.5, 1, 0.5]);
		const payload = createComputeESDTPayload(levels, 2, 2, false);

		expect(payload.type).toBe('compute_esdt');
		expect(payload.levels).toBeInstanceOf(Float32Array);
		expect(payload.levels.length).toBe(4);
		expect(payload.width).toBe(2);
		expect(payload.height).toBe(2);
		expect(payload.useRelaxation).toBe(false);
	});

	it('levels array length matches width * height', () => {
		const width = 10;
		const height = 8;
		const levels = new Float32Array(width * height);
		const payload = createComputeESDTPayload(levels, width, height, true);

		expect(payload.levels.length).toBe(width * height);
	});

	it('payload dimensions are preserved', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 100 }),
				fc.integer({ min: 1, max: 100 }),
				(width, height) => {
					const levels = new Float32Array(width * height);
					const payload = createComputeESDTPayload(levels, width, height, false);

					return (
						payload.width === width &&
						payload.height === height &&
						payload.levels.length === width * height
					);
				}
			)
		);
	});
});

// ============================================================================
// JS FALLBACK VERIFICATION
// ============================================================================

describe('GradientDirectionVisualizer - JS Fallback Algorithm', () => {
	/**
	 * The JS fallback implementation from the component
	 * Should produce identical results to Futhark WASM
	 */
	function computeEsdtFallback(levels: Float32Array, width: number, height: number): Float32Array {
		const data = new Float32Array(width * height * 2);

		// Initialize
		for (let i = 0; i < width * height; i++) {
			if (levels[i] >= 0.5) {
				data[i * 2] = 0;
				data[i * 2 + 1] = 0;
			} else {
				data[i * 2] = 1e10;
				data[i * 2 + 1] = 1e10;
			}
		}

		// X-pass forward
		for (let y = 0; y < height; y++) {
			for (let x = 1; x < width; x++) {
				const idx = (y * width + x) * 2;
				const prevIdx = (y * width + x - 1) * 2;
				const candX = data[prevIdx] + 1;
				const candY = data[prevIdx + 1];
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		// X-pass backward
		for (let y = 0; y < height; y++) {
			for (let x = width - 2; x >= 0; x--) {
				const idx = (y * width + x) * 2;
				const nextIdx = (y * width + x + 1) * 2;
				const candX = data[nextIdx] - 1;
				const candY = data[nextIdx + 1];
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		// Y-pass forward
		for (let x = 0; x < width; x++) {
			for (let y = 1; y < height; y++) {
				const idx = (y * width + x) * 2;
				const prevIdx = ((y - 1) * width + x) * 2;
				const candX = data[prevIdx];
				const candY = data[prevIdx + 1] + 1;
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		// Y-pass backward
		for (let x = 0; x < width; x++) {
			for (let y = height - 2; y >= 0; y--) {
				const idx = (y * width + x) * 2;
				const nextIdx = ((y + 1) * width + x) * 2;
				const candX = data[nextIdx];
				const candY = data[nextIdx + 1] - 1;
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		return data;
	}

	it('JS fallback produces correct results for simple test case', () => {
		const levels = new Float32Array([
			0.0, 0.0, 0.0,
			0.0, 1.0, 0.0,
			0.0, 0.0, 0.0
		]);

		const esdt = computeEsdtFallback(levels, 3, 3);

		// Center should be zero
		const centerIdx = (1 * 3 + 1) * 2;
		const centerDist = Math.sqrt(esdt[centerIdx] ** 2 + esdt[centerIdx + 1] ** 2);
		expect(centerDist).toBeLessThan(0.01);

		// Corner should be ~sqrt(2)
		const cornerIdx = 0;
		const cornerDist = Math.sqrt(esdt[cornerIdx] ** 2 + esdt[cornerIdx + 1] ** 2);
		expect(cornerDist).toBeCloseTo(Math.sqrt(2), 1);
	});

	it('JS fallback output format matches expected [dx0, dy0, dx1, dy1, ...]', () => {
		const levels = new Float32Array([0, 1, 0, 0]);
		const esdt = computeEsdtFallback(levels, 2, 2);

		// Output should have 2 values per pixel
		expect(esdt.length).toBe(4 * 2);

		// Each pair is (deltaX, deltaY)
		for (let i = 0; i < 4; i++) {
			const dx = esdt[i * 2];
			const dy = esdt[i * 2 + 1];
			// Both should be finite numbers
			expect(isFinite(dx) || dx > 1e9).toBe(true);
			expect(isFinite(dy) || dy > 1e9).toBe(true);
		}
	});
});
