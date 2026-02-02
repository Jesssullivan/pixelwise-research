/**
 * ColorNormalizer - Browser-native color space conversion using Canvas 2D
 *
 * Converts any valid CSS color (oklch, oklab, lab, lch, hsl, rgb, hex, named)
 * to RGB values without DOM tree manipulation.
 *
 * The Canvas 2D fillStyle setter/getter provides automatic normalization:
 * - Input: Any valid CSS color string
 * - Output: Always #RRGGBB hex (or rgba() if alpha < 1)
 *
 * This approach is:
 * - SSR-safe (returns fallback on server)
 * - No layout thrashing (doesn't modify DOM tree)
 * - Browser-native accuracy (same engine as CSS)
 * - Cacheable (memoizes conversions)
 *
 * @module ColorNormalizer
 */

import { browser } from '$app/environment';
import { parseOklch, oklchToRgb } from '$lib/utils/colorConversion';

/**
 * RGB color tuple [red, green, blue] in 0-255 range
 */
export type RGBTuple = [number, number, number];

/**
 * RGBA color tuple [red, green, blue, alpha] with alpha in 0-1 range
 */
export type RGBATuple = [number, number, number, number];

/**
 * Result of color normalization with metadata
 */
export interface NormalizedColor {
	/** RGB values (0-255) */
	rgb: RGBTuple;
	/** Original input color string */
	original: string;
	/** Normalized hex representation */
	hex: string;
	/** Whether alpha channel was present (< 1) */
	hasAlpha: boolean;
	/** Alpha value if present (0-1) */
	alpha: number;
	/** Whether conversion was from cache */
	cached: boolean;
}

/**
 * Configuration for ColorNormalizer
 */
export interface ColorNormalizerConfig {
	/** Maximum cache size before LRU eviction (default: 1000) */
	maxCacheSize?: number;
	/** Enable debug logging (default: false) */
	debug?: boolean;
}

/**
 * Singleton color normalizer using Canvas 2D for browser-native conversion
 *
 * @example
 * ```typescript
 * const normalizer = ColorNormalizer.getInstance();
 *
 * // Simple conversion
 * const rgb = normalizer.toRGB('oklch(0.75 0.008 260)');
 * console.log(rgb); // [184, 184, 188]
 *
 * // Full metadata
 * const result = normalizer.normalize('oklch(0.75 0.008 260 / 0.5)');
 * console.log(result.rgb, result.alpha); // [184, 184, 188], 0.5
 * ```
 */
export class ColorNormalizer {
	private static instance: ColorNormalizer | null = null;

	private ctx: CanvasRenderingContext2D | null = null;
	private cache: Map<string, NormalizedColor>;
	private config: Required<ColorNormalizerConfig>;

	/**
	 * Get the singleton instance
	 */
	static getInstance(config?: ColorNormalizerConfig): ColorNormalizer {
		if (!ColorNormalizer.instance) {
			ColorNormalizer.instance = new ColorNormalizer(config);
		}
		return ColorNormalizer.instance;
	}

	/**
	 * Reset the singleton (useful for testing)
	 */
	static resetInstance(): void {
		if (ColorNormalizer.instance) {
			ColorNormalizer.instance.destroy();
			ColorNormalizer.instance = null;
		}
	}

	private constructor(config?: ColorNormalizerConfig) {
		this.config = {
			maxCacheSize: config?.maxCacheSize ?? 1000,
			debug: config?.debug ?? false
		};
		this.cache = new Map();
	}

	/**
	 * Get or create the Canvas 2D context
	 * Uses a 1x1 canvas - we only need the fillStyle normalization
	 */
	private getContext(): CanvasRenderingContext2D | null {
		if (!browser) {
			return null;
		}

		if (!this.ctx) {
			try {
				const canvas = document.createElement('canvas');
				canvas.width = 1;
				canvas.height = 1;
				this.ctx = canvas.getContext('2d', {
					willReadFrequently: false,
					alpha: true
				});
			} catch (error) {
				if (this.config.debug) {
					console.warn('[ColorNormalizer] Failed to create canvas context:', error);
				}
				return null;
			}
		}

		return this.ctx;
	}

	/**
	 * Convert any CSS color to RGB tuple
	 *
	 * @param color - Any valid CSS color string
	 * @returns RGB tuple [r, g, b] in 0-255 range
	 */
	toRGB(color: string): RGBTuple {
		return this.normalize(color).rgb;
	}

	/**
	 * Convert any CSS color to RGBA tuple
	 *
	 * @param color - Any valid CSS color string
	 * @returns RGBA tuple [r, g, b, a] with alpha in 0-1 range
	 */
	toRGBA(color: string): RGBATuple {
		const result = this.normalize(color);
		return [...result.rgb, result.alpha];
	}

	/**
	 * Convert any CSS color to hex string
	 *
	 * @param color - Any valid CSS color string
	 * @returns Hex color string (#RRGGBB)
	 */
	toHex(color: string): string {
		return this.normalize(color).hex;
	}

	/**
	 * Full normalization with metadata
	 *
	 * @param color - Any valid CSS color string
	 * @returns NormalizedColor with rgb, hex, alpha, and metadata
	 */
	normalize(color: string): NormalizedColor {
		// Normalize input (trim, lowercase for cache consistency)
		const normalizedInput = color.trim();

		// Check cache first
		const cached = this.cache.get(normalizedInput);
		if (cached) {
			return { ...cached, cached: true };
		}

		// OKLCH FAST PATH - Canvas 2D does NOT support oklch(), use TypeScript math
		// This is critical: getComputedStyle() returns oklch() on modern browsers,
		// but Canvas fillStyle silently ignores it and stays at #000000
		const lowerInput = normalizedInput.toLowerCase();
		if (lowerInput.startsWith('oklch(')) {
			const parsed = parseOklch(normalizedInput);
			if (parsed) {
				const rgb = oklchToRgb(parsed.l, parsed.c, parsed.h);
				const result: NormalizedColor = {
					rgb: [rgb.r, rgb.g, rgb.b],
					original: normalizedInput,
					hex: this.rgbToHex([rgb.r, rgb.g, rgb.b]),
					hasAlpha: parsed.alpha < 1,
					alpha: parsed.alpha,
					cached: false
				};
				this.cacheResult(normalizedInput, result);
				if (this.config.debug) {
					console.log(`[ColorNormalizer] OKLCH: ${color} → RGB(${rgb.r}, ${rgb.g}, ${rgb.b})`);
				}
				return result;
			} else {
				console.warn(`[ColorNormalizer] ⚠️ Failed to parse OKLCH: "${normalizedInput}"`);
			}
		}

		// Get canvas context for legacy color formats (rgb, hex, hsl, named colors)
		const ctx = this.getContext();
		if (!ctx) {
			// SSR fallback - return black
			console.warn('[ColorNormalizer] No canvas context (SSR), returning black fallback');
			return this.createFallbackResult(normalizedInput);
		}

		// Reset to known state (black)
		ctx.fillStyle = '#000000';

		// Set the color - Canvas normalizes automatically
		ctx.fillStyle = normalizedInput;
		const normalized = ctx.fillStyle;

		// DEBUG: Detect if Canvas couldn't parse the color (stays black)
		if (normalized === '#000000' && !normalizedInput.includes('#000') && !normalizedInput.includes('0, 0, 0') && !normalizedInput.includes('black')) {
			console.warn(`[ColorNormalizer] ⚠️ Canvas couldn't parse "${normalizedInput}" - stayed at #000000`);
		}

		// Parse the normalized output
		let rgb: RGBTuple;
		let alpha = 1;
		let hasAlpha = false;
		let hex: string;

		if (normalized.startsWith('#')) {
			// Hex format: #RRGGBB
			rgb = this.parseHex(normalized);
			hex = normalized;
		} else if (normalized.startsWith('rgba')) {
			// RGBA format: rgba(r, g, b, a)
			const parsed = this.parseRgba(normalized);
			rgb = [parsed[0], parsed[1], parsed[2]];
			alpha = parsed[3];
			hasAlpha = alpha < 1;
			hex = this.rgbToHex(rgb);
		} else if (normalized.startsWith('rgb')) {
			// RGB format: rgb(r, g, b)
			rgb = this.parseRgb(normalized);
			hex = this.rgbToHex(rgb);
		} else {
			// Fallback for unexpected format
			if (this.config.debug) {
				console.warn('[ColorNormalizer] Unexpected format:', normalized, 'from input:', color);
			}
			rgb = [0, 0, 0];
			hex = '#000000';
		}

		const result: NormalizedColor = {
			rgb,
			original: normalizedInput,
			hex,
			hasAlpha,
			alpha,
			cached: false
		};

		// Cache with LRU eviction
		this.cacheResult(normalizedInput, result);

		if (this.config.debug) {
			console.log(`[ColorNormalizer] ${color} → RGB(${rgb.join(', ')})`);
		}

		return result;
	}

	/**
	 * Check if a color string is valid
	 *
	 * @param color - Color string to validate
	 * @returns True if the color is valid and parseable
	 */
	isValidColor(color: string): boolean {
		const ctx = this.getContext();
		if (!ctx) return false;

		// Reset to known value
		ctx.fillStyle = '#123456';
		const before = ctx.fillStyle;

		// Try to set the color
		ctx.fillStyle = color;
		const after = ctx.fillStyle;

		// If the value changed from reset, color is valid
		// Invalid colors leave fillStyle unchanged
		return before !== after || color.toLowerCase() === '#123456';
	}

	/**
	 * Batch convert multiple colors
	 *
	 * @param colors - Array of color strings
	 * @returns Map of input color to NormalizedColor
	 */
	normalizeMany(colors: string[]): Map<string, NormalizedColor> {
		const results = new Map<string, NormalizedColor>();
		for (const color of colors) {
			results.set(color, this.normalize(color));
		}
		return results;
	}

	/**
	 * Get cache statistics
	 */
	getCacheStats(): { size: number; maxSize: number; hitRate: number } {
		return {
			size: this.cache.size,
			maxSize: this.config.maxCacheSize,
			hitRate: 0 // Would need to track hits/misses for real hit rate
		};
	}

	/**
	 * Clear the conversion cache
	 */
	clearCache(): void {
		this.cache.clear();
		if (this.config.debug) {
			console.log('[ColorNormalizer] Cache cleared');
		}
	}

	/**
	 * Pre-warm cache with known colors
	 *
	 * @param colors - Array of colors to pre-convert
	 */
	preWarmCache(colors: string[]): void {
		for (const color of colors) {
			this.normalize(color);
		}
		if (this.config.debug) {
			console.log(`[ColorNormalizer] Pre-warmed cache with ${colors.length} colors`);
		}
	}

	/**
	 * Cleanup resources
	 */
	destroy(): void {
		this.cache.clear();
		this.ctx = null;
	}

	// =========================================================================
	// Private Helpers
	// =========================================================================

	private parseHex(hex: string): RGBTuple {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return [r, g, b];
	}

	private parseRgb(rgb: string): RGBTuple {
		// rgb(255, 128, 64) or rgb(255 128 64)
		const match = rgb.match(/rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
		if (match) {
			return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
		}
		return [0, 0, 0];
	}

	private parseRgba(rgba: string): RGBATuple {
		// rgba(255, 128, 64, 0.5) or rgba(255 128 64 / 0.5)
		const match = rgba.match(/rgba\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)[,\s/]+([0-9.]+)/);
		if (match) {
			return [
				parseInt(match[1], 10),
				parseInt(match[2], 10),
				parseInt(match[3], 10),
				parseFloat(match[4])
			];
		}
		return [0, 0, 0, 1];
	}

	private rgbToHex(rgb: RGBTuple): string {
		const [r, g, b] = rgb;
		return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
	}

	private createFallbackResult(input: string): NormalizedColor {
		return {
			rgb: [0, 0, 0],
			original: input,
			hex: '#000000',
			hasAlpha: false,
			alpha: 1,
			cached: false
		};
	}

	private cacheResult(key: string, result: NormalizedColor): void {
		// LRU eviction if at max size
		if (this.cache.size >= this.config.maxCacheSize) {
			// Delete oldest entry (first in Map iteration order)
			const firstKey = this.cache.keys().next().value;
			if (firstKey) {
				this.cache.delete(firstKey);
			}
		}

		this.cache.set(key, result);
	}
}

/**
 * Convenience function for one-off conversions
 *
 * @param color - Any valid CSS color string
 * @returns RGB tuple [r, g, b] in 0-255 range
 */
export function colorToRGB(color: string): RGBTuple {
	return ColorNormalizer.getInstance().toRGB(color);
}

/**
 * Convenience function for hex conversion
 *
 * @param color - Any valid CSS color string
 * @returns Hex color string (#RRGGBB)
 */
export function colorToHex(color: string): string {
	return ColorNormalizer.getInstance().toHex(color);
}

/**
 * Convenience function to check color validity
 *
 * @param color - Color string to validate
 * @returns True if valid CSS color
 */
export function isValidCSSColor(color: string): boolean {
	return ColorNormalizer.getInstance().isValidColor(color);
}
