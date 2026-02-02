/**
 * StackingContextResolver Tests
 *
 * Tests for the CSS stacking context analysis system.
 *
 * Tests cover:
 * - Stacking context creation detection
 * - Effective z-index calculation
 * - Parent-child hierarchy tracking
 * - Cache behavior
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	StackingContextResolver,
	getStackingContextResolver,
	resolveStackingContext,
	packStackingContextsForGPU,
	type StackingInfo,
	type StackingContextInfo
} from '$lib/pixelwise/StackingContextResolver';

// Mock window.getComputedStyle
function createMockComputedStyle(overrides: Partial<CSSStyleDeclaration> = {}): CSSStyleDeclaration {
	return {
		position: 'static',
		zIndex: 'auto',
		opacity: '1',
		transform: 'none',
		filter: 'none',
		perspective: 'none',
		clipPath: 'none',
		isolation: 'auto',
		mixBlendMode: 'normal',
		willChange: 'auto',
		contain: 'none',
		...overrides
	} as CSSStyleDeclaration;
}

// Mock element for testing
function createMockElement(style: Partial<CSSStyleDeclaration> = {}, parent?: Element): Element {
	const mockStyle = createMockComputedStyle(style);

	const element = {
		parentElement: parent || null,
		children: [] as Element[],
		__mockStyle: mockStyle
	} as unknown as Element;

	// Add getComputedStyle mock
	vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
		return (el as unknown as { __mockStyle: CSSStyleDeclaration }).__mockStyle;
	});

	return element;
}

describe('StackingContextResolver', () => {
	let resolver: StackingContextResolver;

	beforeEach(() => {
		resolver = new StackingContextResolver();
		vi.restoreAllMocks();
	});

	describe('createsStackingContext', () => {
		it('should return true for position with z-index', () => {
			const style = createMockComputedStyle({
				position: 'relative',
				zIndex: '1'
			});

			expect(resolver.createsStackingContext(style)).toBe(true);
		});

		it('should return false for position with z-index auto', () => {
			const style = createMockComputedStyle({
				position: 'relative',
				zIndex: 'auto'
			});

			expect(resolver.createsStackingContext(style)).toBe(false);
		});

		it('should return true for opacity < 1', () => {
			const style = createMockComputedStyle({
				opacity: '0.5'
			});

			expect(resolver.createsStackingContext(style)).toBe(true);
		});

		it('should return false for opacity = 1', () => {
			const style = createMockComputedStyle({
				opacity: '1'
			});

			expect(resolver.createsStackingContext(style)).toBe(false);
		});

		it('should return true for transform != none', () => {
			const style = createMockComputedStyle({
				transform: 'translateX(10px)'
			});

			expect(resolver.createsStackingContext(style)).toBe(true);
		});

		it('should return true for filter != none', () => {
			const style = createMockComputedStyle({
				filter: 'blur(5px)'
			});

			expect(resolver.createsStackingContext(style)).toBe(true);
		});

		it('should return true for isolation: isolate', () => {
			const style = createMockComputedStyle({
				isolation: 'isolate'
			});

			expect(resolver.createsStackingContext(style)).toBe(true);
		});

		it('should return true for mix-blend-mode != normal', () => {
			const style = createMockComputedStyle({
				mixBlendMode: 'multiply'
			});

			expect(resolver.createsStackingContext(style)).toBe(true);
		});

		it('should return true for will-change: transform', () => {
			const style = createMockComputedStyle({
				willChange: 'transform'
			});

			expect(resolver.createsStackingContext(style)).toBe(true);
		});

		it('should return true for will-change: opacity', () => {
			const style = createMockComputedStyle({
				willChange: 'opacity'
			});

			expect(resolver.createsStackingContext(style)).toBe(true);
		});

		it('should return true for contain: layout', () => {
			const style = createMockComputedStyle({
				contain: 'layout'
			});

			expect(resolver.createsStackingContext(style)).toBe(true);
		});

		it('should return true for contain: paint', () => {
			const style = createMockComputedStyle({
				contain: 'paint'
			});

			expect(resolver.createsStackingContext(style)).toBe(true);
		});

		it('should return false for element with no stacking triggers', () => {
			const style = createMockComputedStyle();

			expect(resolver.createsStackingContext(style)).toBe(false);
		});
	});

	describe('resolve', () => {
		it('should return stacking info for element', () => {
			const element = createMockElement({ position: 'relative', zIndex: '5' });

			const info = resolver.resolve(element);

			expect(info).toHaveProperty('contextId');
			expect(info).toHaveProperty('effectiveZ');
			expect(info).toHaveProperty('isNewContext');
			expect(info).toHaveProperty('parentContextId');
			expect(info).toHaveProperty('depth');
		});

		it('should mark element creating context as isNewContext', () => {
			const element = createMockElement({ position: 'absolute', zIndex: '10' });

			const info = resolver.resolve(element);

			expect(info.isNewContext).toBe(true);
			expect(info.effectiveZ).toBe(10);
		});

		it('should not mark non-context element as isNewContext', () => {
			const element = createMockElement();

			const info = resolver.resolve(element);

			expect(info.isNewContext).toBe(false);
		});

		it('should cache resolved info', () => {
			const element = createMockElement({ position: 'relative', zIndex: '1' });

			const info1 = resolver.resolve(element);
			const info2 = resolver.resolve(element);

			expect(info1).toEqual(info2);
		});

		it('should return z-index 0 for auto', () => {
			const element = createMockElement({ zIndex: 'auto' });

			const info = resolver.resolve(element);

			expect(info.effectiveZ).toBe(0);
		});

		it('should return parsed z-index for numeric value', () => {
			const element = createMockElement({ position: 'relative', zIndex: '42' });

			const info = resolver.resolve(element);

			expect(info.effectiveZ).toBe(42);
		});
	});

	describe('computeSortKey', () => {
		it('should produce consistent sort keys', () => {
			const info: StackingInfo = {
				contextId: 1,
				effectiveZ: 5,
				isNewContext: true,
				parentContextId: 0,
				depth: 1
			};

			const key1 = resolver.computeSortKey(info);
			const key2 = resolver.computeSortKey(info);

			expect(key1).toBe(key2);
		});

		it('should produce higher keys for higher z-index', () => {
			const info1: StackingInfo = {
				contextId: 1,
				effectiveZ: 1,
				isNewContext: true,
				parentContextId: 0,
				depth: 1
			};

			const info2: StackingInfo = {
				contextId: 1,
				effectiveZ: 10,
				isNewContext: true,
				parentContextId: 0,
				depth: 1
			};

			expect(resolver.computeSortKey(info2)).toBeGreaterThan(resolver.computeSortKey(info1));
		});

		it('should produce higher keys for deeper context', () => {
			const info1: StackingInfo = {
				contextId: 1,
				effectiveZ: 0,
				isNewContext: true,
				parentContextId: 0,
				depth: 1
			};

			const info2: StackingInfo = {
				contextId: 2,
				effectiveZ: 0,
				isNewContext: true,
				parentContextId: 1,
				depth: 2
			};

			expect(resolver.computeSortKey(info2)).toBeGreaterThan(resolver.computeSortKey(info1));
		});
	});

	describe('clear', () => {
		it('should clear cached data', () => {
			const element = createMockElement({ position: 'relative', zIndex: '1' });

			resolver.resolve(element);
			resolver.clear();

			// After clear, resolving again should get fresh data
			// (though values should be same)
			const info = resolver.resolve(element);
			expect(info).toBeDefined();
		});
	});
});

describe('getStackingContextResolver', () => {
	it('should return singleton instance', () => {
		const resolver1 = getStackingContextResolver();
		const resolver2 = getStackingContextResolver();

		expect(resolver1).toBe(resolver2);
	});
});

describe('packStackingContextsForGPU', () => {
	it('should pack contexts into Uint32Array', () => {
		const contexts: StackingContextInfo[] = [
			{ contextId: 1, parentContextId: 0, element: null, baseZ: 0, depth: 1 },
			{ contextId: 2, parentContextId: 1, element: null, baseZ: 5, depth: 2 }
		];

		const packed = packStackingContextsForGPU(contexts);

		expect(packed).toBeInstanceOf(Uint32Array);
		expect(packed.length).toBe(6); // 2 contexts * 3 values

		// First context
		expect(packed[0]).toBe(1); // contextId
		expect(packed[1]).toBe(0); // parentId
		// baseZ is shifted to unsigned: 0 + 2^31

		// Second context
		expect(packed[3]).toBe(2); // contextId
		expect(packed[4]).toBe(1); // parentId
	});

	it('should handle negative z-indices', () => {
		const contexts: StackingContextInfo[] = [{ contextId: 1, parentContextId: 0, element: null, baseZ: -10, depth: 1 }];

		const packed = packStackingContextsForGPU(contexts);

		// -10 + 2^31 should be a valid unsigned value
		expect(packed[2]).toBe(2147483648 - 10);
	});
});
