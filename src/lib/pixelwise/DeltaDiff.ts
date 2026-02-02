/**
 * DeltaDiff - Frame-to-frame change detection for pixelwise compositor
 *
 * Implements hash-based change detection to minimize unnecessary
 * resampling and WASM processing. Only changed regions are processed.
 *
 * Delta Categories:
 * - NO_CHANGE: Skip entirely, use cached adjustments
 * - POSITION_ONLY: Transform cached, don't recompute
 * - BG_CHANGED: Recompute contrast, reuse glyph masks
 * - TEXT_CHANGED: Re-rasterize glyphs + full recompute
 * - NEW_ELEMENT: Full rasterization + computation
 * - ELEMENT_REMOVED: Remove from cache
 *
 * @module pixelwise/DeltaDiff
 */

/** Delta category enum for change classification */
export enum DeltaCategory {
	/** No change detected - use cached results */
	NO_CHANGE = 0,
	/** Only position changed - transform cached results */
	POSITION_ONLY = 1,
	/** Background changed - recompute contrast, reuse masks */
	BG_CHANGED = 2,
	/** Text content changed - full re-rasterization needed */
	TEXT_CHANGED = 3,
	/** New element appeared */
	NEW_ELEMENT = 4,
	/** Element was removed */
	ELEMENT_REMOVED = 5
}

/**
 * Cached element state for change detection
 */
export interface ElementCacheEntry {
	/** Unique element identifier (from data attribute or generated) */
	id: string;
	/** Rasterized glyph coverage mask */
	glyphMask: Uint8Array;
	/** Viewport pixel coordinates [x0, y0, x1, y1, ...] */
	pixelCoords: Uint32Array;
	/** Last computed adjusted colors */
	adjustedColors: Uint8Array;
	/** Content hash (text + font) */
	contentHash: bigint;
	/** Position hash (x, y, w, h rounded to 4px grid) */
	positionHash: number;
	/** Background sample hash */
	bgHash: number;
	/** Last frame this entry was used */
	lastFrameUsed: number;
	/** Number of violations detected last time */
	violationCount: number;
}

/**
 * 16x16 spatial grid for background change detection
 */
export interface BackgroundGrid {
	/** Average RGB per grid cell (16x16 = 256 cells × 3 channels) */
	cells: Uint8Array;
	/** Hash of entire grid for quick comparison */
	gridHash: bigint;
	/** Viewport dimensions when grid was computed */
	viewportWidth: number;
	viewportHeight: number;
}

/**
 * Result of delta detection for a single element
 */
export interface ElementDelta {
	/** Element identifier */
	id: string;
	/** Type of change detected */
	category: DeltaCategory;
	/** Cached entry if available */
	cachedEntry?: ElementCacheEntry;
	/** New element data if needed */
	newData?: {
		bounds: DOMRect;
		textContent: string;
		font: string;
		color: string;
	};
}

/**
 * Frame-level delta detection result
 */
export interface FrameDelta {
	/** Total elements in current frame */
	totalElements: number;
	/** Elements that need processing */
	changedElements: ElementDelta[];
	/** Elements with NO_CHANGE (skip) */
	unchangedCount: number;
	/** Background grid changed */
	backgroundChanged: boolean;
	/** Cache hit rate (0-1) */
	cacheHitRate: number;
}

/**
 * Simple hash function for strings
 * Uses FNV-1a for speed with decent distribution
 */
function hashString(str: string): bigint {
	let hash = BigInt(0x811c9dc5);
	for (let i = 0; i < str.length; i++) {
		hash ^= BigInt(str.charCodeAt(i));
		hash = BigInt.asUintN(64, hash * BigInt(0x01000193));
	}
	return hash;
}

/**
 * Hash position data (rounded to 4px grid for tolerance)
 */
function hashPosition(x: number, y: number, w: number, h: number): number {
	const gridX = Math.floor(x / 4);
	const gridY = Math.floor(y / 4);
	const gridW = Math.floor(w / 4);
	const gridH = Math.floor(h / 4);
	return ((gridX & 0xffff) << 16) | ((gridY & 0xffff) ^ ((gridW & 0xff) << 8) ^ (gridH & 0xff));
}

/**
 * Hash RGB samples for background detection
 */
function hashRgbSamples(samples: Uint8Array): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < samples.length; i++) {
		hash ^= samples[i];
		hash = (hash * 0x01000193) >>> 0;
	}
	return hash;
}

/**
 * DeltaDiff - Manages frame-to-frame change detection
 *
 * @example
 * ```typescript
 * const deltaDiff = new DeltaDiff();
 *
 * // Each frame:
 * const elements = document.querySelectorAll('p, h1, span');
 * const bgGrid = sampleBackgroundGrid(canvas);
 *
 * const delta = deltaDiff.detectChanges(elements, bgGrid);
 *
 * // Only process changed elements
 * for (const change of delta.changedElements) {
 *   if (change.category !== DeltaCategory.NO_CHANGE) {
 *     processElement(change);
 *   }
 * }
 *
 * // Update cache with new results
 * deltaDiff.updateCache(processedResults);
 * ```
 */
export class DeltaDiff {
	/** Per-element cache */
	private elementCache: Map<string, ElementCacheEntry> = new Map();

	/** Previous frame's background grid */
	private prevBgGrid: BackgroundGrid | null = null;

	/** Current frame number */
	private frameNumber: number = 0;

	/** LRU eviction threshold (frames) */
	private readonly lruThreshold: number;

	/** Maximum cache entries */
	private readonly maxCacheSize: number;

	/**
	 * Create a new DeltaDiff instance
	 *
	 * @param options - Configuration options
	 */
	constructor(
		options: {
			/** Maximum number of cached elements (default: 500) */
			maxCacheSize?: number;
			/** Frames before LRU eviction (default: 60) */
			lruThreshold?: number;
		} = {}
	) {
		this.maxCacheSize = options.maxCacheSize ?? 500;
		this.lruThreshold = options.lruThreshold ?? 60;
	}

	/**
	 * Detect changes between current frame and cached state
	 *
	 * @param elements - Current frame's text elements
	 * @param bgGrid - Current background grid sample
	 * @returns Frame delta with change classification
	 */
	detectChanges(elements: NodeListOf<Element> | Element[], bgGrid: BackgroundGrid): FrameDelta {
		this.frameNumber++;
		const changedElements: ElementDelta[] = [];
		let unchangedCount = 0;

		// Check if background changed
		const backgroundChanged = this.hasBackgroundChanged(bgGrid);

		// Track which cached entries are still in use
		const seenIds = new Set<string>();

		// Process each element
		for (const element of elements) {
			const id = this.getElementId(element);
			seenIds.add(id);

			const cached = this.elementCache.get(id);
			const elementData = this.extractElementData(element);

			if (!cached) {
				// New element
				changedElements.push({
					id,
					category: DeltaCategory.NEW_ELEMENT,
					newData: elementData
				});
				continue;
			}

			// Calculate current hashes
			const contentHash = hashString(elementData.textContent + elementData.font);
			const positionHash = hashPosition(
				elementData.bounds.x,
				elementData.bounds.y,
				elementData.bounds.width,
				elementData.bounds.height
			);

			// Compare with cached hashes
			const category = this.classifyChange(
				cached,
				contentHash,
				positionHash,
				backgroundChanged
			);

			if (category === DeltaCategory.NO_CHANGE) {
				// Update last used frame
				cached.lastFrameUsed = this.frameNumber;
				unchangedCount++;
			} else {
				changedElements.push({
					id,
					category,
					cachedEntry: cached,
					newData: elementData
				});
			}
		}

		// Find removed elements
		for (const [id, entry] of this.elementCache) {
			if (!seenIds.has(id)) {
				changedElements.push({
					id,
					category: DeltaCategory.ELEMENT_REMOVED,
					cachedEntry: entry
				});
			}
		}

		// Update background grid reference
		this.prevBgGrid = bgGrid;

		// Calculate cache hit rate
		const totalElements = elements.length;
		const cacheHitRate = totalElements > 0 ? unchangedCount / totalElements : 0;

		return {
			totalElements,
			changedElements,
			unchangedCount,
			backgroundChanged,
			cacheHitRate
		};
	}

	/**
	 * Update cache with newly processed results
	 *
	 * @param results - Processed element results
	 */
	updateCache(
		results: Array<{
			id: string;
			glyphMask: Uint8Array;
			pixelCoords: Uint32Array;
			adjustedColors: Uint8Array;
			contentHash: bigint;
			positionHash: number;
			bgHash: number;
			violationCount: number;
		}>
	): void {
		for (const result of results) {
			this.elementCache.set(result.id, {
				...result,
				lastFrameUsed: this.frameNumber
			});
		}

		// LRU eviction
		this.evictStaleEntries();
	}

	/**
	 * Remove an element from cache
	 *
	 * @param id - Element identifier
	 */
	removeFromCache(id: string): void {
		this.elementCache.delete(id);
	}

	/**
	 * Clear all cached data
	 */
	clearCache(): void {
		this.elementCache.clear();
		this.prevBgGrid = null;
		this.frameNumber = 0;
	}

	/**
	 * Get cache statistics
	 */
	getStats(): {
		cacheSize: number;
		frameNumber: number;
		oldestEntry: number;
	} {
		let oldestEntry = this.frameNumber;
		for (const entry of this.elementCache.values()) {
			if (entry.lastFrameUsed < oldestEntry) {
				oldestEntry = entry.lastFrameUsed;
			}
		}

		return {
			cacheSize: this.elementCache.size,
			frameNumber: this.frameNumber,
			oldestEntry
		};
	}

	/**
	 * Get unique identifier for an element
	 */
	private getElementId(element: Element): string {
		// Try data attribute first
		const dataId = element.getAttribute('data-pixelwise-id');
		if (dataId) return dataId;

		// Try id attribute
		if (element.id) return `id:${element.id}`;

		// Generate based on position in DOM
		const path: string[] = [];
		let current: Element | null = element;
		while (current && current !== document.body) {
			const parent = current.parentElement;
			if (parent) {
				const index = Array.from(parent.children).indexOf(current);
				path.unshift(`${current.tagName}[${index}]`);
			}
			current = parent;
		}
		return `path:${path.join('/')}`;
	}

	/**
	 * Extract element data for hashing and processing
	 */
	private extractElementData(element: Element): {
		bounds: DOMRect;
		textContent: string;
		font: string;
		color: string;
	} {
		const bounds = element.getBoundingClientRect();
		const textContent = element.textContent ?? '';
		const style = window.getComputedStyle(element);
		const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
		const color = style.color;

		return { bounds, textContent, font, color };
	}

	/**
	 * Check if background grid changed significantly
	 */
	private hasBackgroundChanged(current: BackgroundGrid): boolean {
		if (!this.prevBgGrid) return true;

		// Quick hash comparison
		if (current.gridHash !== this.prevBgGrid.gridHash) {
			return true;
		}

		// Viewport size changed
		if (
			current.viewportWidth !== this.prevBgGrid.viewportWidth ||
			current.viewportHeight !== this.prevBgGrid.viewportHeight
		) {
			return true;
		}

		return false;
	}

	/**
	 * Classify the type of change for an element
	 */
	private classifyChange(
		cached: ElementCacheEntry,
		contentHash: bigint,
		positionHash: number,
		backgroundChanged: boolean
	): DeltaCategory {
		// Content changed = full re-rasterization
		if (cached.contentHash !== contentHash) {
			return DeltaCategory.TEXT_CHANGED;
		}

		// Background changed = recompute contrast
		if (backgroundChanged) {
			return DeltaCategory.BG_CHANGED;
		}

		// Position changed = transform cached
		if (cached.positionHash !== positionHash) {
			return DeltaCategory.POSITION_ONLY;
		}

		// Nothing changed
		return DeltaCategory.NO_CHANGE;
	}

	/**
	 * Evict stale entries using LRU
	 */
	private evictStaleEntries(): void {
		// Remove entries not used recently
		const evictionThreshold = this.frameNumber - this.lruThreshold;
		for (const [id, entry] of this.elementCache) {
			if (entry.lastFrameUsed < evictionThreshold) {
				this.elementCache.delete(id);
			}
		}

		// If still over limit, remove oldest entries
		if (this.elementCache.size > this.maxCacheSize) {
			const entries = Array.from(this.elementCache.entries()).sort(
				(a, b) => a[1].lastFrameUsed - b[1].lastFrameUsed
			);

			const toRemove = entries.slice(0, entries.length - this.maxCacheSize);
			for (const [id] of toRemove) {
				this.elementCache.delete(id);
			}
		}
	}
}

/**
 * Sample background into 16x16 grid for change detection
 *
 * @param canvas - Canvas with background content
 * @returns BackgroundGrid for delta detection
 */
export function sampleBackgroundGrid(canvas: HTMLCanvasElement): BackgroundGrid {
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		throw new Error('Cannot get canvas 2D context');
	}

	const width = canvas.width;
	const height = canvas.height;
	const cellWidth = Math.ceil(width / 16);
	const cellHeight = Math.ceil(height / 16);

	const cells = new Uint8Array(256 * 3);

	for (let cy = 0; cy < 16; cy++) {
		for (let cx = 0; cx < 16; cx++) {
			const x = cx * cellWidth + Math.floor(cellWidth / 2);
			const y = cy * cellHeight + Math.floor(cellHeight / 2);

			// Sample center of cell
			const imageData = ctx.getImageData(
				Math.min(x, width - 1),
				Math.min(y, height - 1),
				1,
				1
			);

			const cellIndex = cy * 16 + cx;
			cells[cellIndex * 3] = imageData.data[0];
			cells[cellIndex * 3 + 1] = imageData.data[1];
			cells[cellIndex * 3 + 2] = imageData.data[2];
		}
	}

	const gridHash = BigInt(hashRgbSamples(cells));

	return {
		cells,
		gridHash,
		viewportWidth: width,
		viewportHeight: height
	};
}

/**
 * Create background grid from WebGL framebuffer
 *
 * @param gl - WebGL2 context
 * @returns BackgroundGrid for delta detection
 */
export function sampleBackgroundGridWebGL(gl: WebGL2RenderingContext): BackgroundGrid {
	const width = gl.drawingBufferWidth;
	const height = gl.drawingBufferHeight;
	const cellWidth = Math.ceil(width / 16);
	const cellHeight = Math.ceil(height / 16);

	const cells = new Uint8Array(256 * 3);
	const pixel = new Uint8Array(4);

	for (let cy = 0; cy < 16; cy++) {
		for (let cx = 0; cx < 16; cx++) {
			const x = cx * cellWidth + Math.floor(cellWidth / 2);
			const y = cy * cellHeight + Math.floor(cellHeight / 2);

			// WebGL readPixels (note: Y is flipped)
			gl.readPixels(
				Math.min(x, width - 1),
				height - Math.min(y, height - 1) - 1,
				1,
				1,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				pixel
			);

			const cellIndex = cy * 16 + cx;
			cells[cellIndex * 3] = pixel[0];
			cells[cellIndex * 3 + 1] = pixel[1];
			cells[cellIndex * 3 + 2] = pixel[2];
		}
	}

	const gridHash = BigInt(hashRgbSamples(cells));

	return {
		cells,
		gridHash,
		viewportWidth: width,
		viewportHeight: height
	};
}
