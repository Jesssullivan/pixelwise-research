/**
 * Unit tests for CSSCustomPropertyApplier
 *
 * Tests the runes-friendly CSS custom property-based color correction system
 * that replaces CSSColorCorrector. This approach avoids WeakMap iteration issues
 * and is fully compatible with Svelte 5 runes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CSSCustomPropertyApplier } from '$lib/pixelwise/CSSCustomPropertyApplier';

/**
 * Create a mock HTML element for testing
 */
function createMockElement(): HTMLElement {
	const el = document.createElement('div');
	document.body.appendChild(el); // Needed for proper DOM behavior
	return el;
}

/**
 * Cleanup helper to remove elements from DOM
 */
function cleanupElement(el: HTMLElement): void {
	if (el.parentNode) {
		el.parentNode.removeChild(el);
	}
}

describe('CSSCustomPropertyApplier', () => {
	let applier: CSSCustomPropertyApplier;
	const elements: HTMLElement[] = [];

	beforeEach(() => {
		applier = new CSSCustomPropertyApplier();
	});

	afterEach(() => {
		// Clean up all created elements
		elements.forEach(cleanupElement);
		elements.length = 0;
	});

	/**
	 * Helper to create and track an element for automatic cleanup
	 */
	function createElement(): HTMLElement {
		const el = createMockElement();
		elements.push(el);
		return el;
	}

	describe('Constructor', () => {
		it('should initialize with zero corrected elements', () => {
			expect(applier).toBeDefined();
			expect(applier.correctedCount).toBe(0);
		});
	});

	describe('apply()', () => {
		it('should set the correct CSS custom property value', () => {
			const el = createElement();
			const rgb: [number, number, number] = [255, 128, 64];

			applier.apply(el, rgb);

			const propertyValue = el.style.getPropertyValue('--pixelwise-adjusted-color');
			expect(propertyValue).toBe('rgb(255, 128, 64)');
		});

		it('should set the data-pixelwise-corrected attribute', () => {
			const el = createElement();
			const rgb: [number, number, number] = [100, 200, 50];

			applier.apply(el, rgb);

			expect(el.hasAttribute('data-pixelwise-corrected')).toBe(true);
			expect(el.getAttribute('data-pixelwise-corrected')).toBe('true');
		});

		it('should track element in internal Set', () => {
			const el = createElement();
			const rgb: [number, number, number] = [0, 0, 0];

			expect(applier.correctedCount).toBe(0);

			applier.apply(el, rgb);

			expect(applier.correctedCount).toBe(1);
		});

		it('should handle multiple elements independently', () => {
			const el1 = createElement();
			const el2 = createElement();
			const el3 = createElement();

			applier.apply(el1, [255, 0, 0]);
			applier.apply(el2, [0, 255, 0]);
			applier.apply(el3, [0, 0, 255]);

			expect(el1.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('rgb(255, 0, 0)');
			expect(el2.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('rgb(0, 255, 0)');
			expect(el3.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('rgb(0, 0, 255)');
			expect(applier.correctedCount).toBe(3);
		});

		it('should handle edge case RGB values (0, 0, 0)', () => {
			const el = createElement();
			applier.apply(el, [0, 0, 0]);

			expect(el.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('rgb(0, 0, 0)');
		});

		it('should handle edge case RGB values (255, 255, 255)', () => {
			const el = createElement();
			applier.apply(el, [255, 255, 255]);

			expect(el.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('rgb(255, 255, 255)');
		});

		it('should handle fractional RGB values by preserving them', () => {
			const el = createElement();
			// TypeScript allows this at runtime even though type is number
			applier.apply(el, [128.5, 64.7, 200.3]);

			expect(el.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('rgb(128.5, 64.7, 200.3)');
		});
	});

	describe('apply() - multiple applications to same element', () => {
		it('should not duplicate tracking when applying to same element multiple times', () => {
			const el = createElement();

			applier.apply(el, [100, 100, 100]);
			expect(applier.correctedCount).toBe(1);

			applier.apply(el, [200, 200, 200]);
			expect(applier.correctedCount).toBe(1); // Still 1, not 2

			applier.apply(el, [50, 50, 50]);
			expect(applier.correctedCount).toBe(1); // Still 1, not 3
		});

		it('should update CSS property value on subsequent applies', () => {
			const el = createElement();

			applier.apply(el, [100, 100, 100]);
			expect(el.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('rgb(100, 100, 100)');

			applier.apply(el, [200, 200, 200]);
			expect(el.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('rgb(200, 200, 200)');
		});

		it('should maintain data attribute on subsequent applies', () => {
			const el = createElement();

			applier.apply(el, [100, 100, 100]);
			expect(el.getAttribute('data-pixelwise-corrected')).toBe('true');

			applier.apply(el, [200, 200, 200]);
			expect(el.getAttribute('data-pixelwise-corrected')).toBe('true');
		});
	});

	describe('clear()', () => {
		it('should remove the CSS custom property', () => {
			const el = createElement();
			applier.apply(el, [255, 128, 64]);

			expect(el.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('rgb(255, 128, 64)');

			applier.clear(el);

			expect(el.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('');
		});

		it('should remove the data-pixelwise-corrected attribute', () => {
			const el = createElement();
			applier.apply(el, [100, 200, 50]);

			expect(el.hasAttribute('data-pixelwise-corrected')).toBe(true);

			applier.clear(el);

			expect(el.hasAttribute('data-pixelwise-corrected')).toBe(false);
		});

		it('should remove element from tracking Set', () => {
			const el = createElement();
			applier.apply(el, [0, 0, 0]);

			expect(applier.correctedCount).toBe(1);

			applier.clear(el);

			expect(applier.correctedCount).toBe(0);
		});

		it('should handle clearing an element that was never applied', () => {
			const el = createElement();

			expect(() => {
				applier.clear(el);
			}).not.toThrow();

			expect(applier.correctedCount).toBe(0);
		});

		it('should handle clearing an element multiple times', () => {
			const el = createElement();
			applier.apply(el, [100, 100, 100]);

			applier.clear(el);
			expect(applier.correctedCount).toBe(0);

			// Should not throw or cause issues
			applier.clear(el);
			expect(applier.correctedCount).toBe(0);
		});

		it('should only clear the specified element', () => {
			const el1 = createElement();
			const el2 = createElement();
			const el3 = createElement();

			applier.apply(el1, [255, 0, 0]);
			applier.apply(el2, [0, 255, 0]);
			applier.apply(el3, [0, 0, 255]);

			expect(applier.correctedCount).toBe(3);

			applier.clear(el2);

			expect(applier.correctedCount).toBe(2);
			expect(el1.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('rgb(255, 0, 0)');
			expect(el2.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('');
			expect(el3.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('rgb(0, 0, 255)');
		});
	});

	describe('clearAll()', () => {
		it('should clear all tracked elements', () => {
			const el1 = createElement();
			const el2 = createElement();
			const el3 = createElement();

			applier.apply(el1, [255, 0, 0]);
			applier.apply(el2, [0, 255, 0]);
			applier.apply(el3, [0, 0, 255]);

			expect(applier.correctedCount).toBe(3);

			applier.clearAll();

			expect(applier.correctedCount).toBe(0);
		});

		it('should remove CSS custom properties from all elements', () => {
			const el1 = createElement();
			const el2 = createElement();
			const el3 = createElement();

			applier.apply(el1, [255, 0, 0]);
			applier.apply(el2, [0, 255, 0]);
			applier.apply(el3, [0, 0, 255]);

			applier.clearAll();

			expect(el1.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('');
			expect(el2.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('');
			expect(el3.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('');
		});

		it('should remove data attributes from all elements', () => {
			const el1 = createElement();
			const el2 = createElement();
			const el3 = createElement();

			applier.apply(el1, [255, 0, 0]);
			applier.apply(el2, [0, 255, 0]);
			applier.apply(el3, [0, 0, 255]);

			applier.clearAll();

			expect(el1.hasAttribute('data-pixelwise-corrected')).toBe(false);
			expect(el2.hasAttribute('data-pixelwise-corrected')).toBe(false);
			expect(el3.hasAttribute('data-pixelwise-corrected')).toBe(false);
		});

		it('should handle empty state gracefully', () => {
			expect(applier.correctedCount).toBe(0);

			expect(() => {
				applier.clearAll();
			}).not.toThrow();

			expect(applier.correctedCount).toBe(0);
		});

		it('should handle single element', () => {
			const el = createElement();
			applier.apply(el, [100, 100, 100]);

			applier.clearAll();

			expect(applier.correctedCount).toBe(0);
			expect(el.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('');
			expect(el.hasAttribute('data-pixelwise-corrected')).toBe(false);
		});

		it('should handle large number of elements efficiently', () => {
			const elements: HTMLElement[] = [];

			// Create 100 elements
			for (let i = 0; i < 100; i++) {
				const el = createElement();
				applier.apply(el, [i % 256, (i * 2) % 256, (i * 3) % 256]);
				elements.push(el);
			}

			expect(applier.correctedCount).toBe(100);

			applier.clearAll();

			expect(applier.correctedCount).toBe(0);
			elements.forEach(el => {
				expect(el.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('');
				expect(el.hasAttribute('data-pixelwise-corrected')).toBe(false);
			});
		});

		it('should allow applying corrections after clearAll()', () => {
			const el1 = createElement();
			const el2 = createElement();

			applier.apply(el1, [100, 100, 100]);
			applier.apply(el2, [200, 200, 200]);
			applier.clearAll();

			expect(applier.correctedCount).toBe(0);

			// Should be able to apply again
			applier.apply(el1, [50, 50, 50]);
			expect(applier.correctedCount).toBe(1);
			expect(el1.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('rgb(50, 50, 50)');
		});
	});

	describe('correctedCount getter', () => {
		it('should return 0 initially', () => {
			expect(applier.correctedCount).toBe(0);
		});

		it('should return correct count after applying to single element', () => {
			const el = createElement();
			applier.apply(el, [100, 100, 100]);

			expect(applier.correctedCount).toBe(1);
		});

		it('should return correct count after applying to multiple elements', () => {
			const el1 = createElement();
			const el2 = createElement();
			const el3 = createElement();
			const el4 = createElement();
			const el5 = createElement();

			applier.apply(el1, [100, 100, 100]);
			expect(applier.correctedCount).toBe(1);

			applier.apply(el2, [200, 200, 200]);
			expect(applier.correctedCount).toBe(2);

			applier.apply(el3, [50, 50, 50]);
			expect(applier.correctedCount).toBe(3);

			applier.apply(el4, [150, 150, 150]);
			expect(applier.correctedCount).toBe(4);

			applier.apply(el5, [250, 250, 250]);
			expect(applier.correctedCount).toBe(5);
		});

		it('should return correct count after clearing individual elements', () => {
			const el1 = createElement();
			const el2 = createElement();
			const el3 = createElement();

			applier.apply(el1, [100, 100, 100]);
			applier.apply(el2, [200, 200, 200]);
			applier.apply(el3, [50, 50, 50]);

			expect(applier.correctedCount).toBe(3);

			applier.clear(el1);
			expect(applier.correctedCount).toBe(2);

			applier.clear(el3);
			expect(applier.correctedCount).toBe(1);

			applier.clear(el2);
			expect(applier.correctedCount).toBe(0);
		});

		it('should return 0 after clearAll()', () => {
			const el1 = createElement();
			const el2 = createElement();
			const el3 = createElement();

			applier.apply(el1, [100, 100, 100]);
			applier.apply(el2, [200, 200, 200]);
			applier.apply(el3, [50, 50, 50]);

			expect(applier.correctedCount).toBe(3);

			applier.clearAll();

			expect(applier.correctedCount).toBe(0);
		});

		it('should not increment count when applying to same element multiple times', () => {
			const el = createElement();

			applier.apply(el, [100, 100, 100]);
			expect(applier.correctedCount).toBe(1);

			applier.apply(el, [200, 200, 200]);
			expect(applier.correctedCount).toBe(1);

			applier.apply(el, [50, 50, 50]);
			expect(applier.correctedCount).toBe(1);
		});
	});

	describe('Integration scenarios', () => {
		it('should handle mixed apply, clear, and clearAll operations', () => {
			const el1 = createElement();
			const el2 = createElement();
			const el3 = createElement();
			const el4 = createElement();

			// Apply to first three
			applier.apply(el1, [100, 100, 100]);
			applier.apply(el2, [200, 200, 200]);
			applier.apply(el3, [50, 50, 50]);
			expect(applier.correctedCount).toBe(3);

			// Clear one
			applier.clear(el2);
			expect(applier.correctedCount).toBe(2);

			// Apply to a new element and re-apply to cleared element
			applier.apply(el4, [150, 150, 150]);
			applier.apply(el2, [250, 250, 250]);
			expect(applier.correctedCount).toBe(4);

			// Clear all
			applier.clearAll();
			expect(applier.correctedCount).toBe(0);

			// Apply again after clearAll
			applier.apply(el1, [75, 75, 75]);
			expect(applier.correctedCount).toBe(1);
		});

		it('should maintain correct state with rapid apply/clear cycles', () => {
			const el = createElement();

			for (let i = 0; i < 10; i++) {
				applier.apply(el, [i * 25, i * 25, i * 25]);
				expect(applier.correctedCount).toBe(1);
			}

			applier.clear(el);
			expect(applier.correctedCount).toBe(0);

			for (let i = 0; i < 10; i++) {
				applier.apply(el, [255 - i * 25, 255 - i * 25, 255 - i * 25]);
				expect(applier.correctedCount).toBe(1);
			}
		});

		it('should handle interleaved operations on multiple elements', () => {
			const el1 = createElement();
			const el2 = createElement();

			applier.apply(el1, [100, 100, 100]);
			expect(applier.correctedCount).toBe(1);

			applier.apply(el2, [200, 200, 200]);
			expect(applier.correctedCount).toBe(2);

			applier.clear(el1);
			expect(applier.correctedCount).toBe(1);

			applier.apply(el1, [50, 50, 50]);
			expect(applier.correctedCount).toBe(2);

			applier.clear(el2);
			expect(applier.correctedCount).toBe(1);

			applier.apply(el2, [150, 150, 150]);
			expect(applier.correctedCount).toBe(2);
		});
	});

	describe('Svelte 5 Runes compatibility', () => {
		it('should not rely on WeakMap iteration (runes-friendly)', () => {
			// This test verifies that we can iterate over corrected elements
			// (unlike WeakMap which cannot be iterated)
			const elements = [
				createElement(),
				createElement(),
				createElement()
			];

			elements.forEach((el, i) => {
				applier.apply(el, [i * 85, i * 85, i * 85]);
			});

			// clearAll() must iterate, which proves we're using Set not WeakMap
			applier.clearAll();

			// All should be cleared
			elements.forEach(el => {
				expect(el.style.getPropertyValue('--pixelwise-adjusted-color')).toBe('');
			});
		});

		it('should maintain consistent state for reactive tracking', () => {
			const el1 = createElement();
			const el2 = createElement();

			// Simulate reactive updates
			const counts: number[] = [];

			counts.push(applier.correctedCount); // 0
			applier.apply(el1, [100, 100, 100]);
			counts.push(applier.correctedCount); // 1
			applier.apply(el2, [200, 200, 200]);
			counts.push(applier.correctedCount); // 2
			applier.clear(el1);
			counts.push(applier.correctedCount); // 1
			applier.clearAll();
			counts.push(applier.correctedCount); // 0

			expect(counts).toEqual([0, 1, 2, 1, 0]);
		});
	});
});
