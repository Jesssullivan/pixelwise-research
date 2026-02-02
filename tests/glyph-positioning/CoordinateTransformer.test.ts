/**
 * CoordinateTransformer Tests
 *
 * Tests for the multi-space coordinate transformation system.
 *
 * Tests cover:
 * - DOM to Physical space conversion
 * - Physical to Texel space conversion with subpixel preservation
 * - Texel to UV space conversion
 * - Full transformation chain
 * - DPR scaling
 * - Viewport offset handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	CoordinateTransformer,
	batchDOMToTexel,
	packTexelsForGPU,
	type DOMCoord,
	type PhysicalCoord,
	type TexelCoord,
	type UVCoord
} from '$lib/pixelwise/CoordinateTransformer';

describe('CoordinateTransformer', () => {
	describe('construction', () => {
		it('should create transformer with specified parameters', () => {
			const transformer = new CoordinateTransformer(2.0, 1920, 1080);

			expect(transformer.dpr).toBe(2.0);
			expect(transformer.textureWidth).toBe(1920);
			expect(transformer.textureHeight).toBe(1080);
		});

		it('should default viewport offset to origin', () => {
			const transformer = new CoordinateTransformer(1.0, 800, 600);

			// With zero offset, toPhysical should just scale by DPR
			const physical = transformer.toPhysical({ x: 100, y: 50 });
			expect(physical.x).toBe(100);
			expect(physical.y).toBe(50);
		});

		it('should accept custom viewport offset', () => {
			const transformer = new CoordinateTransformer(1.0, 800, 600, { x: 10, y: 20 });

			const physical = transformer.toPhysical({ x: 100, y: 50 });
			expect(physical.x).toBe(90); // 100 - 10
			expect(physical.y).toBe(30); // 50 - 20
		});
	});

	describe('toPhysical', () => {
		it('should scale DOM coordinates by DPR', () => {
			const transformer = new CoordinateTransformer(2.0, 1920, 1080);

			const physical = transformer.toPhysical({ x: 100, y: 50 });

			expect(physical.x).toBe(200); // 100 * 2
			expect(physical.y).toBe(100); // 50 * 2
		});

		it('should preserve fractional coordinates', () => {
			const transformer = new CoordinateTransformer(1.5, 1920, 1080);

			const physical = transformer.toPhysical({ x: 10.5, y: 20.25 });

			expect(physical.x).toBeCloseTo(15.75); // 10.5 * 1.5
			expect(physical.y).toBeCloseTo(30.375); // 20.25 * 1.5
		});

		it('should apply viewport offset before scaling', () => {
			const transformer = new CoordinateTransformer(2.0, 1920, 1080, { x: 50, y: 25 });

			const physical = transformer.toPhysical({ x: 100, y: 50 });

			expect(physical.x).toBe(100); // (100 - 50) * 2
			expect(physical.y).toBe(50); // (50 - 25) * 2
		});
	});

	describe('toTexel', () => {
		it('should convert physical to integer texel coordinates', () => {
			const transformer = new CoordinateTransformer(1.0, 1920, 1080);

			const texel = transformer.toTexel({ x: 150.7, y: 200.3 });

			expect(texel.x).toBe(150);
			expect(texel.y).toBe(200);
		});

		it('should preserve subpixel offsets', () => {
			const transformer = new CoordinateTransformer(1.0, 1920, 1080);

			const texel = transformer.toTexel({ x: 150.7, y: 200.3 });

			expect(texel.fracX).toBeCloseTo(0.7);
			expect(texel.fracY).toBeCloseTo(0.3);
		});

		it('should have fracX and fracY in range [0, 1)', () => {
			const transformer = new CoordinateTransformer(1.0, 1920, 1080);

			const texel = transformer.toTexel({ x: 99.999, y: 0.001 });

			expect(texel.fracX).toBeGreaterThanOrEqual(0);
			expect(texel.fracX).toBeLessThan(1);
			expect(texel.fracY).toBeGreaterThanOrEqual(0);
			expect(texel.fracY).toBeLessThan(1);
		});

		it('should handle negative coordinates', () => {
			const transformer = new CoordinateTransformer(1.0, 1920, 1080);

			const texel = transformer.toTexel({ x: -0.5, y: -1.7 });

			expect(texel.x).toBe(-1); // floor(-0.5)
			expect(texel.y).toBe(-2); // floor(-1.7)
		});
	});

	describe('toUV', () => {
		it('should normalize texel coordinates to [0, 1]', () => {
			const transformer = new CoordinateTransformer(1.0, 100, 100);

			const uv = transformer.toUV({ x: 50, y: 50, fracX: 0, fracY: 0 });

			// With +0.5 texel center offset: (50 + 0.5) / 100 = 0.505
			expect(uv.u).toBeCloseTo(0.505);
			expect(uv.v).toBeCloseTo(0.505);
		});

		it('should add 0.5 texel offset for center sampling', () => {
			const transformer = new CoordinateTransformer(1.0, 100, 100);

			const uv = transformer.toUV({ x: 0, y: 0, fracX: 0, fracY: 0 });

			// First texel center: (0 + 0.5) / 100 = 0.005
			expect(uv.u).toBeCloseTo(0.005);
			expect(uv.v).toBeCloseTo(0.005);
		});
	});

	describe('toUVPrecise', () => {
		it('should include subpixel offsets in UV calculation', () => {
			const transformer = new CoordinateTransformer(1.0, 100, 100);

			const uv = transformer.toUVPrecise({ x: 50, y: 50, fracX: 0.25, fracY: 0.75 });

			// (50 + 0.25 + 0.5) / 100 = 0.5075
			expect(uv.u).toBeCloseTo(0.5075);
			// (50 + 0.75 + 0.5) / 100 = 0.5125
			expect(uv.v).toBeCloseTo(0.5125);
		});
	});

	describe('transformAll', () => {
		it('should transform through all coordinate spaces', () => {
			const transformer = new CoordinateTransformer(2.0, 400, 300);

			const result = transformer.transformAll({ x: 100.25, y: 75.5 });

			// DOM
			expect(result.dom.x).toBe(100.25);
			expect(result.dom.y).toBe(75.5);

			// Physical (DOM * DPR)
			expect(result.physical.x).toBeCloseTo(200.5);
			expect(result.physical.y).toBeCloseTo(151);

			// Texel (floor of physical)
			expect(result.texel.x).toBe(200);
			expect(result.texel.y).toBe(151);
			expect(result.texel.fracX).toBeCloseTo(0.5);
			expect(result.texel.fracY).toBeCloseTo(0);

			// UV (texel + 0.5) / dimensions
			expect(result.uv.u).toBeCloseTo((200 + 0.5) / 400);
			expect(result.uv.v).toBeCloseTo((151 + 0.5) / 300);
		});
	});

	describe('rectToTexelBounds', () => {
		it('should convert DOMRect to texel bounds', () => {
			const transformer = new CoordinateTransformer(1.0, 1000, 1000);

			const rect = new DOMRect(100, 200, 50, 30);
			const bounds = transformer.rectToTexelBounds(rect);

			expect(bounds.x).toBe(100);
			expect(bounds.y).toBe(200);
			expect(bounds.width).toBe(50);
			expect(bounds.height).toBe(30);
		});

		it('should expand bounds to fully contain fractional rect', () => {
			const transformer = new CoordinateTransformer(1.0, 1000, 1000);

			// Rect from 100.5 to 150.5 should cover texels 100-150 (width 51)
			const rect = new DOMRect(100.5, 200.5, 50, 30);
			const bounds = transformer.rectToTexelBounds(rect);

			expect(bounds.x).toBe(100);
			expect(bounds.y).toBe(200);
			// End at 150.5 and 230.5, which have non-zero fractions
			// So width = 151 - 100 = 51, height = 231 - 200 = 31
			expect(bounds.width).toBe(51);
			expect(bounds.height).toBe(31);
		});

		it('should preserve fractional offsets', () => {
			const transformer = new CoordinateTransformer(1.0, 1000, 1000);

			const rect = new DOMRect(100.3, 200.7, 50, 30);
			const bounds = transformer.rectToTexelBounds(rect);

			expect(bounds.fracStartX).toBeCloseTo(0.3);
			expect(bounds.fracStartY).toBeCloseTo(0.7);
		});
	});

	describe('isInBounds', () => {
		it('should return true for texel within texture bounds', () => {
			const transformer = new CoordinateTransformer(1.0, 100, 100);

			expect(transformer.isInBounds({ x: 50, y: 50, fracX: 0, fracY: 0 })).toBe(true);
			expect(transformer.isInBounds({ x: 0, y: 0, fracX: 0, fracY: 0 })).toBe(true);
			expect(transformer.isInBounds({ x: 99, y: 99, fracX: 0, fracY: 0 })).toBe(true);
		});

		it('should return false for texel outside texture bounds', () => {
			const transformer = new CoordinateTransformer(1.0, 100, 100);

			expect(transformer.isInBounds({ x: -1, y: 50, fracX: 0, fracY: 0 })).toBe(false);
			expect(transformer.isInBounds({ x: 100, y: 50, fracX: 0, fracY: 0 })).toBe(false);
			expect(transformer.isInBounds({ x: 50, y: -1, fracX: 0, fracY: 0 })).toBe(false);
			expect(transformer.isInBounds({ x: 50, y: 100, fracX: 0, fracY: 0 })).toBe(false);
		});
	});

	describe('clampTexel', () => {
		it('should clamp texel to texture bounds', () => {
			const transformer = new CoordinateTransformer(1.0, 100, 100);

			const clamped = transformer.clampTexel({ x: 150, y: -20, fracX: 0.5, fracY: 0.5 });

			expect(clamped.x).toBe(99);
			expect(clamped.y).toBe(0);
			expect(clamped.fracX).toBe(0.5); // Preserved
			expect(clamped.fracY).toBe(0.5); // Preserved
		});
	});

	describe('static factories', () => {
		it('fromViewport should create transformer for viewport', () => {
			// This relies on window being available, may need mocking
			const transformer = CoordinateTransformer.fromViewport(1920, 1080);

			expect(transformer.textureWidth).toBe(1920);
			expect(transformer.textureHeight).toBe(1080);
		});
	});
});

describe('batchDOMToTexel', () => {
	it('should transform multiple DOM coordinates to texel space', () => {
		const coords = [
			{ x: 100.5, y: 200.25 },
			{ x: 300.75, y: 400.0 }
		];

		const result = batchDOMToTexel(coords, 2.0);

		// First coord: (100.5 * 2, 200.25 * 2) = (201, 400.5)
		expect(result[0]).toBe(201); // texelX
		expect(result[1]).toBe(400); // texelY
		expect(result[2]).toBeCloseTo(0); // fracX
		expect(result[3]).toBeCloseTo(0.5); // fracY

		// Second coord: (300.75 * 2, 400 * 2) = (601.5, 800)
		expect(result[4]).toBe(601); // texelX
		expect(result[5]).toBe(800); // texelY
		expect(result[6]).toBeCloseTo(0.5); // fracX
		expect(result[7]).toBeCloseTo(0); // fracY
	});

	it('should apply viewport offset', () => {
		const coords = [{ x: 100, y: 50 }];

		const result = batchDOMToTexel(coords, 1.0, { x: 10, y: 5 });

		expect(result[0]).toBe(90); // 100 - 10
		expect(result[1]).toBe(45); // 50 - 5
	});

	it('should return Float32Array with 4 elements per coordinate', () => {
		const coords = [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
			{ x: 2, y: 2 }
		];

		const result = batchDOMToTexel(coords, 1.0);

		expect(result).toBeInstanceOf(Float32Array);
		expect(result.length).toBe(12); // 3 coords * 4 values each
	});
});

describe('packTexelsForGPU', () => {
	it('should pack texels into separate typed arrays', () => {
		const texels: TexelCoord[] = [
			{ x: 100, y: 200, fracX: 0.25, fracY: 0.75 },
			{ x: 300, y: 400, fracX: 0.5, fracY: 0.5 }
		];

		const result = packTexelsForGPU(texels);

		// Positions
		expect(result.positions).toBeInstanceOf(Uint32Array);
		expect(result.positions.length).toBe(4);
		expect(result.positions[0]).toBe(100);
		expect(result.positions[1]).toBe(200);
		expect(result.positions[2]).toBe(300);
		expect(result.positions[3]).toBe(400);

		// Subpixel offsets
		expect(result.subpixelOffsets).toBeInstanceOf(Float32Array);
		expect(result.subpixelOffsets.length).toBe(4);
		expect(result.subpixelOffsets[0]).toBeCloseTo(0.25);
		expect(result.subpixelOffsets[1]).toBeCloseTo(0.75);
		expect(result.subpixelOffsets[2]).toBeCloseTo(0.5);
		expect(result.subpixelOffsets[3]).toBeCloseTo(0.5);
	});
});
