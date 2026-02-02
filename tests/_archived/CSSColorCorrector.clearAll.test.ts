/**
 * Unit test for CSSColorCorrector.clearAll() bug fix
 *
 * Verifies that clearAll() correctly removes all corrections after
 * fixing the WeakMap iteration issue with hybrid Set+WeakMap tracking.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CSSColorCorrector } from '$lib/pixelwise/CSSColorCorrector';
import type { AdjustedCharacter } from '$lib/pixelwise/CSSColorCorrector';

describe('CSSColorCorrector.clearAll()', () => {
	let corrector: CSSColorCorrector;
	let testElements: HTMLElement[];

	beforeEach(() => {
		corrector = new CSSColorCorrector({
			strategy: 'conservative',
			useCSSVariables: false // Use direct style application for easier testing
		});

		// Create test elements
		testElements = [
			document.createElement('p'),
			document.createElement('h1'),
			document.createElement('span'),
			document.createElement('div'),
			document.createElement('a')
		];

		// Set initial text and computed color for each element
		testElements.forEach((el, i) => {
			el.textContent = `Test element ${i + 1}`;
			el.style.color = 'rgb(100, 100, 100)'; // Initial gray color
			document.body.appendChild(el);
		});
	});

	it('should clear all corrections when clearAll() is called', () => {
		// Apply corrections to all test elements
		const adjustedCharacters: AdjustedCharacter[] = [
			{ char_index: 0, r: 255, g: 0, b: 0 }, // Red correction
			{ char_index: 1, r: 255, g: 0, b: 0 }
		];

		testElements.forEach((el) => {
			corrector.applyCorrections(el, adjustedCharacters);
		});

		// Verify corrections were applied
		expect(corrector.correctedCount).toBe(5);

		// Clear all corrections
		const consoleSpy = vi.spyOn(console, 'log');
		corrector.clearAll();

		// Verify all corrections were cleared
		expect(corrector.correctedCount).toBe(0);
		expect(consoleSpy).toHaveBeenCalledWith('[CSSColorCorrector] Cleared all corrections');

		// Verify each element's status
		testElements.forEach((el) => {
			const status = corrector.getCorrectionStatus(el);
			expect(status.isCorrected).toBe(false);
		});

		consoleSpy.mockRestore();
	});

	it('should handle clearAll() when no corrections exist', () => {
		const consoleSpy = vi.spyOn(console, 'log');

		// Call clearAll() with no corrections
		corrector.clearAll();

		expect(corrector.correctedCount).toBe(0);
		expect(consoleSpy).toHaveBeenCalledWith('[CSSColorCorrector] Cleared all corrections');

		consoleSpy.mockRestore();
	});

	it('should properly remove elements from both WeakMap and Set', () => {
		const adjustedCharacters: AdjustedCharacter[] = [
			{ char_index: 0, r: 0, g: 0, b: 255 } // Blue correction
		];

		const el = testElements[0];

		// Apply correction
		corrector.applyCorrections(el, adjustedCharacters);
		expect(corrector.correctedCount).toBe(1);

		// Clear all
		corrector.clearAll();
		expect(corrector.correctedCount).toBe(0);

		// Apply correction again to same element - should work
		corrector.applyCorrections(el, adjustedCharacters);
		expect(corrector.correctedCount).toBe(1);
	});

	it('should restore original colors when clearing', () => {
		const el = testElements[0];
		const originalColor = el.style.color;

		const adjustedCharacters: AdjustedCharacter[] = [
			{ char_index: 0, r: 255, g: 255, b: 0 } // Yellow correction
		];

		// Apply correction
		corrector.applyCorrections(el, adjustedCharacters);

		// Verify color was changed
		const afterColor = el.style.color;
		expect(afterColor).not.toBe(originalColor);
		expect(afterColor).toContain('rgb(255, 255, 0)');

		// Clear all
		corrector.clearAll();

		// Verify color was restored
		const restoredColor = el.style.color;
		expect(restoredColor).toBe(originalColor);
	});

	it('should handle mixed correction strategies', () => {
		const conservativeCorrector = new CSSColorCorrector({
			strategy: 'conservative',
			useCSSVariables: false
		});

		const adjustedChars: AdjustedCharacter[] = [
			{ char_index: 0, r: 255, g: 0, b: 0 },
			{ char_index: 1, r: 200, g: 0, b: 0 }
		];

		// Apply to first 3 elements
		testElements.slice(0, 3).forEach((el) => {
			conservativeCorrector.applyCorrections(el, adjustedChars);
		});

		expect(conservativeCorrector.correctedCount).toBe(3);

		// Clear all
		conservativeCorrector.clearAll();

		expect(conservativeCorrector.correctedCount).toBe(0);

		// Verify all cleared
		testElements.slice(0, 3).forEach((el) => {
			const status = conservativeCorrector.getCorrectionStatus(el);
			expect(status.isCorrected).toBe(false);
		});
	});

	it('should handle per-character correction clearing', () => {
		const perCharCorrector = new CSSColorCorrector({
			strategy: 'per-character',
			perCharacterClass: 'wcag-test'
		});

		const el = testElements[0];
		el.textContent = 'Test';

		const adjustedChars: AdjustedCharacter[] = [
			{ char_index: 0, r: 255, g: 0, b: 0 },
			{ char_index: 1, r: 0, g: 255, b: 0 },
			{ char_index: 2, r: 0, g: 0, b: 255 },
			{ char_index: 3, r: 255, g: 255, b: 0 }
		];

		// Apply per-character correction
		perCharCorrector.applyCorrections(el, adjustedChars);

		// Verify spans were added
		expect(el.querySelector('.wcag-test')).toBeTruthy();
		expect(perCharCorrector.correctedCount).toBe(1);

		// Clear all
		perCharCorrector.clearAll();

		// Verify spans were removed and text restored
		expect(el.querySelector('.wcag-test')).toBeNull();
		expect(el.textContent).toBe('Test');
		expect(perCharCorrector.correctedCount).toBe(0);
	});

	it('should maintain correctedCount accuracy during multiple operations', () => {
		const adjustedChars: AdjustedCharacter[] = [
			{ char_index: 0, r: 100, g: 100, b: 100 }
		];

		// Apply to 3 elements
		testElements.slice(0, 3).forEach((el) => {
			corrector.applyCorrections(el, adjustedChars);
		});
		expect(corrector.correctedCount).toBe(3);

		// Clear specific element
		corrector.clearCorrections(testElements[1]);
		expect(corrector.correctedCount).toBe(2);

		// Apply to 2 more elements
		testElements.slice(3, 5).forEach((el) => {
			corrector.applyCorrections(el, adjustedChars);
		});
		expect(corrector.correctedCount).toBe(4);

		// Clear all
		corrector.clearAll();
		expect(corrector.correctedCount).toBe(0);
	});
});
