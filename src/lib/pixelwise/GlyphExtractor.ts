/**
 * GlyphExtractor - Per-character position extraction from DOM text elements
 *
 * Uses the Range API to extract precise per-character bounding boxes,
 * integrating with FontMetricsCache for baseline information and
 * CoordinateTransformer for multi-space coordinate handling.
 *
 * Features:
 * - Per-character bounds extraction via Range.getClientRects()
 * - Subpixel coordinate preservation
 * - Ligature detection and handling
 * - RTL text support
 * - Mixed font size handling
 *
 * @module pixelwise/GlyphExtractor
 */

import { type FontMetrics, FontMetricsCache } from './FontMetricsCache';
import { CoordinateTransformer } from './CoordinateTransformer';

/**
 * Bounds of a single glyph in DOM space
 */
export interface GlyphBounds {
	/** DOM X coordinate (CSS pixels, fractional) */
	x: number;
	/** DOM Y coordinate (CSS pixels, fractional) */
	y: number;
	/** Glyph width in CSS pixels */
	width: number;
	/** Glyph height in CSS pixels */
	height: number;

	/** Y offset of baseline from top of bounds */
	baseline: number;
	/** Font ascent in pixels */
	ascent: number;
	/** Font descent in pixels */
	descent: number;

	/** The character(s) this glyph represents */
	char: string;
	/** Unicode codepoint of the character */
	codepoint: number;
	/** Index in the original text */
	charIndex: number;

	/** Whether this is part of a ligature */
	isLigature: boolean;
	/** Whether this is RTL text */
	isRTL: boolean;
}

/**
 * Extended glyph data with texel coordinates and z-ordering
 */
export interface ExtendedGlyphData extends GlyphBounds {
	/** Texel X coordinate (integer) */
	texelX: number;
	/** Texel Y coordinate (integer) */
	texelY: number;
	/** Subpixel X offset [0, 1) */
	fracX: number;
	/** Subpixel Y offset [0, 1) */
	fracY: number;

	/** Effective z-index */
	zIndex: number;
	/** Stacking context ID */
	stackingContextId: number;

	/** Region ID for grouping */
	regionId: number;
}

/**
 * Options for glyph extraction
 */
export interface GlyphExtractorOptions {
	/** Skip whitespace characters (default: true) */
	skipWhitespace?: boolean;
	/** Include invisible characters (default: false) */
	includeInvisible?: boolean;
	/** Merge ligatures into single glyphs (default: true) */
	handleLigatures?: boolean;
	/** Filter to only characters within viewport (default: true) */
	viewportOnly?: boolean;
}

const DEFAULT_OPTIONS: GlyphExtractorOptions = {
	skipWhitespace: true,
	includeInvisible: false,
	handleLigatures: true,
	viewportOnly: true
};

/**
 * Common ligature pairs to detect
 */
const LIGATURE_PAIRS = new Set(['fi', 'fl', 'ff', 'ffi', 'ffl', 'ft', 'st']);

/**
 * Detect if a character sequence might be rendered as a ligature
 */
function mightBeLigature(text: string, index: number): string | null {
	// Check 3-char ligatures first
	if (index + 2 < text.length) {
		const three = text.substring(index, index + 3);
		if (LIGATURE_PAIRS.has(three)) return three;
	}
	// Check 2-char ligatures
	if (index + 1 < text.length) {
		const two = text.substring(index, index + 2);
		if (LIGATURE_PAIRS.has(two)) return two;
	}
	return null;
}

/**
 * Check if text direction is RTL
 */
function isRTLChar(char: string): boolean {
	const code = char.charCodeAt(0);
	// Arabic: 0x0600-0x06FF, Hebrew: 0x0590-0x05FF
	return (code >= 0x0590 && code <= 0x05ff) || (code >= 0x0600 && code <= 0x06ff);
}

/**
 * GlyphExtractor - Extracts per-character positions from DOM text elements
 *
 * @example
 * ```typescript
 * const extractor = new GlyphExtractor();
 *
 * // Extract glyphs from a text element
 * const glyphs = extractor.extractFromElement(textElement);
 *
 * // Extract with coordinate transformation
 * const transformer = CoordinateTransformer.fromViewport();
 * const extended = extractor.extractExtended(textElement, transformer, getStackingInfo);
 * ```
 */
export class GlyphExtractor {
	private readonly fontCache: FontMetricsCache;
	private readonly options: GlyphExtractorOptions;

	constructor(options: Partial<GlyphExtractorOptions> = {}, fontCache?: FontMetricsCache) {
		this.options = { ...DEFAULT_OPTIONS, ...options };
		this.fontCache = fontCache ?? new FontMetricsCache();
	}

	/**
	 * Extract glyph bounds from a DOM element
	 *
	 * @param element - Element containing text to extract
	 * @returns Array of glyph bounds in DOM space
	 */
	extractFromElement(element: Element): GlyphBounds[] {
		const results: GlyphBounds[] = [];
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

		let textNode: Text | null;
		while ((textNode = walker.nextNode() as Text | null)) {
			const parentElement = textNode.parentElement;
			if (!parentElement) continue;

			// Get computed style and font metrics
			const style = window.getComputedStyle(parentElement);

			// Skip invisible text
			if (!this.options.includeInvisible) {
				if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) === 0) {
					continue;
				}
			}

			const metrics = this.fontCache.getMetrics(style);
			const nodeGlyphs = this.extractFromTextNode(textNode, metrics, style);
			results.push(...nodeGlyphs);
		}

		return results;
	}

	/**
	 * Extract glyph bounds from a single text node
	 */
	private extractFromTextNode(textNode: Text, metrics: FontMetrics, style: CSSStyleDeclaration): GlyphBounds[] {
		const results: GlyphBounds[] = [];
		const text = textNode.textContent || '';
		if (!text) return results;

		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		let i = 0;
		while (i < text.length) {
			const char = text[i];

			// Skip whitespace if configured
			if (this.options.skipWhitespace && /\s/.test(char)) {
				i++;
				continue;
			}

			// Check for ligature
			let extractChars = char;
			let isLigature = false;

			if (this.options.handleLigatures) {
				const ligature = mightBeLigature(text, i);
				if (ligature) {
					extractChars = ligature;
					isLigature = true;
				}
			}

			// Create range for character(s)
			const range = document.createRange();
			range.setStart(textNode, i);
			range.setEnd(textNode, i + extractChars.length);

			// Get bounding rects (may be multiple for wrapped text)
			const rects = range.getClientRects();

			for (const rect of rects) {
				// Filter by viewport if configured
				if (this.options.viewportOnly) {
					if (rect.right < 0 || rect.left > viewportWidth || rect.bottom < 0 || rect.top > viewportHeight) {
						continue;
					}
				}

				// Skip zero-dimension rects
				if (rect.width <= 0 || rect.height <= 0) {
					continue;
				}

				const isRTL = isRTLChar(char);

				results.push({
					x: rect.x,
					y: rect.y,
					width: rect.width,
					height: rect.height,
					baseline: metrics.baseline,
					ascent: metrics.ascent,
					descent: metrics.descent,
					char: extractChars,
					codepoint: extractChars.codePointAt(0) || 0,
					charIndex: i,
					isLigature,
					isRTL
				});
			}

			i += extractChars.length;
		}

		return results;
	}

	/**
	 * Extract extended glyph data with texel coordinates and z-ordering
	 *
	 * @param element - Element containing text to extract
	 * @param transformer - Coordinate transformer for texel conversion
	 * @param getStackingInfo - Function to get z-index and stacking context for an element
	 * @param regionId - Region ID to assign to all glyphs from this element
	 */
	extractExtended(
		element: Element,
		transformer: CoordinateTransformer,
		getStackingInfo: (el: Element) => { zIndex: number; contextId: number },
		regionId: number = 0
	): ExtendedGlyphData[] {
		const bounds = this.extractFromElement(element);
		const stackingInfo = getStackingInfo(element);

		return bounds.map((glyph) => {
			const texel = transformer.toTexel(transformer.toPhysical({ x: glyph.x, y: glyph.y }));

			return {
				...glyph,
				texelX: texel.x,
				texelY: texel.y,
				fracX: texel.fracX,
				fracY: texel.fracY,
				zIndex: stackingInfo.zIndex,
				stackingContextId: stackingInfo.contextId,
				regionId
			};
		});
	}

	/**
	 * Extract glyphs from multiple elements efficiently
	 *
	 * @param elements - Elements to extract from
	 * @param transformer - Coordinate transformer
	 * @param getStackingInfo - Function to get z-index and stacking context
	 */
	extractBatch(
		elements: Element[],
		transformer: CoordinateTransformer,
		getStackingInfo: (el: Element) => { zIndex: number; contextId: number }
	): ExtendedGlyphData[] {
		const results: ExtendedGlyphData[] = [];

		for (let regionId = 0; regionId < elements.length; regionId++) {
			const glyphs = this.extractExtended(elements[regionId], transformer, getStackingInfo, regionId);
			results.push(...glyphs);
		}

		return results;
	}

	/**
	 * Pack extracted glyphs into GPU-friendly buffers
	 *
	 * @param glyphs - Extended glyph data array
	 * @returns Typed arrays ready for GPU upload
	 */
	packForGPU(glyphs: ExtendedGlyphData[]): {
		/** [x0, y0, x1, y1, ...] texel positions */
		positions: Uint32Array;
		/** [fracX0, fracY0, fracX1, fracY1, ...] subpixel offsets */
		subpixelOffsets: Float32Array;
		/** [z0, z1, ...] z-indices */
		zIndices: Uint16Array;
		/** [ctx0, ctx1, ...] stacking context IDs */
		contextIds: Uint16Array;
		/** [region0, region1, ...] region IDs */
		regionIds: Uint16Array;
		/** Per-glyph metadata for CPU-side processing */
		metadata: Array<{ char: string; codepoint: number; isLigature: boolean }>;
	} {
		const count = glyphs.length;

		const positions = new Uint32Array(count * 2);
		const subpixelOffsets = new Float32Array(count * 2);
		const zIndices = new Uint16Array(count);
		const contextIds = new Uint16Array(count);
		const regionIds = new Uint16Array(count);
		const metadata: Array<{ char: string; codepoint: number; isLigature: boolean }> = [];

		for (let i = 0; i < count; i++) {
			const g = glyphs[i];

			positions[i * 2] = g.texelX;
			positions[i * 2 + 1] = g.texelY;

			subpixelOffsets[i * 2] = g.fracX;
			subpixelOffsets[i * 2 + 1] = g.fracY;

			zIndices[i] = Math.min(65535, Math.max(0, g.zIndex + 32768)); // Shift to unsigned
			contextIds[i] = g.stackingContextId;
			regionIds[i] = g.regionId;

			metadata.push({
				char: g.char,
				codepoint: g.codepoint,
				isLigature: g.isLigature
			});
		}

		return {
			positions,
			subpixelOffsets,
			zIndices,
			contextIds,
			regionIds,
			metadata
		};
	}

	/**
	 * Get the font metrics cache for direct access
	 */
	getFontCache(): FontMetricsCache {
		return this.fontCache;
	}
}

/**
 * Quick extraction of glyph positions from an element
 *
 * @param element - Element to extract from
 * @param options - Extraction options
 */
export function extractGlyphBounds(element: Element, options?: Partial<GlyphExtractorOptions>): GlyphBounds[] {
	const extractor = new GlyphExtractor(options);
	return extractor.extractFromElement(element);
}

/**
 * Count visible characters in an element (for capacity estimation)
 */
export function countVisibleCharacters(element: Element): number {
	let count = 0;
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

	let node: Text | null;
	while ((node = walker.nextNode() as Text | null)) {
		const text = node.textContent || '';
		// Count non-whitespace characters
		count += text.replace(/\s/g, '').length;
	}

	return count;
}
