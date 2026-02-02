/**
 * FontMetricsCache - Font metrics extraction and caching
 *
 * Extracts precise font metrics (ascent, descent, baseline, cap-height, x-height)
 * using the Canvas TextMetrics API. Caches metrics by font signature to avoid
 * redundant measurements.
 *
 * @module pixelwise/FontMetricsCache
 */

/**
 * Complete font metrics extracted from a font
 */
export interface FontMetrics {
	/** Pixels above the baseline (positive) */
	ascent: number;
	/** Pixels below the baseline (positive) */
	descent: number;
	/** Y offset from top of em-box to baseline (same as ascent for most fonts) */
	baseline: number;
	/** Total line height in pixels */
	lineHeight: number;
	/** Height of capital letters (H, X, etc.) */
	capHeight: number;
	/** Height of lowercase 'x' */
	xHeight: number;
	/** Font size in pixels (em size) */
	emSize: number;
	/** Whether full TextMetrics API was available */
	hasFullMetrics: boolean;
}

/**
 * Font signature for cache key generation
 */
export interface FontSignature {
	family: string;
	size: number;
	weight: string | number;
	style: string;
}

/**
 * Generate a cache key from font signature
 */
function fontSignatureToKey(sig: FontSignature): string {
	return `${sig.family}|${sig.size}|${sig.weight}|${sig.style}`;
}

/**
 * Parse CSS font string into signature components
 */
function parseCSSFont(cssFont: string): FontSignature | null {
	// CSS font shorthand: [style] [weight] size[/line-height] family
	// e.g., "italic bold 16px/1.5 Arial, sans-serif"
	const match = cssFont.match(
		/^(italic|oblique)?\s*(normal|bold|lighter|bolder|\d{3})?\s*(\d+(?:\.\d+)?)(px|pt|em|rem)(?:\/[\d.]+)?\s+(.+)$/i
	);

	if (!match) {
		return null;
	}

	const [, style = 'normal', weight = '400', sizeNum, sizeUnit, family] = match;

	// Convert size to pixels
	let size = parseFloat(sizeNum);
	if (sizeUnit === 'pt') {
		size = size * (96 / 72); // 96 DPI standard
	} else if (sizeUnit === 'em' || sizeUnit === 'rem') {
		size = size * 16; // Assume 16px base
	}

	return {
		family: family.trim(),
		size,
		weight: weight === 'bold' ? '700' : weight === 'normal' ? '400' : weight,
		style: style || 'normal'
	};
}

/**
 * Extract font signature from CSSStyleDeclaration
 */
export function extractFontSignature(style: CSSStyleDeclaration): FontSignature {
	return {
		family: style.fontFamily,
		size: parseFloat(style.fontSize),
		weight: style.fontWeight,
		style: style.fontStyle
	};
}

/**
 * FontMetricsCache - Caches font metrics by signature
 *
 * Uses Canvas 2D TextMetrics API for precise measurements.
 * Falls back to heuristics when full TextMetrics is unavailable.
 *
 * @example
 * ```typescript
 * const cache = new FontMetricsCache();
 *
 * // From computed style
 * const style = window.getComputedStyle(element);
 * const metrics = cache.getMetrics(style);
 *
 * // Direct measurement
 * const metrics = cache.measure('16px Arial');
 * ```
 */
export class FontMetricsCache {
	private cache = new Map<string, FontMetrics>();
	private canvas: OffscreenCanvas | HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

	constructor() {
		// Prefer OffscreenCanvas for better performance (no DOM interaction)
		if (typeof OffscreenCanvas !== 'undefined') {
			this.canvas = new OffscreenCanvas(1, 1);
			this.ctx = this.canvas.getContext('2d')!;
		} else {
			this.canvas = document.createElement('canvas');
			this.canvas.width = 1;
			this.canvas.height = 1;
			this.ctx = this.canvas.getContext('2d')!;
		}
	}

	/**
	 * Get metrics from computed style, using cache when available
	 */
	getMetrics(style: CSSStyleDeclaration): FontMetrics {
		const sig = extractFontSignature(style);
		return this.getMetricsForSignature(sig);
	}

	/**
	 * Get metrics for a font signature
	 */
	getMetricsForSignature(sig: FontSignature): FontMetrics {
		const key = fontSignatureToKey(sig);

		const cached = this.cache.get(key);
		if (cached) {
			return cached;
		}

		const metrics = this.measureFont(sig);
		this.cache.set(key, metrics);
		return metrics;
	}

	/**
	 * Measure a CSS font string directly
	 *
	 * @param cssFont - CSS font shorthand (e.g., "16px Arial")
	 */
	measure(cssFont: string): FontMetrics {
		const sig = parseCSSFont(cssFont);
		if (!sig) {
			// Fallback: try to use the string directly
			return this.measureFontDirect(cssFont, 16);
		}
		return this.getMetricsForSignature(sig);
	}

	/**
	 * Clear the cache (useful when web fonts load)
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Remove a specific font from cache (e.g., when a web font loads)
	 */
	invalidate(sig: FontSignature): void {
		const key = fontSignatureToKey(sig);
		this.cache.delete(key);
	}

	/**
	 * Get cache size for debugging
	 */
	get size(): number {
		return this.cache.size;
	}

	/**
	 * Measure font metrics using Canvas TextMetrics API
	 */
	private measureFont(sig: FontSignature): FontMetrics {
		// Build CSS font string
		const cssFont = `${sig.style} ${sig.weight} ${sig.size}px ${sig.family}`;
		return this.measureFontDirect(cssFont, sig.size);
	}

	/**
	 * Direct font measurement with CSS font string
	 */
	private measureFontDirect(cssFont: string, emSize: number): FontMetrics {
		this.ctx.font = cssFont;

		// Measure with a string containing ascenders and descenders
		// 'Hxgp' covers: H=capHeight, x=xHeight, g=descender, p=descender
		const tm = this.ctx.measureText('Hxgp');

		// Check for full TextMetrics support (Chrome 87+, Firefox 74+, Safari 14+)
		const hasFullMetrics =
			'fontBoundingBoxAscent' in tm &&
			'fontBoundingBoxDescent' in tm &&
			'actualBoundingBoxAscent' in tm;

		let ascent: number;
		let descent: number;
		let capHeight: number;
		let xHeight: number;

		if (hasFullMetrics) {
			// Use font-defined metrics for consistency across characters
			ascent = tm.fontBoundingBoxAscent!;
			descent = tm.fontBoundingBoxDescent!;

			// Measure cap-height and x-height specifically
			const capTm = this.ctx.measureText('H');
			const xTm = this.ctx.measureText('x');

			capHeight = capTm.actualBoundingBoxAscent;
			xHeight = xTm.actualBoundingBoxAscent;
		} else {
			// Fallback: estimate from em size using typical font ratios
			// These are approximations based on common Latin fonts
			ascent = emSize * 0.88; // ~88% of em for ascent
			descent = emSize * 0.12; // ~12% of em for descent
			capHeight = emSize * 0.7; // ~70% of em for cap height
			xHeight = emSize * 0.5; // ~50% of em for x-height
		}

		// Line height: if not explicitly set, use 1.2× em size
		const lineHeight = ascent + descent;

		return {
			ascent,
			descent,
			baseline: ascent, // Baseline is ascent distance from top
			lineHeight,
			capHeight,
			xHeight,
			emSize,
			hasFullMetrics
		};
	}
}

/**
 * Global singleton for convenience (optional)
 */
let globalCache: FontMetricsCache | null = null;

/**
 * Get or create the global FontMetricsCache instance
 */
export function getFontMetricsCache(): FontMetricsCache {
	if (!globalCache) {
		globalCache = new FontMetricsCache();
	}
	return globalCache;
}

/**
 * Listen for font load events and invalidate cache
 *
 * Call this once during app initialization to ensure
 * web fonts are re-measured after loading.
 */
export function setupFontLoadListener(): void {
	if (typeof document === 'undefined') return;

	document.fonts?.addEventListener('loadingdone', () => {
		// Clear entire cache when fonts change
		// A more sophisticated approach would track which fonts loaded
		globalCache?.clear();
	});
}
