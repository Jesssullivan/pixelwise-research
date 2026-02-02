/**
 * GlyphFrameSynchronizer - Coordinates glyph extraction with video frames
 *
 * Synchronizes DOM glyph position extraction with video capture frames,
 * handling the coordination between:
 * - DOM text position extraction (GlyphExtractor)
 * - Coordinate transformation (CoordinateTransformer)
 * - GPU buffer uploads
 * - Frame-to-frame caching
 *
 * Glyph positions are relatively stable between frames (DOM changes rarely),
 * so caching can significantly reduce extraction overhead.
 *
 * @module capture/GlyphFrameSynchronizer
 */

import { GlyphExtractor, type ExtendedGlyphData, type GlyphBounds } from '$lib/pixelwise/GlyphExtractor';
import { CoordinateTransformer, type DOMCoord } from '$lib/pixelwise/CoordinateTransformer';
import { StackingContextResolver, type StackingInfo } from '$lib/pixelwise/StackingContextResolver';
import { FontMetricsCache } from '$lib/pixelwise/FontMetricsCache';
import type { GlyphPixelBufferV2, RegionFontMetrics } from '$lib/pixelwise/GlyphPixelBuffer';

/**
 * Configuration for glyph frame synchronization
 */
export interface GlyphSyncConfig {
	/** Number of frames to cache glyph positions */
	cacheFrames: number;
	/** Whether to automatically detect DOM changes */
	autoDetectChanges: boolean;
	/** Maximum glyphs to extract per frame */
	maxGlyphs: number;
	/** Skip whitespace characters */
	skipWhitespace: boolean;
}

/**
 * Default synchronizer configuration
 */
export const DEFAULT_SYNC_CONFIG: GlyphSyncConfig = {
	cacheFrames: 3,
	autoDetectChanges: true,
	maxGlyphs: 100000,
	skipWhitespace: true
};

/**
 * Result of a glyph extraction for a frame
 */
export interface FrameGlyphData {
	/** Extracted glyph data */
	glyphs: ExtendedGlyphData[];
	/** Frame number this extraction is for */
	frameNumber: number;
	/** Whether this was cached from a previous frame */
	wasCached: boolean;
	/** Extraction time in milliseconds */
	extractionTime: number;
	/** Number of unique regions */
	regionCount: number;
	/** Number of stacking contexts */
	stackingContextCount: number;
}

/**
 * GlyphFrameSynchronizer - Coordinates glyph extraction with video capture
 *
 * @example
 * ```typescript
 * const sync = new GlyphFrameSynchronizer(device, 1920, 1080);
 *
 * // Set root element to extract from
 * sync.setRootElement(document.body);
 *
 * // Extract glyphs for a frame
 * const data = sync.extractForFrame(frameNumber);
 *
 * // Upload to GPU buffer
 * sync.uploadToGPU(buffer, data.glyphs);
 *
 * // Invalidate cache on DOM changes
 * sync.invalidateCache();
 * ```
 */
export class GlyphFrameSynchronizer {
	private readonly device: GPUDevice;
	private readonly extractor: GlyphExtractor;
	private readonly fontCache: FontMetricsCache;
	private readonly stackingResolver: StackingContextResolver;
	private transformer: CoordinateTransformer;
	private config: GlyphSyncConfig;

	// Caching
	private glyphCache: Map<number, ExtendedGlyphData[]> = new Map();
	private lastExtractionFrame = -1;
	private lastExtractionData: ExtendedGlyphData[] = [];
	private cacheInvalidated = true;

	// DOM observation
	private rootElement: Element | null = null;
	private mutationObserver: MutationObserver | null = null;
	private resizeObserver: ResizeObserver | null = null;

	// Region tracking
	private regionElements: Map<number, Element> = new Map();
	private regionMetrics: Map<number, RegionFontMetrics> = new Map();

	/**
	 * Create a new GlyphFrameSynchronizer
	 *
	 * @param device - WebGPU device for buffer operations
	 * @param textureWidth - Width of the capture texture
	 * @param textureHeight - Height of the capture texture
	 * @param config - Synchronizer configuration
	 */
	constructor(
		device: GPUDevice,
		textureWidth: number,
		textureHeight: number,
		config: Partial<GlyphSyncConfig> = {}
	) {
		this.device = device;
		this.config = { ...DEFAULT_SYNC_CONFIG, ...config };

		// Create extraction components
		this.fontCache = new FontMetricsCache();
		this.extractor = new GlyphExtractor(
			{
				skipWhitespace: this.config.skipWhitespace,
				viewportOnly: true
			},
			this.fontCache
		);
		this.stackingResolver = new StackingContextResolver();

		// Create transformer for current viewport
		const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
		this.transformer = new CoordinateTransformer(dpr, textureWidth, textureHeight);

		// Set up DOM observation if auto-detection enabled
		if (this.config.autoDetectChanges && typeof MutationObserver !== 'undefined') {
			this.mutationObserver = new MutationObserver(() => {
				this.invalidateCache();
			});

			this.resizeObserver = new ResizeObserver(() => {
				this.invalidateCache();
			});
		}
	}

	/** Current transformer */
	get coordinateTransformer(): CoordinateTransformer {
		return this.transformer;
	}

	/** Whether cache is valid */
	get isCacheValid(): boolean {
		return !this.cacheInvalidated;
	}

	/** Number of cached frames */
	get cachedFrameCount(): number {
		return this.glyphCache.size;
	}

	/**
	 * Set the root element to extract glyphs from
	 *
	 * @param element - Root element (typically document.body or a container)
	 */
	setRootElement(element: Element): void {
		// Disconnect from old element
		if (this.rootElement) {
			this.mutationObserver?.disconnect();
			this.resizeObserver?.disconnect();
		}

		this.rootElement = element;
		this.invalidateCache();

		// Set up observation
		if (this.config.autoDetectChanges && this.mutationObserver) {
			this.mutationObserver.observe(element, {
				childList: true,
				subtree: true,
				characterData: true,
				attributes: true,
				attributeFilter: ['style', 'class']
			});
		}

		if (this.config.autoDetectChanges && this.resizeObserver) {
			this.resizeObserver.observe(element);
		}
	}

	/**
	 * Update the coordinate transformer for new dimensions
	 */
	updateDimensions(textureWidth: number, textureHeight: number, dpr?: number): void {
		const actualDpr = dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1);
		this.transformer = new CoordinateTransformer(actualDpr, textureWidth, textureHeight);
		this.invalidateCache();
	}

	/**
	 * Extract glyphs for a frame
	 *
	 * Uses caching to avoid repeated extraction when DOM hasn't changed.
	 *
	 * @param frameNumber - Current frame number
	 * @returns Extracted glyph data
	 */
	extractForFrame(frameNumber: number): FrameGlyphData {
		const startTime = performance.now();

		// Check cache first
		if (!this.cacheInvalidated && this.glyphCache.has(frameNumber % this.config.cacheFrames)) {
			const cached = this.glyphCache.get(frameNumber % this.config.cacheFrames)!;
			return {
				glyphs: cached,
				frameNumber,
				wasCached: true,
				extractionTime: performance.now() - startTime,
				regionCount: new Set(cached.map((g) => g.regionId)).size,
				stackingContextCount: new Set(cached.map((g) => g.stackingContextId)).size
			};
		}

		// Fresh extraction needed
		const glyphs = this.extractGlyphs();
		const extractionTime = performance.now() - startTime;

		// Cache result
		this.glyphCache.set(frameNumber % this.config.cacheFrames, glyphs);
		this.lastExtractionFrame = frameNumber;
		this.lastExtractionData = glyphs;
		this.cacheInvalidated = false;

		return {
			glyphs,
			frameNumber,
			wasCached: false,
			extractionTime,
			regionCount: new Set(glyphs.map((g) => g.regionId)).size,
			stackingContextCount: new Set(glyphs.map((g) => g.stackingContextId)).size
		};
	}

	/**
	 * Extract glyphs from the DOM
	 */
	private extractGlyphs(): ExtendedGlyphData[] {
		if (!this.rootElement) {
			console.warn('[GlyphFrameSynchronizer] No root element set');
			return [];
		}

		// Find all text-containing elements
		const textElements = this.findTextElements(this.rootElement);

		if (textElements.length === 0) {
			return [];
		}

		// Clear region tracking
		this.regionElements.clear();
		this.regionMetrics.clear();

		// Extract glyphs from each element
		const allGlyphs: ExtendedGlyphData[] = [];
		let regionId = 0;

		for (const element of textElements) {
			// Get stacking info
			const stackingInfo = this.stackingResolver.resolve(element);

			// Extract glyphs
			const glyphs = this.extractor.extractExtended(
				element,
				this.transformer,
				() => stackingInfo,
				regionId
			);

			if (glyphs.length > 0) {
				// Track region
				this.regionElements.set(regionId, element);

				// Get font metrics for region
				const style = window.getComputedStyle(element);
				const metrics = this.fontCache.getMetrics(style);
				this.regionMetrics.set(regionId, {
					baseline: metrics.baseline,
					ascent: metrics.ascent,
					descent: metrics.descent,
					lineHeight: metrics.lineHeight,
					emSize: metrics.emSize,
					flags: 0
				});

				allGlyphs.push(...glyphs);
				regionId++;
			}

			// Check limit
			if (allGlyphs.length >= this.config.maxGlyphs) {
				console.warn(
					`[GlyphFrameSynchronizer] Max glyph limit reached (${this.config.maxGlyphs})`
				);
				break;
			}
		}

		return allGlyphs;
	}

	/**
	 * Find all elements containing visible text
	 */
	private findTextElements(root: Element): Element[] {
		const elements: Element[] = [];
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (node: Text) => {
				// Skip empty or whitespace-only text
				const text = node.textContent?.trim();
				if (!text) return NodeFilter.FILTER_REJECT;

				// Check parent element visibility
				const parent = node.parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;

				const style = window.getComputedStyle(parent);
				if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
					return NodeFilter.FILTER_REJECT;
				}

				// Check if in viewport
				const rect = parent.getBoundingClientRect();
				if (rect.right < 0 || rect.left > viewportWidth || rect.bottom < 0 || rect.top > viewportHeight) {
					return NodeFilter.FILTER_REJECT;
				}

				return NodeFilter.FILTER_ACCEPT;
			}
		});

		const seenElements = new Set<Element>();
		let node: Node | null;

		while ((node = walker.nextNode())) {
			const parent = (node as Text).parentElement;
			if (parent && !seenElements.has(parent)) {
				seenElements.add(parent);
				elements.push(parent);
			}
		}

		return elements;
	}

	/**
	 * Upload glyph data to a GPU buffer
	 *
	 * @param buffer - GPU buffer to write to
	 * @param glyphs - Extracted glyph data
	 */
	uploadToGPU(buffer: GPUBuffer, glyphs: ExtendedGlyphData[]): void {
		// Pack glyph data for GPU (matching GlyphPixelV2 struct)
		const glyphPixelSize = 24; // 6 x f32
		const data = new Float32Array(glyphs.length * 6);

		for (let i = 0; i < glyphs.length; i++) {
			const g = glyphs[i];
			const offset = i * 6;

			data[offset] = g.texelX;
			data[offset + 1] = g.texelY;
			data[offset + 2] = 1.0; // Coverage (placeholder, ESDT will compute)
			data[offset + 3] = 1.0; // Edge weight (placeholder)
			data[offset + 4] = g.fracX; // Gradient X (reusing for subpixel)
			data[offset + 5] = g.fracY; // Gradient Y (reusing for subpixel)
		}

		this.device.queue.writeBuffer(buffer, 0, data);
	}

	/**
	 * Upload glyph data to a GlyphPixelBufferV2
	 */
	uploadToBufferV2(buffer: GlyphPixelBufferV2, glyphs: ExtendedGlyphData[]): void {
		// Prepare typed arrays
		const count = glyphs.length;
		const x = new Float32Array(count);
		const y = new Float32Array(count);
		const fracX = new Float32Array(count);
		const fracY = new Float32Array(count);
		const zIndices = new Uint16Array(count);
		const contextIds = new Uint16Array(count);
		const coverage = new Uint8Array(count);
		const regionIds = new Uint16Array(count);

		// Collect unique regions for colors
		const uniqueRegions = new Set<number>();

		for (let i = 0; i < count; i++) {
			const g = glyphs[i];
			x[i] = g.texelX;
			y[i] = g.texelY;
			fracX[i] = g.fracX;
			fracY[i] = g.fracY;
			zIndices[i] = Math.min(65535, Math.max(0, g.zIndex + 32768));
			contextIds[i] = g.stackingContextId;
			coverage[i] = 255; // Full coverage (ESDT will refine)
			regionIds[i] = g.regionId;
			uniqueRegions.add(g.regionId);
		}

		// Create region colors (placeholder - actual colors from computed style)
		const regionColors = new Uint8Array(uniqueRegions.size * 3);
		let colorIdx = 0;
		for (const regionId of uniqueRegions) {
			const element = this.regionElements.get(regionId);
			if (element) {
				const style = window.getComputedStyle(element);
				const color = this.parseColor(style.color);
				regionColors[colorIdx++] = color.r;
				regionColors[colorIdx++] = color.g;
				regionColors[colorIdx++] = color.b;
			} else {
				// Default to black
				regionColors[colorIdx++] = 0;
				regionColors[colorIdx++] = 0;
				regionColors[colorIdx++] = 0;
			}
		}

		// Populate V2 buffer
		buffer.populateV2({
			x,
			y,
			fracX,
			fracY,
			zIndices,
			contextIds,
			coverage,
			regionIds,
			regionColors
		});

		// Set font metrics per region
		for (const [regionId, metrics] of this.regionMetrics) {
			buffer.setRegionFontMetrics(regionId, metrics);
		}

		// Set texture dimensions
		buffer.setTextureDimensions(this.transformer.textureWidth, this.transformer.textureHeight);
		buffer.setDPR(this.transformer.dpr);
	}

	/**
	 * Parse CSS color string to RGB values
	 */
	private parseColor(colorStr: string): { r: number; g: number; b: number } {
		// Handle rgb() and rgba() formats
		const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
		if (match) {
			return {
				r: parseInt(match[1], 10),
				g: parseInt(match[2], 10),
				b: parseInt(match[3], 10)
			};
		}

		// Default to black
		return { r: 0, g: 0, b: 0 };
	}

	/**
	 * Invalidate the glyph cache
	 *
	 * Call this when DOM content changes.
	 */
	invalidateCache(): void {
		this.cacheInvalidated = true;
		this.glyphCache.clear();
		this.stackingResolver.clear();
	}

	/**
	 * Get font metrics for a region
	 */
	getRegionMetrics(regionId: number): RegionFontMetrics | null {
		return this.regionMetrics.get(regionId) ?? null;
	}

	/**
	 * Get the element for a region
	 */
	getRegionElement(regionId: number): Element | null {
		return this.regionElements.get(regionId) ?? null;
	}

	/**
	 * Pack extracted glyphs for GPU upload
	 *
	 * @param glyphs - Extracted glyph data
	 * @returns Packed typed arrays for GPU
	 */
	packForGPU(glyphs: ExtendedGlyphData[]): ReturnType<GlyphExtractor['packForGPU']> {
		return this.extractor.packForGPU(glyphs);
	}

	/**
	 * Clean up resources
	 */
	destroy(): void {
		this.mutationObserver?.disconnect();
		this.resizeObserver?.disconnect();
		this.glyphCache.clear();
		this.regionElements.clear();
		this.regionMetrics.clear();
		this.stackingResolver.clear();
	}
}

/**
 * Create a GlyphFrameSynchronizer instance
 */
export function createGlyphFrameSynchronizer(
	device: GPUDevice,
	textureWidth: number,
	textureHeight: number,
	config?: Partial<GlyphSyncConfig>
): GlyphFrameSynchronizer {
	return new GlyphFrameSynchronizer(device, textureWidth, textureHeight, config);
}
