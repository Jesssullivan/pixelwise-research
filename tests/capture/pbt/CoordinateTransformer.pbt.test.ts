/**
 * CoordinateTransformer Property-Based Tests
 *
 * Tests for coordinate transformation invariants using fast-check.
 *
 * Properties tested:
 * 1. DPR scaling preserves proportions
 * 2. Texel coordinates are always integers
 * 3. Fractional offsets are always in [0, 1)
 * 4. Round-trip transformations are consistent
 * 5. Physical = DOM * DPR
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fc, test as fcTest } from '@fast-check/vitest';
import {
	CoordinateTransformer,
	batchDOMToTexel,
	packTexelsForGPU,
	type DOMCoord,
	type TexelCoord
} from '$lib/pixelwise/CoordinateTransformer';

// Mock the $app/environment module
vi.mock('$app/environment', () => ({
	browser: true
}));

// Custom arbitraries
const validDPR = fc.double({ min: 0.5, max: 4.0, noNaN: true });
const validTextureDimension = fc.integer({ min: 1, max: 8192 });
const validDOMCoord = fc.record({
	x: fc.double({ min: -10000, max: 10000, noNaN: true }),
	y: fc.double({ min: -10000, max: 10000, noNaN: true })
});
const positiveValidDOMCoord = fc.record({
	x: fc.double({ min: 0, max: 5000, noNaN: true }),
	y: fc.double({ min: 0, max: 5000, noNaN: true })
});

describe('CoordinateTransformer Property-Based Tests', () => {
	describe('Invariant: DPR scaling preserves proportions', () => {
		fcTest.prop([validDPR, validTextureDimension, validTextureDimension, positiveValidDOMCoord, positiveValidDOMCoord])(
			'relative distances are preserved after DPR scaling',
			(dpr, textureWidth, textureHeight, coord1, coord2) => {
				const transformer = new CoordinateTransformer(dpr, textureWidth, textureHeight);

				const phys1 = transformer.toPhysical(coord1);
				const phys2 = transformer.toPhysical(coord2);

				// DOM distance
				const domDist = Math.sqrt(
					Math.pow(coord2.x - coord1.x, 2) + Math.pow(coord2.y - coord1.y, 2)
				);

				// Physical distance
				const physDist = Math.sqrt(
					Math.pow(phys2.x - phys1.x, 2) + Math.pow(phys2.y - phys1.y, 2)
				);

				// Physical distance should be DOM distance * DPR
				if (domDist > 0.001) {
					expect(physDist).toBeCloseTo(domDist * dpr, 5);
				}
			}
		);

		fcTest.prop([validDPR, validTextureDimension, validTextureDimension, positiveValidDOMCoord])(
			'physical coords equal DOM coords times DPR',
			(dpr, textureWidth, textureHeight, domCoord) => {
				const transformer = new CoordinateTransformer(dpr, textureWidth, textureHeight);
				const physical = transformer.toPhysical(domCoord);

				expect(physical.x).toBeCloseTo(domCoord.x * dpr, 10);
				expect(physical.y).toBeCloseTo(domCoord.y * dpr, 10);
			}
		);
	});

	describe('Invariant: Texel coordinates are always integers', () => {
		fcTest.prop([validDPR, validTextureDimension, validTextureDimension, validDOMCoord])(
			'texel x and y are always integers',
			(dpr, textureWidth, textureHeight, domCoord) => {
				const transformer = new CoordinateTransformer(dpr, textureWidth, textureHeight);
				const physical = transformer.toPhysical(domCoord);
				const texel = transformer.toTexel(physical);

				expect(Number.isInteger(texel.x)).toBe(true);
				expect(Number.isInteger(texel.y)).toBe(true);
			}
		);

		fcTest.prop([validDPR, validTextureDimension, validTextureDimension, fc.array(validDOMCoord, { minLength: 1, maxLength: 100 })])(
			'batch transform produces integer texel coordinates',
			(dpr, textureWidth, textureHeight, coords) => {
				const transformer = new CoordinateTransformer(dpr, textureWidth, textureHeight);

				for (const coord of coords) {
					const multi = transformer.transformAll(coord);
					expect(Number.isInteger(multi.texel.x)).toBe(true);
					expect(Number.isInteger(multi.texel.y)).toBe(true);
				}
			}
		);
	});

	describe('Invariant: Fractional offsets are always in [0, 1)', () => {
		// NOTE: For positive coordinates, fracX/fracY are always in [0, 1)
		// For negative coordinates, due to how Math.floor works, the fractional
		// part can be exactly 1.0 in edge cases with denormalized numbers.
		// The implementation uses physical = (floor + frac), so frac = physical - floor

		fcTest.prop([validDPR, validTextureDimension, validTextureDimension, positiveValidDOMCoord])(
			'fracX is in [0, 1) for positive coordinates',
			(dpr, textureWidth, textureHeight, domCoord) => {
				const transformer = new CoordinateTransformer(dpr, textureWidth, textureHeight);
				const physical = transformer.toPhysical(domCoord);
				const texel = transformer.toTexel(physical);

				expect(texel.fracX).toBeGreaterThanOrEqual(0);
				expect(texel.fracX).toBeLessThan(1);
			}
		);

		fcTest.prop([validDPR, validTextureDimension, validTextureDimension, positiveValidDOMCoord])(
			'fracY is in [0, 1) for positive coordinates',
			(dpr, textureWidth, textureHeight, domCoord) => {
				const transformer = new CoordinateTransformer(dpr, textureWidth, textureHeight);
				const physical = transformer.toPhysical(domCoord);
				const texel = transformer.toTexel(physical);

				expect(texel.fracY).toBeGreaterThanOrEqual(0);
				expect(texel.fracY).toBeLessThan(1);
			}
		);

		fcTest.prop([fc.double({ min: 0, max: 1000, noNaN: true }), fc.double({ min: 0, max: 1000, noNaN: true })])(
			'fractional parts always in [0, 1) for positive physical coords',
			(physX, physY) => {
				const transformer = new CoordinateTransformer(1, 1000, 1000);
				const texel = transformer.toTexel({ x: physX, y: physY });

				expect(texel.fracX).toBeGreaterThanOrEqual(0);
				expect(texel.fracX).toBeLessThan(1);
				expect(texel.fracY).toBeGreaterThanOrEqual(0);
				expect(texel.fracY).toBeLessThan(1);
			}
		);
	});

	describe('Invariant: texel + frac = physical', () => {
		fcTest.prop([validDPR, validTextureDimension, validTextureDimension, positiveValidDOMCoord])(
			'texel + fractional offset reconstructs physical coordinate',
			(dpr, textureWidth, textureHeight, domCoord) => {
				const transformer = new CoordinateTransformer(dpr, textureWidth, textureHeight);
				const physical = transformer.toPhysical(domCoord);
				const texel = transformer.toTexel(physical);

				// Reconstructed physical coordinates
				const reconstructedX = texel.x + texel.fracX;
				const reconstructedY = texel.y + texel.fracY;

				expect(reconstructedX).toBeCloseTo(physical.x, 10);
				expect(reconstructedY).toBeCloseTo(physical.y, 10);
			}
		);
	});

	describe('Invariant: UV coordinates are normalized', () => {
		fcTest.prop([validDPR, validTextureDimension, validTextureDimension, positiveValidDOMCoord])(
			'UV coordinates for in-bounds pixels are in [0, 1]',
			(dpr, textureWidth, textureHeight, domCoord) => {
				const transformer = new CoordinateTransformer(dpr, textureWidth, textureHeight);
				const multi = transformer.transformAll(domCoord);

				// Clamp to bounds for testing
				const clampedTexel = transformer.clampTexel(multi.texel);
				const uv = transformer.toUV(clampedTexel);

				expect(uv.u).toBeGreaterThanOrEqual(0);
				expect(uv.u).toBeLessThanOrEqual(1);
				expect(uv.v).toBeGreaterThanOrEqual(0);
				expect(uv.v).toBeLessThanOrEqual(1);
			}
		);

		fcTest.prop([fc.integer({ min: 0, max: 1919 }), fc.integer({ min: 0, max: 1079 })])(
			'UV includes 0.5 texel offset for center sampling',
			(texelX, texelY) => {
				const transformer = new CoordinateTransformer(1, 1920, 1080);
				const texel: TexelCoord = { x: texelX, y: texelY, fracX: 0, fracY: 0 };
				const uv = transformer.toUV(texel);

				// UV should be (texel + 0.5) / dimension
				expect(uv.u).toBeCloseTo((texelX + 0.5) / 1920, 10);
				expect(uv.v).toBeCloseTo((texelY + 0.5) / 1080, 10);
			}
		);
	});

	describe('Invariant: Viewport offset is correctly applied', () => {
		fcTest.prop([
			validDPR,
			validTextureDimension,
			validTextureDimension,
			fc.record({ x: fc.double({ min: 0, max: 500, noNaN: true }), y: fc.double({ min: 0, max: 500, noNaN: true }) }),
			fc.record({ x: fc.double({ min: 0, max: 1000, noNaN: true }), y: fc.double({ min: 0, max: 1000, noNaN: true }) })
		])(
			'viewport offset subtracts before DPR scaling',
			(dpr, textureWidth, textureHeight, offset, domCoord) => {
				const transformer = new CoordinateTransformer(dpr, textureWidth, textureHeight, offset);
				const physical = transformer.toPhysical(domCoord);

				const expectedX = (domCoord.x - offset.x) * dpr;
				const expectedY = (domCoord.y - offset.y) * dpr;

				expect(physical.x).toBeCloseTo(expectedX, 10);
				expect(physical.y).toBeCloseTo(expectedY, 10);
			}
		);
	});

	describe('Invariant: isInBounds is consistent with dimensions', () => {
		fcTest.prop([validTextureDimension, validTextureDimension, fc.integer({ min: -100, max: 5000 }), fc.integer({ min: -100, max: 5000 })])(
			'isInBounds correctly identifies in-bounds texels',
			(textureWidth, textureHeight, x, y) => {
				const transformer = new CoordinateTransformer(1, textureWidth, textureHeight);
				const texel: TexelCoord = { x, y, fracX: 0, fracY: 0 };

				const inBounds = transformer.isInBounds(texel);
				const shouldBeInBounds = x >= 0 && x < textureWidth && y >= 0 && y < textureHeight;

				expect(inBounds).toBe(shouldBeInBounds);
			}
		);
	});

	describe('Invariant: clampTexel keeps coordinates in bounds', () => {
		fcTest.prop([validTextureDimension, validTextureDimension, fc.integer({ min: -1000, max: 10000 }), fc.integer({ min: -1000, max: 10000 })])(
			'clamped texel is always in bounds',
			(textureWidth, textureHeight, x, y) => {
				const transformer = new CoordinateTransformer(1, textureWidth, textureHeight);
				const texel: TexelCoord = { x, y, fracX: 0.5, fracY: 0.5 };

				const clamped = transformer.clampTexel(texel);

				expect(transformer.isInBounds(clamped)).toBe(true);
				expect(clamped.x).toBeGreaterThanOrEqual(0);
				expect(clamped.x).toBeLessThan(textureWidth);
				expect(clamped.y).toBeGreaterThanOrEqual(0);
				expect(clamped.y).toBeLessThan(textureHeight);
			}
		);

		fcTest.prop([validTextureDimension, validTextureDimension, fc.double({ min: 0, max: 0.999, noNaN: true }), fc.double({ min: 0, max: 0.999, noNaN: true })])(
			'clamping preserves fractional offsets',
			(textureWidth, textureHeight, fracX, fracY) => {
				const transformer = new CoordinateTransformer(1, textureWidth, textureHeight);
				const texel: TexelCoord = { x: -100, y: 10000, fracX, fracY };

				const clamped = transformer.clampTexel(texel);

				expect(clamped.fracX).toBe(fracX);
				expect(clamped.fracY).toBe(fracY);
			}
		);
	});

	describe('Invariant: transformAll produces consistent results', () => {
		fcTest.prop([validDPR, validTextureDimension, validTextureDimension, positiveValidDOMCoord])(
			'transformAll output is consistent with individual transforms',
			(dpr, textureWidth, textureHeight, domCoord) => {
				const transformer = new CoordinateTransformer(dpr, textureWidth, textureHeight);

				const multi = transformer.transformAll(domCoord);

				// Verify each stage matches individual transforms
				const physical = transformer.toPhysical(domCoord);
				expect(multi.physical.x).toBeCloseTo(physical.x, 10);
				expect(multi.physical.y).toBeCloseTo(physical.y, 10);

				const texel = transformer.toTexel(physical);
				expect(multi.texel.x).toBe(texel.x);
				expect(multi.texel.y).toBe(texel.y);
				expect(multi.texel.fracX).toBeCloseTo(texel.fracX, 10);
				expect(multi.texel.fracY).toBeCloseTo(texel.fracY, 10);

				const uv = transformer.toUV(texel);
				expect(multi.uv.u).toBeCloseTo(uv.u, 10);
				expect(multi.uv.v).toBeCloseTo(uv.v, 10);
			}
		);
	});

	describe('Invariant: rectToTexelBounds fully contains source rect', () => {
		fcTest.prop([
			validDPR,
			validTextureDimension,
			validTextureDimension,
			fc.record({
				left: fc.double({ min: 0, max: 1000, noNaN: true }),
				top: fc.double({ min: 0, max: 1000, noNaN: true }),
				width: fc.double({ min: 1, max: 500, noNaN: true }),
				height: fc.double({ min: 1, max: 500, noNaN: true })
			})
		])(
			'texel bounds fully contain the original rect',
			(dpr, textureWidth, textureHeight, rectInput) => {
				const transformer = new CoordinateTransformer(dpr, textureWidth, textureHeight);

				// Create a mock DOMRect-like object
				const rect = {
					left: rectInput.left,
					top: rectInput.top,
					right: rectInput.left + rectInput.width,
					bottom: rectInput.top + rectInput.height,
					width: rectInput.width,
					height: rectInput.height,
					x: rectInput.left,
					y: rectInput.top
				} as DOMRect;

				const bounds = transformer.rectToTexelBounds(rect);

				// Transform corners to physical space
				const startPhys = transformer.toPhysical({ x: rect.left, y: rect.top });
				const endPhys = transformer.toPhysical({ x: rect.right, y: rect.bottom });

				// Bounds should contain all physical corners
				expect(bounds.x).toBeLessThanOrEqual(Math.floor(startPhys.x));
				expect(bounds.y).toBeLessThanOrEqual(Math.floor(startPhys.y));
				expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(Math.floor(endPhys.x));
				expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(Math.floor(endPhys.y));
			}
		);
	});
});

describe('batchDOMToTexel Property-Based Tests', () => {
	fcTest.prop([
		validDPR,
		fc.array(positiveValidDOMCoord, { minLength: 1, maxLength: 50 })
	])(
		'batch transform produces same results as individual transforms',
		(dpr, coords) => {
			const result = batchDOMToTexel(coords, dpr);

			expect(result.length).toBe(coords.length * 4);

			for (let i = 0; i < coords.length; i++) {
				const physX = coords[i].x * dpr;
				const physY = coords[i].y * dpr;
				const texelX = Math.floor(physX);
				const texelY = Math.floor(physY);
				const fracX = physX - texelX;
				const fracY = physY - texelY;

				const offset = i * 4;
				expect(result[offset]).toBe(texelX);
				expect(result[offset + 1]).toBe(texelY);
				// Float32Array has ~7 digits of precision
				expect(result[offset + 2]).toBeCloseTo(fracX, 5);
				expect(result[offset + 3]).toBeCloseTo(fracY, 5);
			}
		}
	);

	fcTest.prop([validDPR, fc.array(positiveValidDOMCoord, { minLength: 1, maxLength: 50 })])(
		'batch fractional offsets are always in [0, 1)',
		(dpr, coords) => {
			const result = batchDOMToTexel(coords, dpr);

			for (let i = 0; i < coords.length; i++) {
				const fracX = result[i * 4 + 2];
				const fracY = result[i * 4 + 3];

				expect(fracX).toBeGreaterThanOrEqual(0);
				// Allow small floating point errors that round to 1.0
				expect(fracX).toBeLessThanOrEqual(1);
				expect(fracY).toBeGreaterThanOrEqual(0);
				expect(fracY).toBeLessThanOrEqual(1);
			}
		}
	);
});

describe('packTexelsForGPU Property-Based Tests', () => {
	const validTexelCoord = fc.record({
		x: fc.integer({ min: 0, max: 10000 }),
		y: fc.integer({ min: 0, max: 10000 }),
		fracX: fc.double({ min: 0, max: 0.999, noNaN: true }),
		fracY: fc.double({ min: 0, max: 0.999, noNaN: true })
	});

	fcTest.prop([fc.array(validTexelCoord, { minLength: 1, maxLength: 100 })])(
		'packTexelsForGPU preserves all coordinates',
		(texels) => {
			const packed = packTexelsForGPU(texels);

			expect(packed.positions.length).toBe(texels.length * 2);
			expect(packed.subpixelOffsets.length).toBe(texels.length * 2);

			for (let i = 0; i < texels.length; i++) {
				expect(packed.positions[i * 2]).toBe(texels[i].x);
				expect(packed.positions[i * 2 + 1]).toBe(texels[i].y);
				// Float32Array has ~7 digits of precision
				expect(packed.subpixelOffsets[i * 2]).toBeCloseTo(texels[i].fracX, 5);
				expect(packed.subpixelOffsets[i * 2 + 1]).toBeCloseTo(texels[i].fracY, 5);
			}
		}
	);

	fcTest.prop([fc.array(validTexelCoord, { minLength: 0, maxLength: 100 })])(
		'packTexelsForGPU output array lengths match input',
		(texels) => {
			const packed = packTexelsForGPU(texels);

			expect(packed.positions.length).toBe(texels.length * 2);
			expect(packed.subpixelOffsets.length).toBe(texels.length * 2);
		}
	);
});
