/**
 * Unit tests for CSSColorCorrector
 *
 * Tests the CSS-based color correction system including the critical
 * WeakMap+Set hybrid that enables clearAll() to iterate over corrected elements.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	CSSColorCorrector,
	calculateConservativeCorrection,
	needsCorrection,
	calculateRelativeLuminance,
	calculateContrastRatio,
	parseColorString,
	type AdjustedCharacter,
	type RGBColor,
	type CorrectionOptions
} from '$lib/pixelwise/CSSColorCorrector';

/**
 * Create a mock HTML element with default styles
 */
function createMockElement(options?: {
	color?: string;
	backgroundColor?: string;
	textContent?: string;
}): HTMLElement {
	const el = document.createElement('div');
	el.style.color = options?.color || 'rgb(100, 100, 100)';
	el.style.backgroundColor = options?.backgroundColor || 'rgb(255, 255, 255)';
	el.textContent = options?.textContent || 'Test text';
	document.body.appendChild(el); // Needed for computed styles
	return el;
}

/**
 * Create sample adjusted character data
 */
function createAdjustedCharacters(count: number = 3): AdjustedCharacter[] {
	return Array.from({ length: count }, (_, i) => ({
		char_index: i,
		r: 50 + i * 10,
		g: 50 + i * 10,
		b: 50 + i * 10
	}));
}

/**
 * Cleanup helper to remove elements from DOM
 */
function cleanupElement(el: HTMLElement): void {
	if (el.parentNode) {
		el.parentNode.removeChild(el);
	}
}

describe('CSSColorCorrector', () => {
	let corrector: CSSColorCorrector;

	beforeEach(() => {
		// Reset for each test
		corrector = new CSSColorCorrector();
	});

	describe('Constructor', () => {
		it('should initialize with default options', () => {
			const corrector = new CSSColorCorrector();
			expect(corrector).toBeDefined();
			expect(corrector.correctedCount).toBe(0);
		});

		it('should accept custom useCSSVariables option', () => {
			const options: CorrectionOptions = { useCSSVariables: false };
			const corrector = new CSSColorCorrector(options);
			expect(corrector).toBeDefined();
		});

		it('should accept custom strategy option', () => {
			const options: CorrectionOptions = { strategy: 'average' };
			const corrector = new CSSColorCorrector(options);
			expect(corrector).toBeDefined();
		});

		it('should accept custom variablePrefix option', () => {
			const options: CorrectionOptions = { variablePrefix: '--custom-prefix' };
			const corrector = new CSSColorCorrector(options);
			expect(corrector).toBeDefined();
		});

		it('should accept custom perCharacterClass option', () => {
			const options: CorrectionOptions = { perCharacterClass: 'custom-char-class' };
			const corrector = new CSSColorCorrector(options);
			expect(corrector).toBeDefined();
		});

		it('should accept multiple custom options', () => {
			const options: CorrectionOptions = {
				useCSSVariables: false,
				strategy: 'per-character',
				variablePrefix: '--my-prefix',
				perCharacterClass: 'my-char'
			};
			const corrector = new CSSColorCorrector(options);
			expect(corrector).toBeDefined();
		});
	});

	describe('applyConservativeCorrection', () => {
		it('should apply conservative correction to element', () => {
			const el = createMockElement();
			const adjustedChars = createAdjustedCharacters(3);

			const result = corrector.applyCorrections(el, adjustedChars);

			expect(result.applied).toBe(true);
			expect(corrector.correctedCount).toBe(1);

			cleanupElement(el);
		});

		it('should track element in correctedElementsSet', () => {
			const el = createMockElement();
			const adjustedChars = createAdjustedCharacters(3);

			corrector.applyCorrections(el, adjustedChars);

			expect(corrector.correctedCount).toBe(1);

			cleanupElement(el);
		});

		it('should use CSS variables when useCSSVariables is true (default)', () => {
			const el = createMockElement();
			const adjustedChars: AdjustedCharacter[] = [
				{ char_index: 0, r: 255, g: 0, b: 0 }
			];

			corrector.applyCorrections(el, adjustedChars);

			const status = corrector.getCorrectionStatus(el);
			expect(status.isCorrected).toBe(true);
			expect(status.method).toBe('css-variable');

			cleanupElement(el);
		});

		it('should use direct color when useCSSVariables is false', () => {
			const corrector = new CSSColorCorrector({ useCSSVariables: false });
			const el = createMockElement();
			const adjustedChars: AdjustedCharacter[] = [
				{ char_index: 0, r: 255, g: 0, b: 0 }
			];

			corrector.applyCorrections(el, adjustedChars);

			const status = corrector.getCorrectionStatus(el);
			expect(status.isCorrected).toBe(true);
			expect(status.method).toBe('direct');

			cleanupElement(el);
		});
	});

	describe('applyAverageCorrection', () => {
		it('should apply average correction to element', () => {
			const corrector = new CSSColorCorrector({ strategy: 'average' });
			const el = createMockElement();
			const adjustedChars: AdjustedCharacter[] = [
				{ char_index: 0, r: 100, g: 100, b: 100 },
				{ char_index: 1, r: 200, g: 200, b: 200 }
			];

			const result = corrector.applyCorrections(el, adjustedChars);

			expect(result.applied).toBe(true);
			expect(corrector.correctedCount).toBe(1);

			// Average should be (100+200)/2 = 150
			const status = corrector.getCorrectionStatus(el);
			expect(status.correctedColor).toContain('150');

			cleanupElement(el);
		});

		it('should track element in correctedElementsSet', () => {
			const corrector = new CSSColorCorrector({ strategy: 'average' });
			const el = createMockElement();
			const adjustedChars = createAdjustedCharacters(3);

			corrector.applyCorrections(el, adjustedChars);

			expect(corrector.correctedCount).toBe(1);

			cleanupElement(el);
		});

		it('should correctly average multiple character colors', () => {
			const corrector = new CSSColorCorrector({ strategy: 'average' });
			const el = createMockElement();
			const adjustedChars: AdjustedCharacter[] = [
				{ char_index: 0, r: 0, g: 0, b: 0 },
				{ char_index: 1, r: 255, g: 255, b: 255 },
				{ char_index: 2, r: 0, g: 0, b: 0 }
			];

			corrector.applyCorrections(el, adjustedChars);

			const status = corrector.getCorrectionStatus(el);
			// Average: (0+255+0)/3 = 85
			expect(status.correctedColor).toContain('85');

			cleanupElement(el);
		});
	});

	describe('applyPerCharacterCorrection', () => {
		it('should apply per-character correction to element', () => {
			const corrector = new CSSColorCorrector({ strategy: 'per-character' });
			const el = createMockElement({ textContent: 'ABC' });
			const adjustedChars: AdjustedCharacter[] = [
				{ char_index: 0, r: 255, g: 0, b: 0 },
				{ char_index: 1, r: 0, g: 255, b: 0 },
				{ char_index: 2, r: 0, g: 0, b: 255 }
			];

			const result = corrector.applyCorrections(el, adjustedChars);

			expect(result.applied).toBe(true);
			expect(corrector.correctedCount).toBe(1);

			cleanupElement(el);
		});

		it('should track element in correctedElementsSet', () => {
			const corrector = new CSSColorCorrector({ strategy: 'per-character' });
			const el = createMockElement({ textContent: 'ABC' });
			const adjustedChars = createAdjustedCharacters(3);

			corrector.applyCorrections(el, adjustedChars);

			expect(corrector.correctedCount).toBe(1);

			cleanupElement(el);
		});

		it('should wrap characters in spans with custom class', () => {
			const corrector = new CSSColorCorrector({
				strategy: 'per-character',
				perCharacterClass: 'custom-char'
			});
			const el = createMockElement({ textContent: 'AB' });
			const adjustedChars: AdjustedCharacter[] = [
				{ char_index: 0, r: 255, g: 0, b: 0 },
				{ char_index: 1, r: 0, g: 255, b: 0 }
			];

			corrector.applyCorrections(el, adjustedChars);

			expect(el.innerHTML).toContain('custom-char');
			expect(el.innerHTML).toContain('<span');

			cleanupElement(el);
		});

		it('should preserve text content', () => {
			const corrector = new CSSColorCorrector({ strategy: 'per-character' });
			const originalText = 'Test';
			const el = createMockElement({ textContent: originalText });
			const adjustedChars = createAdjustedCharacters(4);

			corrector.applyCorrections(el, adjustedChars);

			expect(el.textContent).toBe(originalText);

			cleanupElement(el);
		});
	});

	describe('clearAll() - THE BUG FIX', () => {
		it('should iterate over all corrected elements', () => {
			const el1 = createMockElement();
			const el2 = createMockElement();
			const el3 = createMockElement();
			const adjustedChars = createAdjustedCharacters(3);

			corrector.applyCorrections(el1, adjustedChars);
			corrector.applyCorrections(el2, adjustedChars);
			corrector.applyCorrections(el3, adjustedChars);

			expect(corrector.correctedCount).toBe(3);

			corrector.clearAll();

			expect(corrector.correctedCount).toBe(0);

			cleanupElement(el1);
			cleanupElement(el2);
			cleanupElement(el3);
		});

		it('should call clearCorrections for each element', () => {
			const el1 = createMockElement();
			const el2 = createMockElement();
			const adjustedChars = createAdjustedCharacters(3);

			corrector.applyCorrections(el1, adjustedChars);
			corrector.applyCorrections(el2, adjustedChars);

			const spy = vi.spyOn(corrector, 'clearCorrections');

			corrector.clearAll();

			expect(spy).toHaveBeenCalledTimes(2);
			expect(spy).toHaveBeenCalledWith(el1);
			expect(spy).toHaveBeenCalledWith(el2);

			cleanupElement(el1);
			cleanupElement(el2);
		});

		it('should clear the correctedElementsSet', () => {
			const el1 = createMockElement();
			const el2 = createMockElement();
			const adjustedChars = createAdjustedCharacters(3);

			corrector.applyCorrections(el1, adjustedChars);
			corrector.applyCorrections(el2, adjustedChars);

			expect(corrector.correctedCount).toBe(2);

			corrector.clearAll();

			expect(corrector.correctedCount).toBe(0);

			cleanupElement(el1);
			cleanupElement(el2);
		});

		it('should work correctly (not just log a warning)', () => {
			const el = createMockElement({ color: 'rgb(100, 100, 100)' });
			const adjustedChars: AdjustedCharacter[] = [
				{ char_index: 0, r: 255, g: 0, b: 0 }
			];

			corrector.applyCorrections(el, adjustedChars);

			const beforeStatus = corrector.getCorrectionStatus(el);
			expect(beforeStatus.isCorrected).toBe(true);

			corrector.clearAll();

			const afterStatus = corrector.getCorrectionStatus(el);
			expect(afterStatus.isCorrected).toBe(false);

			cleanupElement(el);
		});

		it('should handle empty state gracefully', () => {
			expect(corrector.correctedCount).toBe(0);

			expect(() => {
				corrector.clearAll();
			}).not.toThrow();

			expect(corrector.correctedCount).toBe(0);
		});

		it('should clear all correction types (conservative, average, per-character)', () => {
			const corrector1 = new CSSColorCorrector({ strategy: 'conservative' });
			const corrector2 = new CSSColorCorrector({ strategy: 'average' });
			const corrector3 = new CSSColorCorrector({ strategy: 'per-character' });

			const el1 = createMockElement();
			const el2 = createMockElement();
			const el3 = createMockElement({ textContent: 'ABC' });
			const adjustedChars = createAdjustedCharacters(3);

			corrector1.applyCorrections(el1, adjustedChars);
			corrector2.applyCorrections(el2, adjustedChars);
			corrector3.applyCorrections(el3, adjustedChars);

			corrector1.clearAll();
			corrector2.clearAll();
			corrector3.clearAll();

			expect(corrector1.correctedCount).toBe(0);
			expect(corrector2.correctedCount).toBe(0);
			expect(corrector3.correctedCount).toBe(0);

			cleanupElement(el1);
			cleanupElement(el2);
			cleanupElement(el3);
		});
	});

	describe('clearCorrections()', () => {
		it('should restore original element styles for direct method', () => {
			const corrector = new CSSColorCorrector({ useCSSVariables: false });
			const el = createMockElement({ color: 'rgb(100, 100, 100)' });
			const originalColor = window.getComputedStyle(el).color;
			const adjustedChars: AdjustedCharacter[] = [
				{ char_index: 0, r: 255, g: 0, b: 0 }
			];

			corrector.applyCorrections(el, adjustedChars);
			corrector.clearCorrections(el);

			// After clearing, the style.color should be set back to original
			expect(el.style.color).toBe(originalColor);

			cleanupElement(el);
		});

		it('should restore original element styles for css-variable method', () => {
			const el = createMockElement({ color: 'rgb(100, 100, 100)' });
			const adjustedChars: AdjustedCharacter[] = [
				{ char_index: 0, r: 255, g: 0, b: 0 }
			];

			corrector.applyCorrections(el, adjustedChars);
			corrector.clearCorrections(el);

			// After clearing, CSS variable should be removed
			expect(el.style.color).toBe('');

			cleanupElement(el);
		});

		it('should restore original text for per-character method', () => {
			const corrector = new CSSColorCorrector({ strategy: 'per-character' });
			const originalText = 'ABC';
			const el = createMockElement({ textContent: originalText });
			const adjustedChars = createAdjustedCharacters(3);

			corrector.applyCorrections(el, adjustedChars);

			// Should have spans
			expect(el.innerHTML).toContain('<span');

			corrector.clearCorrections(el);

			// Should be plain text again
			expect(el.innerHTML).not.toContain('<span');
			expect(el.textContent).toBe(originalText);

			cleanupElement(el);
		});

		it('should remove element from WeakMap', () => {
			const el = createMockElement();
			const adjustedChars = createAdjustedCharacters(3);

			corrector.applyCorrections(el, adjustedChars);

			let status = corrector.getCorrectionStatus(el);
			expect(status.isCorrected).toBe(true);

			corrector.clearCorrections(el);

			status = corrector.getCorrectionStatus(el);
			expect(status.isCorrected).toBe(false);

			cleanupElement(el);
		});

		it('should remove element from Set', () => {
			const el = createMockElement();
			const adjustedChars = createAdjustedCharacters(3);

			corrector.applyCorrections(el, adjustedChars);
			expect(corrector.correctedCount).toBe(1);

			corrector.clearCorrections(el);
			expect(corrector.correctedCount).toBe(0);

			cleanupElement(el);
		});

		it('should handle elements not in cache gracefully', () => {
			const el = createMockElement();

			expect(() => {
				corrector.clearCorrections(el);
			}).not.toThrow();

			cleanupElement(el);
		});
	});

	describe('correctedCount getter', () => {
		it('should return 0 initially', () => {
			expect(corrector.correctedCount).toBe(0);
		});

		it('should increment when corrections applied', () => {
			const el1 = createMockElement();
			const el2 = createMockElement();
			const adjustedChars = createAdjustedCharacters(3);

			expect(corrector.correctedCount).toBe(0);

			corrector.applyCorrections(el1, adjustedChars);
			expect(corrector.correctedCount).toBe(1);

			corrector.applyCorrections(el2, adjustedChars);
			expect(corrector.correctedCount).toBe(2);

			cleanupElement(el1);
			cleanupElement(el2);
		});

		it('should decrement when corrections cleared', () => {
			const el1 = createMockElement();
			const el2 = createMockElement();
			const adjustedChars = createAdjustedCharacters(3);

			corrector.applyCorrections(el1, adjustedChars);
			corrector.applyCorrections(el2, adjustedChars);
			expect(corrector.correctedCount).toBe(2);

			corrector.clearCorrections(el1);
			expect(corrector.correctedCount).toBe(1);

			corrector.clearCorrections(el2);
			expect(corrector.correctedCount).toBe(0);

			cleanupElement(el1);
			cleanupElement(el2);
		});

		it('should be 0 after clearAll()', () => {
			const el1 = createMockElement();
			const el2 = createMockElement();
			const el3 = createMockElement();
			const adjustedChars = createAdjustedCharacters(3);

			corrector.applyCorrections(el1, adjustedChars);
			corrector.applyCorrections(el2, adjustedChars);
			corrector.applyCorrections(el3, adjustedChars);
			expect(corrector.correctedCount).toBe(3);

			corrector.clearAll();
			expect(corrector.correctedCount).toBe(0);

			cleanupElement(el1);
			cleanupElement(el2);
			cleanupElement(el3);
		});
	});

	describe('Integration: WeakMap + Set hybrid', () => {
		it('should keep WeakMap and Set in sync when applying corrections', () => {
			const el = createMockElement();
			const adjustedChars = createAdjustedCharacters(3);

			corrector.applyCorrections(el, adjustedChars);

			// WeakMap should have metadata
			const status = corrector.getCorrectionStatus(el);
			expect(status.isCorrected).toBe(true);
			expect(status.originalColor).toBeDefined();
			expect(status.correctedColor).toBeDefined();

			// Set should enable iteration
			expect(corrector.correctedCount).toBe(1);

			cleanupElement(el);
		});

		it('should keep WeakMap and Set in sync when clearing corrections', () => {
			const el = createMockElement();
			const adjustedChars = createAdjustedCharacters(3);

			corrector.applyCorrections(el, adjustedChars);
			corrector.clearCorrections(el);

			// WeakMap should not have the element
			const status = corrector.getCorrectionStatus(el);
			expect(status.isCorrected).toBe(false);

			// Set should not have the element
			expect(corrector.correctedCount).toBe(0);

			cleanupElement(el);
		});

		it('should handle multiple elements in both structures', () => {
			const elements = [
				createMockElement(),
				createMockElement(),
				createMockElement(),
				createMockElement(),
				createMockElement()
			];
			const adjustedChars = createAdjustedCharacters(3);

			// Apply to all
			elements.forEach(el => corrector.applyCorrections(el, adjustedChars));

			// Verify all are tracked
			expect(corrector.correctedCount).toBe(5);
			elements.forEach(el => {
				const status = corrector.getCorrectionStatus(el);
				expect(status.isCorrected).toBe(true);
			});

			// Clear some
			corrector.clearCorrections(elements[0]);
			corrector.clearCorrections(elements[2]);

			expect(corrector.correctedCount).toBe(3);
			expect(corrector.getCorrectionStatus(elements[0]).isCorrected).toBe(false);
			expect(corrector.getCorrectionStatus(elements[1]).isCorrected).toBe(true);
			expect(corrector.getCorrectionStatus(elements[2]).isCorrected).toBe(false);

			// Clear all remaining
			corrector.clearAll();
			expect(corrector.correctedCount).toBe(0);

			elements.forEach(cleanupElement);
		});
	});
});

describe('calculateConservativeCorrection', () => {
	it('should return black for empty array', () => {
		const result = calculateConservativeCorrection([]);
		expect(result).toEqual([0, 0, 0]);
	});

	it('should return single color for single character', () => {
		const chars: AdjustedCharacter[] = [
			{ char_index: 0, r: 100, g: 150, b: 200 }
		];
		const result = calculateConservativeCorrection(chars);
		expect(result).toEqual([100, 150, 200]);
	});

	it('should select color with maximum deviation from middle gray', () => {
		const chars: AdjustedCharacter[] = [
			{ char_index: 0, r: 128, g: 128, b: 128 }, // Middle gray
			{ char_index: 1, r: 0, g: 0, b: 0 },       // Black (max deviation)
			{ char_index: 2, r: 200, g: 200, b: 200 }
		];
		const result = calculateConservativeCorrection(chars);
		expect(result).toEqual([0, 0, 0]); // Should pick black
	});

	it('should handle all similar colors', () => {
		const chars: AdjustedCharacter[] = [
			{ char_index: 0, r: 100, g: 100, b: 100 },
			{ char_index: 1, r: 101, g: 101, b: 101 },
			{ char_index: 2, r: 102, g: 102, b: 102 }
		];
		const result = calculateConservativeCorrection(chars);
		expect(result).toBeDefined();
		expect(result.length).toBe(3);
	});
});

describe('needsCorrection', () => {
	it('should return false when colors are identical', () => {
		const original: RGBColor[] = [
			[100, 100, 100],
			[150, 150, 150]
		];
		const adjusted: AdjustedCharacter[] = [
			{ char_index: 0, r: 100, g: 100, b: 100 },
			{ char_index: 1, r: 150, g: 150, b: 150 }
		];
		expect(needsCorrection(original, adjusted)).toBe(false);
	});

	it('should return true when any color differs', () => {
		const original: RGBColor[] = [
			[100, 100, 100],
			[150, 150, 150]
		];
		const adjusted: AdjustedCharacter[] = [
			{ char_index: 0, r: 100, g: 100, b: 100 },
			{ char_index: 1, r: 151, g: 150, b: 150 } // One channel different
		];
		expect(needsCorrection(original, adjusted)).toBe(true);
	});

	it('should return true when array lengths differ', () => {
		const original: RGBColor[] = [
			[100, 100, 100]
		];
		const adjusted: AdjustedCharacter[] = [
			{ char_index: 0, r: 100, g: 100, b: 100 },
			{ char_index: 1, r: 150, g: 150, b: 150 }
		];
		expect(needsCorrection(original, adjusted)).toBe(true);
	});

	it('should return false for empty arrays', () => {
		const original: RGBColor[] = [];
		const adjusted: AdjustedCharacter[] = [];
		expect(needsCorrection(original, adjusted)).toBe(false);
	});
});

describe('calculateRelativeLuminance', () => {
	it('should calculate correct luminance for black', () => {
		const luminance = calculateRelativeLuminance([0, 0, 0]);
		expect(luminance).toBeCloseTo(0, 5);
	});

	it('should calculate correct luminance for white', () => {
		const luminance = calculateRelativeLuminance([255, 255, 255]);
		expect(luminance).toBeCloseTo(1, 5);
	});

	it('should calculate correct luminance for middle gray', () => {
		const luminance = calculateRelativeLuminance([128, 128, 128]);
		expect(luminance).toBeGreaterThan(0);
		expect(luminance).toBeLessThan(1);
	});

	it('should handle red channel correctly', () => {
		const luminance = calculateRelativeLuminance([255, 0, 0]);
		expect(luminance).toBeGreaterThan(0);
		expect(luminance).toBeLessThan(1);
	});

	it('should handle sRGB threshold correctly', () => {
		// Test value below threshold (0.03928)
		const lowValue: RGBColor = [5, 5, 5]; // ~0.02 in sRGB
		const lowLuminance = calculateRelativeLuminance(lowValue);
		expect(lowLuminance).toBeGreaterThan(0);
	});
});

describe('calculateContrastRatio', () => {
	it('should calculate correct ratio for black and white', () => {
		const ratio = calculateContrastRatio([0, 0, 0], [255, 255, 255]);
		expect(ratio).toBeCloseTo(21, 0); // Maximum contrast
	});

	it('should calculate correct ratio for same colors', () => {
		const ratio = calculateContrastRatio([128, 128, 128], [128, 128, 128]);
		expect(ratio).toBeCloseTo(1, 1); // Minimum contrast
	});

	it('should be symmetric (color order does not matter)', () => {
		const color1: RGBColor = [100, 100, 100];
		const color2: RGBColor = [200, 200, 200];

		const ratio1 = calculateContrastRatio(color1, color2);
		const ratio2 = calculateContrastRatio(color2, color1);

		expect(ratio1).toBeCloseTo(ratio2, 5);
	});

	it('should return ratio between 1 and 21', () => {
		const ratio = calculateContrastRatio([50, 100, 150], [200, 150, 100]);
		expect(ratio).toBeGreaterThanOrEqual(1);
		expect(ratio).toBeLessThanOrEqual(21);
	});

	it('should meet WCAG AA for known compliant colors', () => {
		// Black text on white background
		const ratio = calculateContrastRatio([0, 0, 0], [255, 255, 255]);
		expect(ratio).toBeGreaterThan(4.5); // WCAG AA normal text
		expect(ratio).toBeGreaterThan(3); // WCAG AA large text
	});
});

describe('parseColorString', () => {
	it('should parse rgb() format', () => {
		const color = parseColorString('rgb(100, 150, 200)');
		expect(color).toEqual([100, 150, 200]);
	});

	it('should parse rgba() format', () => {
		const color = parseColorString('rgba(100, 150, 200, 0.5)');
		expect(color).toEqual([100, 150, 200]);
	});

	it('should parse hex format', () => {
		const color = parseColorString('#6496C8'); // rgb(100, 150, 200)
		expect(color).toBeDefined();
		expect(color).toHaveLength(3);
	});

	it('should parse named colors', () => {
		const color = parseColorString('red');
		expect(color).toEqual([255, 0, 0]);
	});

	it('should handle shorthand hex', () => {
		const color = parseColorString('#F00'); // Red
		expect(color).toEqual([255, 0, 0]);
	});

	it('should return null for invalid color', () => {
		const color = parseColorString('not-a-color');
		expect(color).toBeNull();
	});
});
