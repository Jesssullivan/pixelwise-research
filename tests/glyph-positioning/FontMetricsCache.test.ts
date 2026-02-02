/**
 * FontMetricsCache Tests
 *
 * Tests for the font metrics extraction and caching system.
 *
 * Tests cover:
 * - Font metrics measurement accuracy
 * - Caching behavior and invalidation
 * - Fallback when TextMetrics API is incomplete
 * - Web font handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
	FontMetricsCache,
	extractFontSignature,
	getFontMetricsCache,
	type FontMetrics,
	type FontSignature
} from '$lib/pixelwise/FontMetricsCache';

// Mock CSSStyleDeclaration for testing
function createMockStyle(overrides: Partial<CSSStyleDeclaration> = {}): CSSStyleDeclaration {
	return {
		fontFamily: 'Arial, sans-serif',
		fontSize: '16px',
		fontWeight: '400',
		fontStyle: 'normal',
		lineHeight: '1.5',
		...overrides
	} as CSSStyleDeclaration;
}

describe('FontMetricsCache', () => {
	let cache: FontMetricsCache;

	beforeEach(() => {
		cache = new FontMetricsCache();
	});

	describe('construction', () => {
		it('should create cache with no entries', () => {
			expect(cache.size).toBe(0);
		});
	});

	describe('getMetrics', () => {
		it('should return metrics for a style', () => {
			const style = createMockStyle();
			const metrics = cache.getMetrics(style);

			expect(metrics).toBeDefined();
			expect(metrics.ascent).toBeGreaterThan(0);
			expect(metrics.descent).toBeGreaterThan(0);
			expect(metrics.emSize).toBe(16);
		});

		it('should cache metrics by font signature', () => {
			const style = createMockStyle();

			const metrics1 = cache.getMetrics(style);
			const metrics2 = cache.getMetrics(style);

			expect(metrics1).toEqual(metrics2);
			expect(cache.size).toBe(1);
		});

		it('should create separate cache entries for different fonts', () => {
			const style1 = createMockStyle({ fontFamily: 'Arial' });
			const style2 = createMockStyle({ fontFamily: 'Times New Roman' });

			cache.getMetrics(style1);
			cache.getMetrics(style2);

			expect(cache.size).toBe(2);
		});

		it('should create separate entries for different sizes', () => {
			const style1 = createMockStyle({ fontSize: '12px' });
			const style2 = createMockStyle({ fontSize: '24px' });

			const metrics1 = cache.getMetrics(style1);
			const metrics2 = cache.getMetrics(style2);

			expect(metrics1.emSize).toBe(12);
			expect(metrics2.emSize).toBe(24);
			expect(cache.size).toBe(2);
		});

		it('should create separate entries for different weights', () => {
			const style1 = createMockStyle({ fontWeight: '400' });
			const style2 = createMockStyle({ fontWeight: '700' });

			cache.getMetrics(style1);
			cache.getMetrics(style2);

			expect(cache.size).toBe(2);
		});
	});

	describe('measure', () => {
		it('should measure CSS font string', () => {
			const metrics = cache.measure('16px Arial');

			expect(metrics).toBeDefined();
			expect(metrics.emSize).toBe(16);
		});

		it('should handle font with style and weight', () => {
			const metrics = cache.measure('italic bold 14px Georgia');

			expect(metrics).toBeDefined();
			expect(metrics.emSize).toBe(14);
		});

		it('should handle pt units', () => {
			const metrics = cache.measure('12pt Times');

			expect(metrics).toBeDefined();
			// 12pt = 16px at 96 DPI
			expect(metrics.emSize).toBe(16);
		});
	});

	describe('clear', () => {
		it('should clear all cached entries', () => {
			cache.getMetrics(createMockStyle({ fontFamily: 'Arial' }));
			cache.getMetrics(createMockStyle({ fontFamily: 'Georgia' }));

			expect(cache.size).toBe(2);

			cache.clear();

			expect(cache.size).toBe(0);
		});
	});

	describe('invalidate', () => {
		it('should remove specific font from cache', () => {
			const sig1: FontSignature = { family: 'Arial', size: 16, weight: '400', style: 'normal' };
			const sig2: FontSignature = { family: 'Georgia', size: 16, weight: '400', style: 'normal' };

			cache.getMetricsForSignature(sig1);
			cache.getMetricsForSignature(sig2);

			expect(cache.size).toBe(2);

			cache.invalidate(sig1);

			expect(cache.size).toBe(1);
		});
	});

	describe('font metrics values', () => {
		it('should have baseline equal to ascent', () => {
			const metrics = cache.measure('16px Arial');

			// Baseline is measured from top, so equals ascent
			expect(metrics.baseline).toBe(metrics.ascent);
		});

		it('should have lineHeight >= ascent + descent', () => {
			const metrics = cache.measure('16px Arial');

			expect(metrics.lineHeight).toBeGreaterThanOrEqual(metrics.ascent + metrics.descent);
		});

		it('should have capHeight <= ascent', () => {
			const metrics = cache.measure('16px Arial');

			expect(metrics.capHeight).toBeLessThanOrEqual(metrics.ascent);
		});

		it('should have xHeight <= capHeight', () => {
			const metrics = cache.measure('16px Arial');

			expect(metrics.xHeight).toBeLessThanOrEqual(metrics.capHeight);
		});

		it('should have positive values for all metrics', () => {
			const metrics = cache.measure('16px Arial');

			expect(metrics.ascent).toBeGreaterThan(0);
			expect(metrics.descent).toBeGreaterThan(0);
			expect(metrics.baseline).toBeGreaterThan(0);
			expect(metrics.lineHeight).toBeGreaterThan(0);
			expect(metrics.capHeight).toBeGreaterThan(0);
			expect(metrics.xHeight).toBeGreaterThan(0);
			expect(metrics.emSize).toBeGreaterThan(0);
		});
	});

	describe('hasFullMetrics', () => {
		it('should indicate whether full TextMetrics API was available', () => {
			const metrics = cache.measure('16px Arial');

			// hasFullMetrics depends on browser support
			expect(typeof metrics.hasFullMetrics).toBe('boolean');
		});
	});
});

describe('extractFontSignature', () => {
	it('should extract font signature from CSSStyleDeclaration', () => {
		const style = createMockStyle({
			fontFamily: 'Helvetica, sans-serif',
			fontSize: '18px',
			fontWeight: '600',
			fontStyle: 'italic'
		});

		const sig = extractFontSignature(style);

		expect(sig.family).toBe('Helvetica, sans-serif');
		expect(sig.size).toBe(18);
		expect(sig.weight).toBe('600');
		expect(sig.style).toBe('italic');
	});
});

describe('getFontMetricsCache', () => {
	it('should return singleton instance', () => {
		const cache1 = getFontMetricsCache();
		const cache2 = getFontMetricsCache();

		expect(cache1).toBe(cache2);
	});
});

describe('Fallback behavior', () => {
	it('should provide reasonable estimates when full TextMetrics unavailable', () => {
		const cache = new FontMetricsCache();
		const metrics = cache.measure('16px Arial');

		// Even with fallback, metrics should be in reasonable ranges
		// Ascent ~88% of em, descent ~12%, cap ~70%, x ~50%
		expect(metrics.ascent).toBeGreaterThan(10); // > 60% of 16
		expect(metrics.ascent).toBeLessThan(20); // < 125% of 16
		expect(metrics.descent).toBeGreaterThan(0);
		expect(metrics.descent).toBeLessThan(8); // < 50% of 16
	});
});
