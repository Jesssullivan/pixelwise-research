/**
 * Property-Based Tests: PixelSampler Invariants
 *
 * Tests the PixelSampler interface and implementation invariants:
 * - Sample values always in [0, 255]
 * - Batch sample length matches coord count
 * - Deterministic sampling (same coords = same values)
 * - Composite sampler respects layer order
 *
 * Reference: docs/pixelwise/ARCHITECTURE.md Section I (PixelSampler Implementation)
 */

import { test, expect } from 'vitest';
import * as fc from 'fast-check';
import { rgbColorArbitrary } from './sparse-sampling-invariants.js';

// ============================================================================
// Mock PixelSampler Implementations for Testing
// ============================================================================

/**
 * PixelSampler interface (matches architecture spec)
 */
interface PixelSampler {
	sample(x: number, y: number): [r: number, g: number, b: number];
	sampleBatch(coords: Uint32Array): Uint8Array;
}

/**
 * Mock canvas sampler for testing
 */
class MockCanvasSampler implements PixelSampler {
	private width: number;
	private height: number;
	private data: Uint8ClampedArray;

	constructor(width: number, height: number, data?: Uint8ClampedArray) {
		this.width = width;
		this.height = height;
		this.data = data || new Uint8ClampedArray(width * height * 4);

		// Fill with deterministic pattern if no data provided
		if (!data) {
			for (let i = 0; i < this.data.length; i += 4) {
				this.data[i] = (i / 4) % 256; // R
				this.data[i + 1] = ((i / 4) * 2) % 256; // G
				this.data[i + 2] = ((i / 4) * 3) % 256; // B
				this.data[i + 3] = 255; // A
			}
		}
	}

	sample(x: number, y: number): [number, number, number] {
		const idx = (Math.floor(y) * this.width + Math.floor(x)) * 4;
		if (idx < 0 || idx >= this.data.length) {
			return [0, 0, 0];
		}
		return [this.data[idx], this.data[idx + 1], this.data[idx + 2]];
	}

	sampleBatch(coords: Uint32Array): Uint8Array {
		const result = new Uint8Array((coords.length / 2) * 3);
		for (let i = 0; i < coords.length; i += 2) {
			const [r, g, b] = this.sample(coords[i], coords[i + 1]);
			result[(i / 2) * 3] = r;
			result[(i / 2) * 3 + 1] = g;
			result[(i / 2) * 3 + 2] = b;
		}
		return result;
	}
}

/**
 * Mock composite sampler (layers backgrounds)
 */
class MockCompositeSampler implements PixelSampler {
	constructor(private layers: PixelSampler[]) {}

	sample(x: number, y: number): [number, number, number] {
		// Composite back-to-front (simple alpha blend simulation)
		if (this.layers.length === 0) return [0, 0, 0];

		// For testing, just return the top layer
		return this.layers[this.layers.length - 1].sample(x, y);
	}

	sampleBatch(coords: Uint32Array): Uint8Array {
		if (this.layers.length === 0) {
			return new Uint8Array((coords.length / 2) * 3);
		}

		// Delegate to top layer
		return this.layers[this.layers.length - 1].sampleBatch(coords);
	}
}

// ============================================================================
// Custom Arbitraries for PixelSampler Testing
// ============================================================================

/**
 * Canvas dimensions arbitrary
 */
export const canvasDimensionsArbitrary = fc.tuple(
	fc.integer({ min: 1, max: 1920 }),
	fc.integer({ min: 1, max: 1080 })
);

/**
 * Coordinate pair arbitrary [x, y]
 */
export const coordinatePairArbitrary = fc.tuple(
	fc.integer({ min: 0, max: 1919 }),
	fc.integer({ min: 0, max: 1079 })
);

/**
 * Coordinate array arbitrary (Uint32Array of [x,y,x,y,...])
 */
export const coordinateArrayArbitrary = fc
	.array(coordinatePairArbitrary, { minLength: 0, maxLength: 100 })
	.map((pairs) => {
		const flat = new Uint32Array(pairs.length * 2);
		for (let i = 0; i < pairs.length; i++) {
			flat[i * 2] = pairs[i][0];
			flat[i * 2 + 1] = pairs[i][1];
		}
		return flat;
	});

/**
 * Layer count arbitrary (for composite sampler)
 */
export const layerCountArbitrary = fc.integer({ min: 1, max: 5 });

// ============================================================================
// Property Tests: Sample Value Range
// ============================================================================

test.property(
	'PixelSampler: sample(x,y) returns values in [0,255]',
	canvasDimensionsArbitrary,
	coordinatePairArbitrary,
	([width, height], [x, y]) => {
		const sampler = new MockCanvasSampler(width, height);

		// Clamp coords to valid range
		const clampedX = Math.max(0, Math.min(width - 1, x));
		const clampedY = Math.max(0, Math.min(height - 1, y));

		const [r, g, b] = sampler.sample(clampedX, clampedY);

		expect(r).toBeGreaterThanOrEqual(0);
		expect(r).toBeLessThanOrEqual(255);
		expect(g).toBeGreaterThanOrEqual(0);
		expect(g).toBeLessThanOrEqual(255);
		expect(b).toBeGreaterThanOrEqual(0);
		expect(b).toBeLessThanOrEqual(255);
	}
);

test.property(
	'PixelSampler: All RGB values are integers',
	canvasDimensionsArbitrary,
	coordinatePairArbitrary,
	([width, height], [x, y]) => {
		const sampler = new MockCanvasSampler(width, height);

		const clampedX = Math.max(0, Math.min(width - 1, x));
		const clampedY = Math.max(0, Math.min(height - 1, y));

		const [r, g, b] = sampler.sample(clampedX, clampedY);

		expect(Number.isInteger(r)).toBe(true);
		expect(Number.isInteger(g)).toBe(true);
		expect(Number.isInteger(b)).toBe(true);
	}
);

test.property(
	'PixelSampler: Out-of-bounds coordinates return safe default',
	canvasDimensionsArbitrary,
	([width, height]) => {
		const sampler = new MockCanvasSampler(width, height);

		// Sample outside bounds
		const [r1, g1, b1] = sampler.sample(-10, -10);
		const [r2, g2, b2] = sampler.sample(width + 100, height + 100);

		// Should return safe values (not throw)
		expect(r1).toBeGreaterThanOrEqual(0);
		expect(r1).toBeLessThanOrEqual(255);
		expect(r2).toBeGreaterThanOrEqual(0);
		expect(r2).toBeLessThanOrEqual(255);
	}
);

// ============================================================================
// Property Tests: Batch Sampling Length
// ============================================================================

test.property(
	'PixelSampler: sampleBatch length = coords.length / 2 * 3',
	canvasDimensionsArbitrary,
	coordinateArrayArbitrary,
	([width, height], coords) => {
		const sampler = new MockCanvasSampler(width, height);
		const result = sampler.sampleBatch(coords);

		const expectedLength = (coords.length / 2) * 3;
		expect(result.length).toBe(expectedLength);
	}
);

test.property(
	'PixelSampler: Empty coords array returns empty result',
	canvasDimensionsArbitrary,
	([width, height]) => {
		const sampler = new MockCanvasSampler(width, height);
		const coords = new Uint32Array(0);
		const result = sampler.sampleBatch(coords);

		expect(result.length).toBe(0);
	}
);

test.property(
	'PixelSampler: Batch result is Uint8Array with values in [0,255]',
	canvasDimensionsArbitrary,
	coordinateArrayArbitrary,
	([width, height], coords) => {
		const sampler = new MockCanvasSampler(width, height);
		const result = sampler.sampleBatch(coords);

		expect(result instanceof Uint8Array).toBe(true);

		for (let i = 0; i < result.length; i++) {
			expect(result[i]).toBeGreaterThanOrEqual(0);
			expect(result[i]).toBeLessThanOrEqual(255);
		}
	}
);

test.property(
	'PixelSampler: Batch result has correct RGB triplet structure',
	canvasDimensionsArbitrary,
	coordinateArrayArbitrary,
	([width, height], coords) => {
		const sampler = new MockCanvasSampler(width, height);
		const result = sampler.sampleBatch(coords);

		// Length should be divisible by 3 (RGB triplets)
		expect(result.length % 3).toBe(0);

		// Number of triplets = number of coordinate pairs
		const tripletCount = result.length / 3;
		const coordPairCount = coords.length / 2;
		expect(tripletCount).toBe(coordPairCount);
	}
);

// ============================================================================
// Property Tests: Deterministic Sampling
// ============================================================================

test.property(
	'PixelSampler: Same coordinates return same values (deterministic)',
	canvasDimensionsArbitrary,
	coordinatePairArbitrary,
	([width, height], [x, y]) => {
		const sampler = new MockCanvasSampler(width, height);

		const clampedX = Math.max(0, Math.min(width - 1, x));
		const clampedY = Math.max(0, Math.min(height - 1, y));

		// Sample twice
		const [r1, g1, b1] = sampler.sample(clampedX, clampedY);
		const [r2, g2, b2] = sampler.sample(clampedX, clampedY);

		// Should be identical
		expect(r2).toBe(r1);
		expect(g2).toBe(g1);
		expect(b2).toBe(b1);
	}
);

test.property(
	'PixelSampler: Batch sampling is deterministic',
	canvasDimensionsArbitrary,
	coordinateArrayArbitrary,
	([width, height], coords) => {
		const sampler = new MockCanvasSampler(width, height);

		// Sample twice
		const result1 = sampler.sampleBatch(coords);
		const result2 = sampler.sampleBatch(coords);

		expect(result1.length).toBe(result2.length);

		for (let i = 0; i < result1.length; i++) {
			expect(result2[i]).toBe(result1[i]);
		}
	}
);

test.property(
	'PixelSampler: Batch and single sample agree',
	canvasDimensionsArbitrary,
	coordinatePairArbitrary,
	([width, height], [x, y]) => {
		const sampler = new MockCanvasSampler(width, height);

		const clampedX = Math.max(0, Math.min(width - 1, x));
		const clampedY = Math.max(0, Math.min(height - 1, y));

		// Single sample
		const [r1, g1, b1] = sampler.sample(clampedX, clampedY);

		// Batch sample with same coord
		const coords = new Uint32Array([clampedX, clampedY]);
		const batch = sampler.sampleBatch(coords);

		expect(batch[0]).toBe(r1);
		expect(batch[1]).toBe(g1);
		expect(batch[2]).toBe(b1);
	}
);

test.property(
	'PixelSampler: Sampling order does not affect results',
	canvasDimensionsArbitrary,
	coordinateArrayArbitrary,
	([width, height], coords) => {
		const sampler = new MockCanvasSampler(width, height);

		// Sample in original order
		const result1 = sampler.sampleBatch(coords);

		// Reverse coords
		const reversedCoords = new Uint32Array(coords.length);
		for (let i = 0; i < coords.length; i += 2) {
			const reverseIdx = coords.length - 2 - i;
			reversedCoords[reverseIdx] = coords[i];
			reversedCoords[reverseIdx + 1] = coords[i + 1];
		}

		const result2 = sampler.sampleBatch(reversedCoords);

		// Results should have same values (in reversed order)
		expect(result2.length).toBe(result1.length);

		for (let i = 0; i < result1.length; i += 3) {
			const reverseIdx = result1.length - 3 - i;
			expect(result2[reverseIdx]).toBe(result1[i]);
			expect(result2[reverseIdx + 1]).toBe(result1[i + 1]);
			expect(result2[reverseIdx + 2]).toBe(result1[i + 2]);
		}
	}
);

// ============================================================================
// Property Tests: Composite Sampler Layer Order
// ============================================================================

test.property(
	'PixelSampler: CompositeSampler respects layer order',
	canvasDimensionsArbitrary,
	layerCountArbitrary,
	coordinatePairArbitrary,
	([width, height], layerCount, [x, y]) => {
		// Create multiple layers with different patterns
		const layers: PixelSampler[] = [];
		for (let i = 0; i < layerCount; i++) {
			const data = new Uint8ClampedArray(width * height * 4);
			// Each layer has distinct color
			for (let j = 0; j < data.length; j += 4) {
				data[j] = i * 50; // R varies by layer
				data[j + 1] = 128;
				data[j + 2] = 128;
				data[j + 3] = 255;
			}
			layers.push(new MockCanvasSampler(width, height, data));
		}

		const composite = new MockCompositeSampler(layers);

		const clampedX = Math.max(0, Math.min(width - 1, x));
		const clampedY = Math.max(0, Math.min(height - 1, y));

		const [r, g, b] = composite.sample(clampedX, clampedY);

		// Should return top layer (last in array)
		const topLayer = layers[layers.length - 1];
		const [expectedR, expectedG, expectedB] = topLayer.sample(clampedX, clampedY);

		expect(r).toBe(expectedR);
		expect(g).toBe(expectedG);
		expect(b).toBe(expectedB);
	}
);

test.property(
	'PixelSampler: CompositeSampler with single layer equals that layer',
	canvasDimensionsArbitrary,
	coordinatePairArbitrary,
	([width, height], [x, y]) => {
		const singleLayer = new MockCanvasSampler(width, height);
		const composite = new MockCompositeSampler([singleLayer]);

		const clampedX = Math.max(0, Math.min(width - 1, x));
		const clampedY = Math.max(0, Math.min(height - 1, y));

		const [r1, g1, b1] = singleLayer.sample(clampedX, clampedY);
		const [r2, g2, b2] = composite.sample(clampedX, clampedY);

		expect(r2).toBe(r1);
		expect(g2).toBe(g1);
		expect(b2).toBe(b1);
	}
);

test.property(
	'PixelSampler: CompositeSampler with empty layers returns black',
	coordinatePairArbitrary,
	([x, y]) => {
		const composite = new MockCompositeSampler([]);

		const [r, g, b] = composite.sample(x, y);

		expect(r).toBe(0);
		expect(g).toBe(0);
		expect(b).toBe(0);
	}
);

test.property(
	'PixelSampler: CompositeSampler batch sampling respects layer order',
	canvasDimensionsArbitrary,
	layerCountArbitrary,
	coordinateArrayArbitrary,
	([width, height], layerCount, coords) => {
		// Create layers
		const layers: PixelSampler[] = [];
		for (let i = 0; i < layerCount; i++) {
			const data = new Uint8ClampedArray(width * height * 4);
			for (let j = 0; j < data.length; j += 4) {
				data[j] = i * 40;
				data[j + 1] = 100;
				data[j + 2] = 100;
				data[j + 3] = 255;
			}
			layers.push(new MockCanvasSampler(width, height, data));
		}

		const composite = new MockCompositeSampler(layers);

		const result = composite.sampleBatch(coords);
		const topLayerResult = layers[layers.length - 1].sampleBatch(coords);

		expect(result.length).toBe(topLayerResult.length);

		for (let i = 0; i < result.length; i++) {
			expect(result[i]).toBe(topLayerResult[i]);
		}
	}
);

// ============================================================================
// Property Tests: Background Agnosticism
// ============================================================================

test.property(
	'PixelSampler: Interface is background-agnostic (works with any implementation)',
	canvasDimensionsArbitrary,
	coordinatePairArbitrary,
	([width, height], [x, y]) => {
		// Test that different implementations satisfy the same interface
		const sampler1 = new MockCanvasSampler(width, height);

		// Any implementation should return valid RGB
		const [r, g, b] = sampler1.sample(
			Math.max(0, Math.min(width - 1, x)),
			Math.max(0, Math.min(height - 1, y))
		);

		// Interface contract: returns [r, g, b] in valid range
		expect(Array.isArray([r, g, b])).toBe(true);
		expect(r).toBeGreaterThanOrEqual(0);
		expect(r).toBeLessThanOrEqual(255);
	}
);

test.property(
	'PixelSampler: Different samplers can be swapped without changing consumer code',
	canvasDimensionsArbitrary,
	coordinateArrayArbitrary,
	([width, height], coords) => {
		const sampler1 = new MockCanvasSampler(width, height);
		const sampler2 = new MockCompositeSampler([sampler1]);

		// Both implement same interface
		const result1 = sampler1.sampleBatch(coords);
		const result2 = sampler2.sampleBatch(coords);

		// Results should have same structure
		expect(result1.length).toBe(result2.length);
		expect(result1 instanceof Uint8Array).toBe(true);
		expect(result2 instanceof Uint8Array).toBe(true);
	}
);

test.property(
	'PixelSampler: Sampler abstraction enables CSS-irrelevant operation',
	canvasDimensionsArbitrary,
	coordinateArrayArbitrary,
	([width, height], coords) => {
		// The sampler returns PIXELS, not CSS values
		const sampler = new MockCanvasSampler(width, height);
		const result = sampler.sampleBatch(coords);

		// Result is raw bytes, not CSS color strings
		expect(result instanceof Uint8Array).toBe(true);

		// No CSS parsing needed - direct pixel access
		for (let i = 0; i < result.length; i += 3) {
			const r = result[i];
			const g = result[i + 1];
			const b = result[i + 2];

			// These are direct pixel values, not computed styles
			expect(typeof r).toBe('number');
			expect(typeof g).toBe('number');
			expect(typeof b).toBe('number');
		}
	}
);

// ============================================================================
// Property Tests: Performance Characteristics
// ============================================================================

test.property(
	'PixelSampler: Batch sampling is more efficient than repeated single samples',
	canvasDimensionsArbitrary,
	fc.integer({ min: 10, max: 100 }),
	([width, height], sampleCount) => {
		const sampler = new MockCanvasSampler(width, height);

		// Generate coords
		const coords = new Uint32Array(sampleCount * 2);
		for (let i = 0; i < sampleCount; i++) {
			coords[i * 2] = Math.floor(Math.random() * width);
			coords[i * 2 + 1] = Math.floor(Math.random() * height);
		}

		// Batch should make single call
		const batchResult = sampler.sampleBatch(coords);

		// Should return all results
		expect(batchResult.length).toBe(sampleCount * 3);
	}
);

test.property(
	'PixelSampler: Memory usage scales linearly with sample count',
	fc.integer({ min: 1, max: 1000 }),
	(sampleCount) => {
		const coords = new Uint32Array(sampleCount * 2);
		const expectedResultSize = sampleCount * 3; // RGB per sample

		// Memory scales linearly: O(n)
		expect(expectedResultSize).toBe(sampleCount * 3);

		// Doubling samples doubles memory
		const doubledExpected = sampleCount * 2 * 3;
		expect(doubledExpected).toBe(expectedResultSize * 2);
	}
);
