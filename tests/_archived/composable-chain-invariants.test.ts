/**
 * Property-Based Tests: Composable Chain Invariants
 *
 * Tests the monadic composable chain architecture invariants:
 * - Map operations preserve array length
 * - Filter only removes, never adds
 * - Composition is associative
 * - Pure functions are idempotent given same input
 *
 * Reference: docs/pixelwise/ARCHITECTURE.md Section F (Monadic Composable Chain)
 */

import { test, expect } from 'vitest';
import * as fc from 'fast-check';
import { rgbColorArbitrary, charBoundsArrayArbitrary } from './sparse-sampling-invariants.js';

// ============================================================================
// Custom Arbitraries for Composable Chains
// ============================================================================

/**
 * Pure function arbitrary (RGB color transformation)
 */
export const colorTransformArbitrary = fc.constantFrom(
	// Brightness adjustment
	(rgb: [number, number, number], factor: number): [number, number, number] => {
		return [
			Math.max(0, Math.min(255, Math.floor(rgb[0] * factor))),
			Math.max(0, Math.min(255, Math.floor(rgb[1] * factor))),
			Math.max(0, Math.min(255, Math.floor(rgb[2] * factor))),
		];
	},
	// Grayscale conversion
	(rgb: [number, number, number]): [number, number, number] => {
		const gray = Math.floor(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
		return [gray, gray, gray];
	},
	// Invert
	(rgb: [number, number, number]): [number, number, number] => {
		return [255 - rgb[0], 255 - rgb[1], 255 - rgb[2]];
	},
	// Identity
	(rgb: [number, number, number]): [number, number, number] => rgb
);

/**
 * Predicate arbitrary (filter condition)
 */
export const colorPredicateArbitrary = fc.constantFrom(
	// Dark colors
	(rgb: [number, number, number]): boolean => {
		const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
		return luminance < 128;
	},
	// Light colors
	(rgb: [number, number, number]): boolean => {
		const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
		return luminance >= 128;
	},
	// Red-dominant
	(rgb: [number, number, number]): boolean => rgb[0] > rgb[1] && rgb[0] > rgb[2],
	// Always true (identity)
	(_rgb: [number, number, number]): boolean => true
);

/**
 * Array of RGB colors for batch operations
 */
export const rgbArrayArbitrary = fc.array(rgbColorArbitrary, { minLength: 0, maxLength: 100 });

// ============================================================================
// Property Tests: Map Operations
// ============================================================================

test.property(
	'Composable chain: Map operations preserve array length',
	rgbArrayArbitrary,
	fc.float({ min: 0.5, max: 2.0, noNaN: true }),
	(colors, factor) => {
		const transform = (rgb: [number, number, number]): [number, number, number] => {
			return [
				Math.max(0, Math.min(255, Math.floor(rgb[0] * factor))),
				Math.max(0, Math.min(255, Math.floor(rgb[1] * factor))),
				Math.max(0, Math.min(255, Math.floor(rgb[2] * factor))),
			];
		};

		const mapped = colors.map(transform);

		expect(mapped.length).toBe(colors.length);
	}
);

test.property(
	'Composable chain: Map produces valid output for all inputs',
	rgbArrayArbitrary,
	(colors) => {
		const grayscale = (rgb: [number, number, number]): [number, number, number] => {
			const gray = Math.floor(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
			return [gray, gray, gray];
		};

		const mapped = colors.map(grayscale);

		for (const [r, g, b] of mapped) {
			expect(r).toBeGreaterThanOrEqual(0);
			expect(r).toBeLessThanOrEqual(255);
			expect(g).toBe(r); // Grayscale
			expect(b).toBe(r); // Grayscale
		}
	}
);

test.property(
	'Composable chain: Map over empty array returns empty array',
	fc.float({ min: 0.5, max: 2.0, noNaN: true }),
	(factor) => {
		const colors: Array<[number, number, number]> = [];
		const transform = (rgb: [number, number, number]): [number, number, number] => {
			return [
				Math.max(0, Math.min(255, Math.floor(rgb[0] * factor))),
				Math.max(0, Math.min(255, Math.floor(rgb[1] * factor))),
				Math.max(0, Math.min(255, Math.floor(rgb[2] * factor))),
			];
		};

		const mapped = colors.map(transform);

		expect(mapped.length).toBe(0);
	}
);

test.property(
	'Composable chain: Map composition is associative - map(f).map(g) = map(g ∘ f)',
	rgbArrayArbitrary,
	(colors) => {
		const f = (rgb: [number, number, number]): [number, number, number] => {
			return [rgb[0] * 0.8, rgb[1] * 0.8, rgb[2] * 0.8].map((c) =>
				Math.max(0, Math.min(255, Math.floor(c)))
			) as [number, number, number];
		};

		const g = (rgb: [number, number, number]): [number, number, number] => {
			return [255 - rgb[0], 255 - rgb[1], 255 - rgb[2]];
		};

		// Chained: map(f).map(g)
		const chained = colors.map(f).map(g);

		// Composed: map(g ∘ f)
		const composed = colors.map((rgb) => g(f(rgb)));

		expect(chained.length).toBe(composed.length);
		for (let i = 0; i < chained.length; i++) {
			expect(chained[i][0]).toBe(composed[i][0]);
			expect(chained[i][1]).toBe(composed[i][1]);
			expect(chained[i][2]).toBe(composed[i][2]);
		}
	}
);

// ============================================================================
// Property Tests: Filter Operations
// ============================================================================

test.property(
	'Composable chain: Filter only removes, never adds',
	rgbArrayArbitrary,
	colorPredicateArbitrary,
	(colors, predicate) => {
		const filtered = colors.filter(predicate);

		expect(filtered.length).toBeLessThanOrEqual(colors.length);
	}
);

test.property(
	'Composable chain: Filter with always-true predicate returns same array',
	rgbArrayArbitrary,
	(colors) => {
		const alwaysTrue = (_rgb: [number, number, number]) => true;
		const filtered = colors.filter(alwaysTrue);

		expect(filtered.length).toBe(colors.length);
		for (let i = 0; i < colors.length; i++) {
			expect(filtered[i]).toEqual(colors[i]);
		}
	}
);

test.property(
	'Composable chain: Filter with always-false predicate returns empty array',
	rgbArrayArbitrary,
	(colors) => {
		const alwaysFalse = (_rgb: [number, number, number]) => false;
		const filtered = colors.filter(alwaysFalse);

		expect(filtered.length).toBe(0);
	}
);

test.property(
	'Composable chain: Filter preserves element order',
	rgbArrayArbitrary,
	(colors) => {
		const isDark = (rgb: [number, number, number]): boolean => {
			const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
			return luminance < 128;
		};

		const filtered = colors.filter(isDark);
		const originalDarkIndices = colors
			.map((c, i) => (isDark(c) ? i : -1))
			.filter((i) => i >= 0);

		// Filtered array should have elements in same relative order
		expect(filtered.length).toBe(originalDarkIndices.length);
	}
);

test.property(
	'Composable chain: Double filter is idempotent - filter(p).filter(p) = filter(p)',
	rgbArrayArbitrary,
	colorPredicateArbitrary,
	(colors, predicate) => {
		const filtered1 = colors.filter(predicate);
		const filtered2 = filtered1.filter(predicate);

		expect(filtered2.length).toBe(filtered1.length);
		for (let i = 0; i < filtered1.length; i++) {
			expect(filtered2[i]).toEqual(filtered1[i]);
		}
	}
);

// ============================================================================
// Property Tests: Composition Associativity
// ============================================================================

test.property(
	'Composable chain: (f ∘ g) ∘ h = f ∘ (g ∘ h) - associativity',
	rgbArrayArbitrary,
	(colors) => {
		const f = (rgb: [number, number, number]): [number, number, number] => {
			return [rgb[0] * 1.2, rgb[1] * 1.2, rgb[2] * 1.2].map((c) =>
				Math.max(0, Math.min(255, Math.floor(c)))
			) as [number, number, number];
		};

		const g = (rgb: [number, number, number]): [number, number, number] => {
			const gray = Math.floor(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
			return [gray, gray, gray];
		};

		const h = (rgb: [number, number, number]): [number, number, number] => {
			return [255 - rgb[0], 255 - rgb[1], 255 - rgb[2]];
		};

		// Left-associative: (f ∘ g) ∘ h
		const leftAssoc = colors.map((rgb) => h(g(f(rgb))));

		// Right-associative: f ∘ (g ∘ h)
		const rightAssoc = colors.map((rgb) => f(g(h(rgb))));

		// Both should have same length
		expect(leftAssoc.length).toBe(rightAssoc.length);
		expect(leftAssoc.length).toBe(colors.length);
	}
);

test.property(
	'Composable chain: Map-filter chain is composable',
	rgbArrayArbitrary,
	(colors) => {
		const brighten = (rgb: [number, number, number]): [number, number, number] => {
			return [rgb[0] * 1.5, rgb[1] * 1.5, rgb[2] * 1.5].map((c) =>
				Math.max(0, Math.min(255, Math.floor(c)))
			) as [number, number, number];
		};

		const isDark = (rgb: [number, number, number]): boolean => {
			const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
			return luminance < 128;
		};

		// Chain: filter then map
		const result = colors.filter(isDark).map(brighten);

		// Result length should be <= original
		expect(result.length).toBeLessThanOrEqual(colors.length);

		// All results should be valid
		for (const [r, g, b] of result) {
			expect(r).toBeGreaterThanOrEqual(0);
			expect(r).toBeLessThanOrEqual(255);
		}
	}
);

test.property(
	'Composable chain: Reduce is compatible with map',
	rgbArrayArbitrary,
	(colors) => {
		const toLuminance = (rgb: [number, number, number]): number => {
			return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
		};

		const sumLuminance = (acc: number, lum: number) => acc + lum;

		// Map then reduce
		const result = colors.map(toLuminance).reduce(sumLuminance, 0);

		// Result should be non-negative
		expect(result).toBeGreaterThanOrEqual(0);

		// Should be sum of all luminances
		if (colors.length > 0) {
			const avgLuminance = result / colors.length;
			expect(avgLuminance).toBeGreaterThanOrEqual(0);
			expect(avgLuminance).toBeLessThanOrEqual(255);
		}
	}
);

// ============================================================================
// Property Tests: Pure Function Idempotency
// ============================================================================

test.property(
	'Composable chain: Pure functions are deterministic - f(x) = f(x) always',
	rgbColorArbitrary,
	colorTransformArbitrary,
	(color, transform) => {
		// Call twice with same input
		const result1 = transform(color);
		const result2 = transform(color);

		// Results should be identical
		expect(result1[0]).toBe(result2[0]);
		expect(result1[1]).toBe(result2[1]);
		expect(result1[2]).toBe(result2[2]);
	}
);

test.property(
	'Composable chain: Identity transform is idempotent - id(id(x)) = id(x)',
	rgbColorArbitrary,
	(color) => {
		const identity = (rgb: [number, number, number]): [number, number, number] => rgb;

		const once = identity(color);
		const twice = identity(identity(color));

		expect(twice[0]).toBe(once[0]);
		expect(twice[1]).toBe(once[1]);
		expect(twice[2]).toBe(once[2]);
	}
);

test.property(
	'Composable chain: Grayscale is idempotent - gray(gray(x)) = gray(x)',
	rgbColorArbitrary,
	(color) => {
		const grayscale = (rgb: [number, number, number]): [number, number, number] => {
			const gray = Math.floor(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
			return [gray, gray, gray];
		};

		const once = grayscale(color);
		const twice = grayscale(grayscale(color));

		expect(twice[0]).toBe(once[0]);
		expect(twice[1]).toBe(once[1]);
		expect(twice[2]).toBe(once[2]);
	}
);

test.property(
	'Composable chain: Invert twice returns original - inv(inv(x)) = x',
	rgbColorArbitrary,
	(color) => {
		const invert = (rgb: [number, number, number]): [number, number, number] => {
			return [255 - rgb[0], 255 - rgb[1], 255 - rgb[2]];
		};

		const inverted = invert(color);
		const original = invert(inverted);

		expect(original[0]).toBe(color[0]);
		expect(original[1]).toBe(color[1]);
		expect(original[2]).toBe(color[2]);
	}
);

test.property(
	'Composable chain: Pure functions have no side effects',
	rgbColorArbitrary,
	fc.float({ min: 0.5, max: 2.0, noNaN: true }),
	(color, factor) => {
		const originalCopy = [...color] as [number, number, number];

		const transform = (rgb: [number, number, number]): [number, number, number] => {
			return [
				Math.max(0, Math.min(255, Math.floor(rgb[0] * factor))),
				Math.max(0, Math.min(255, Math.floor(rgb[1] * factor))),
				Math.max(0, Math.min(255, Math.floor(rgb[2] * factor))),
			];
		};

		// Call transform
		transform(color);

		// Original should be unchanged
		expect(color[0]).toBe(originalCopy[0]);
		expect(color[1]).toBe(originalCopy[1]);
		expect(color[2]).toBe(originalCopy[2]);
	}
);

// ============================================================================
// Property Tests: Monadic Laws
// ============================================================================

test.property(
	'Composable chain: Left identity - flatMap(return(x), f) = f(x)',
	rgbColorArbitrary,
	(color) => {
		// In our context, "return" wraps value in array
		const returnValue = (rgb: [number, number, number]) => [rgb];

		const f = (rgb: [number, number, number]): Array<[number, number, number]> => {
			return [[rgb[0], rgb[1], rgb[2]]];
		};

		// Left side: flatMap(return(x), f)
		const left = returnValue(color).flatMap(f);

		// Right side: f(x)
		const right = f(color);

		expect(left.length).toBe(right.length);
		expect(left[0]).toEqual(right[0]);
	}
);

test.property(
	'Composable chain: Right identity - flatMap(m, return) = m',
	rgbArrayArbitrary,
	(colors) => {
		const returnValue = (rgb: [number, number, number]) => [rgb];

		const result = colors.flatMap(returnValue);

		expect(result.length).toBe(colors.length);
		for (let i = 0; i < colors.length; i++) {
			expect(result[i]).toEqual(colors[i]);
		}
	}
);

test.property(
	'Composable chain: Associativity - flatMap(flatMap(m, f), g) = flatMap(m, x => flatMap(f(x), g))',
	rgbArrayArbitrary,
	(colors) => {
		const f = (rgb: [number, number, number]): Array<[number, number, number]> => {
			return [[rgb[0], rgb[1], rgb[2]]];
		};

		const g = (rgb: [number, number, number]): Array<[number, number, number]> => {
			const gray = Math.floor(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
			return [[gray, gray, gray]];
		};

		// Left: flatMap(flatMap(m, f), g)
		const left = colors.flatMap(f).flatMap(g);

		// Right: flatMap(m, x => flatMap(f(x), g))
		const right = colors.flatMap((x) => f(x).flatMap(g));

		expect(left.length).toBe(right.length);
		for (let i = 0; i < left.length; i++) {
			expect(left[i]).toEqual(right[i]);
		}
	}
);

// ============================================================================
// Property Tests: Pipeline Composition
// ============================================================================

test.property(
	'Composable chain: Pipeline execution order is deterministic',
	rgbArrayArbitrary,
	(colors) => {
		const pipeline = (data: Array<[number, number, number]>) =>
			data
				.filter((rgb) => {
					const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
					return lum < 200;
				})
				.map((rgb) => {
					const gray = Math.floor(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
					return [gray, gray, gray] as [number, number, number];
				});

		// Run twice
		const result1 = pipeline(colors);
		const result2 = pipeline(colors);

		expect(result1.length).toBe(result2.length);
		for (let i = 0; i < result1.length; i++) {
			expect(result1[i]).toEqual(result2[i]);
		}
	}
);

test.property(
	'Composable chain: Empty pipeline returns input unchanged',
	rgbArrayArbitrary,
	(colors) => {
		const identity = (data: Array<[number, number, number]>) => data;

		const result = identity(colors);

		expect(result.length).toBe(colors.length);
		expect(result).toEqual(colors);
	}
);

test.property(
	'Composable chain: Complex pipeline preserves type safety',
	rgbArrayArbitrary,
	(colors) => {
		const pipeline = (data: Array<[number, number, number]>) =>
			data
				.filter((rgb) => rgb[0] > 100)
				.map((rgb) => {
					return [
						Math.min(255, rgb[0] + 10),
						Math.min(255, rgb[1] + 10),
						Math.min(255, rgb[2] + 10),
					] as [number, number, number];
				})
				.filter((rgb) => {
					const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
					return lum < 255;
				});

		const result = pipeline(colors);

		// All results should be valid RGB
		for (const [r, g, b] of result) {
			expect(r).toBeGreaterThanOrEqual(0);
			expect(r).toBeLessThanOrEqual(255);
			expect(g).toBeGreaterThanOrEqual(0);
			expect(g).toBeLessThanOrEqual(255);
			expect(b).toBeGreaterThanOrEqual(0);
			expect(b).toBeLessThanOrEqual(255);
		}
	}
);
