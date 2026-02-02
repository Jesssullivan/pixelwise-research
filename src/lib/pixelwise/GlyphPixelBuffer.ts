/**
 * GlyphPixelBuffer - Flat packed pixel buffer for WASM SIMD processing
 *
 * Implements the SharedArrayBuffer-based zero-copy transfer protocol
 * for pixel-level accessibility correction.
 *
 * V1 Memory Layout (for 10K pixels = ~141KB):
 * - Header: 64 bytes (magic, version, counts, offsets, flags)
 * - Coords: 80,000 bytes (Uint32Array[20,000] = [x0,y0, x1,y1, ...])
 * - Coverage: 10,000 bytes (Uint8Array[10,000] = glyph alpha)
 * - RegionIDs: 20,000 bytes (Uint16Array[10,000] = region index)
 * - RegionColors: 768 bytes (Uint8Array[768] = RGB per region)
 * - Output: 30,000 bytes (Uint8Array[30,000] = adjusted colors)
 *
 * V2 Extended Memory Layout (backward compatible):
 * - Header: 128 bytes (extended with DPR, dimensions, feature flags)
 * - CoordsFloat: maxPixels × 8 bytes (Float32Array = [x0,y0, ...] subpixel)
 * - ZIndices: maxPixels × 2 bytes (Uint16Array = z-index per pixel)
 * - ContextIds: maxPixels × 2 bytes (Uint16Array = stacking context ID)
 * - SubpixelOffsets: maxPixels × 4 bytes (Uint16Array = [fracX0,fracY0,...])
 * - FontMetrics: maxRegions × 24 bytes (Float32Array per region)
 * - StackingContexts: maxContexts × 8 bytes (context hierarchy)
 * - (V1 sections follow for backward compatibility)
 *
 * @module pixelwise/GlyphPixelBuffer
 */

/** SharedArrayBuffer header magic number: "GLYP" */
const MAGIC = 0x474c5950;

/** Current protocol version */
const VERSION = 1;

/** V2 Extended protocol version */
const VERSION_V2 = 2;

/** Header size in bytes */
const HEADER_SIZE = 64;

/** V2 Extended header size */
const HEADER_SIZE_V2 = 128;

/** Maximum supported regions (256 * 3 RGB = 768 bytes) */
const MAX_REGIONS = 256;

/** Maximum supported regions in V2 (65535) */
const MAX_REGIONS_V2 = 65535;

/** Maximum stacking contexts */
const MAX_STACKING_CONTEXTS = 256;

/** Feature flags for V2 */
export const FEATURE_FLAGS = {
	/** XYZ positioning enabled */
	XYZ_ENABLED: 0x01,
	/** Font metrics enabled */
	FONT_METRICS_ENABLED: 0x02,
	/** Stacking contexts enabled */
	STACKING_ENABLED: 0x04,
	/** Subpixel offsets enabled */
	SUBPIXEL_ENABLED: 0x08
} as const;

/** Synchronization flags for WASM coordination */
export const FLAGS = {
	/** TypeScript has written data, WASM can read */
	READY_FOR_WASM: 0x01,
	/** WASM is currently processing */
	WASM_PROCESSING: 0x02,
	/** WASM has finished, TypeScript can read output */
	WASM_COMPLETE: 0x04,
	/** Error occurred during processing */
	ERROR: 0x08
} as const;

/**
 * Header layout indices (Uint32Array offsets)
 */
const HEADER = {
	MAGIC: 0,
	VERSION: 1,
	PIXEL_COUNT: 2,
	REGION_COUNT: 3,
	COORDS_OFFSET: 4,
	COVERAGE_OFFSET: 5,
	REGION_ID_OFFSET: 6,
	COLORS_OFFSET: 7,
	OUTPUT_OFFSET: 8,
	FLAGS: 9
	// Reserved: 10-15
} as const;

/**
 * V2 Extended header layout indices (Uint32Array offsets)
 */
const HEADER_V2 = {
	MAGIC: 0,
	VERSION: 1,
	PIXEL_COUNT: 2,
	MAX_PIXELS: 3,
	REGION_COUNT: 4,
	FLAGS: 5,
	DPR_BITS: 6, // Float32 stored as Uint32 bits
	TEXTURE_WIDTH: 7,
	TEXTURE_HEIGHT: 8,
	STACKING_CONTEXT_COUNT: 9,
	FEATURE_FLAGS: 10,
	// Offsets for V2 sections
	COORDS_FLOAT_OFFSET: 11,
	Z_INDICES_OFFSET: 12,
	CONTEXT_IDS_OFFSET: 13,
	SUBPIXEL_OFFSETS_OFFSET: 14,
	FONT_METRICS_OFFSET: 15,
	STACKING_CONTEXTS_OFFSET: 16,
	// V1 compatibility offsets
	COORDS_OFFSET: 17,
	COVERAGE_OFFSET: 18,
	REGION_ID_OFFSET: 19,
	COLORS_OFFSET: 20,
	OUTPUT_OFFSET: 21
	// Reserved: 22-31
} as const;

/**
 * Typed views into the SharedArrayBuffer (V1)
 */
export interface GlyphPixelViews {
	/** Header for metadata and synchronization */
	header: Uint32Array;
	/** Int32 view for Atomics operations (same memory as header) */
	headerInt32: Int32Array;
	/** Pixel coordinates [x0, y0, x1, y1, ...] */
	coords: Uint32Array;
	/** Glyph coverage masks (0-255) */
	coverage: Uint8Array;
	/** Region ID per pixel */
	regionIds: Uint16Array;
	/** RGB color per region [R0, G0, B0, R1, G1, B1, ...] */
	regionColors: Uint8Array;
	/** Output buffer for adjusted colors */
	output: Uint8Array;
}

/**
 * V2 Extended typed views with XYZ positioning
 */
export interface GlyphPixelViewsV2 extends GlyphPixelViews {
	/** Subpixel float coordinates [x0, y0, x1, y1, ...] */
	coordsFloat: Float32Array;
	/** Z-indices per pixel */
	zIndices: Uint16Array;
	/** Stacking context IDs per pixel */
	contextIds: Uint16Array;
	/** Subpixel offsets [fracX0, fracY0, fracX1, fracY1, ...] as f16 stored in u16 */
	subpixelOffsets: Uint16Array;
	/** Font metrics per region [baseline, ascent, descent, lineH, em, flags, ...] */
	fontMetrics: Float32Array;
	/** Stacking context hierarchy [ctxId, parentId, baseZ, pad, ...] */
	stackingContexts: Uint32Array;
}

/**
 * Font metrics per region (24 bytes)
 */
export interface RegionFontMetrics {
	baseline: number;
	ascent: number;
	descent: number;
	lineHeight: number;
	emSize: number;
	flags: number;
}

/**
 * Stacking context entry (8 bytes aligned)
 */
export interface StackingContextEntry {
	contextId: number;
	parentId: number;
	baseZ: number;
}

/**
 * Calculate buffer size for given pixel capacity
 */
export function calculateBufferSize(maxPixels: number): number {
	const coordsSize = maxPixels * 2 * 4; // Uint32Array
	const coverageSize = maxPixels; // Uint8Array
	const regionIdSize = maxPixels * 2; // Uint16Array
	const colorsSize = MAX_REGIONS * 3; // RGB per region
	const outputSize = maxPixels * 3; // RGB per pixel

	return HEADER_SIZE + coordsSize + coverageSize + regionIdSize + colorsSize + outputSize;
}

/**
 * GlyphPixelBuffer - Zero-copy buffer for WASM SIMD processing
 *
 * Provides typed views into a SharedArrayBuffer that can be passed
 * directly to WASM without copying. Uses Atomics for synchronization.
 *
 * @example
 * ```typescript
 * const buffer = new GlyphPixelBuffer(10000);
 *
 * // Write pixel data
 * buffer.setPixelCount(numPixels);
 * buffer.coords.set(pixelCoords);
 * buffer.coverage.set(coverageMasks);
 *
 * // Signal WASM to process
 * buffer.signalReady();
 *
 * // Wait for completion
 * await buffer.waitForCompletion();
 *
 * // Read adjusted colors
 * const adjusted = buffer.output.slice(0, numPixels * 3);
 * ```
 */
export class GlyphPixelBuffer {
	/** Underlying SharedArrayBuffer */
	private sab: SharedArrayBuffer;

	/** Typed views into the buffer */
	private views: GlyphPixelViews;

	/** Maximum pixel capacity */
	readonly maxPixels: number;

	/**
	 * Create a new GlyphPixelBuffer
	 *
	 * @param maxPixels - Maximum number of pixels to support
	 * @throws Error if SharedArrayBuffer is not available
	 */
	constructor(maxPixels: number) {
		if (typeof SharedArrayBuffer === 'undefined') {
			throw new Error('SharedArrayBuffer not available. Ensure COOP/COEP headers are set.');
		}

		this.maxPixels = maxPixels;
		const size = calculateBufferSize(maxPixels);
		this.sab = new SharedArrayBuffer(size);

		// Calculate offsets
		let offset = HEADER_SIZE;
		const coordsOffset = offset;
		offset += maxPixels * 2 * 4;

		const coverageOffset = offset;
		offset += maxPixels;

		// Align to 2-byte boundary for Uint16Array
		if (offset % 2 !== 0) offset++;
		const regionIdOffset = offset;
		offset += maxPixels * 2;

		const colorsOffset = offset;
		offset += MAX_REGIONS * 3;

		const outputOffset = offset;

		// Create typed views
		this.views = {
			header: new Uint32Array(this.sab, 0, 16),
			headerInt32: new Int32Array(this.sab, 0, 16), // Same memory, for Atomics
			coords: new Uint32Array(this.sab, coordsOffset, maxPixels * 2),
			coverage: new Uint8Array(this.sab, coverageOffset, maxPixels),
			regionIds: new Uint16Array(this.sab, regionIdOffset, maxPixels),
			regionColors: new Uint8Array(this.sab, colorsOffset, MAX_REGIONS * 3),
			output: new Uint8Array(this.sab, outputOffset, maxPixels * 3)
		};

		// Initialize header
		this.views.header[HEADER.MAGIC] = MAGIC;
		this.views.header[HEADER.VERSION] = VERSION;
		this.views.header[HEADER.PIXEL_COUNT] = 0;
		this.views.header[HEADER.REGION_COUNT] = 0;
		this.views.header[HEADER.COORDS_OFFSET] = coordsOffset;
		this.views.header[HEADER.COVERAGE_OFFSET] = coverageOffset;
		this.views.header[HEADER.REGION_ID_OFFSET] = regionIdOffset;
		this.views.header[HEADER.COLORS_OFFSET] = colorsOffset;
		this.views.header[HEADER.OUTPUT_OFFSET] = outputOffset;
		this.views.header[HEADER.FLAGS] = 0;
	}

	/** Get the underlying SharedArrayBuffer for WASM */
	get buffer(): SharedArrayBuffer {
		return this.sab;
	}

	/** Get pixel coordinates view */
	get coords(): Uint32Array {
		return this.views.coords;
	}

	/** Get coverage masks view */
	get coverage(): Uint8Array {
		return this.views.coverage;
	}

	/** Get region IDs view */
	get regionIds(): Uint16Array {
		return this.views.regionIds;
	}

	/** Get region colors view */
	get regionColors(): Uint8Array {
		return this.views.regionColors;
	}

	/** Get output buffer view */
	get output(): Uint8Array {
		return this.views.output;
	}

	/** Get current pixel count */
	get pixelCount(): number {
		return Atomics.load(this.views.header, HEADER.PIXEL_COUNT);
	}

	/** Get current region count */
	get regionCount(): number {
		return Atomics.load(this.views.header, HEADER.REGION_COUNT);
	}

	/** Get current flags */
	get flags(): number {
		return Atomics.load(this.views.header, HEADER.FLAGS);
	}

	/**
	 * Set the number of active pixels
	 *
	 * @param count - Number of pixels in current frame
	 * @throws RangeError if count exceeds maxPixels
	 */
	setPixelCount(count: number): void {
		if (count > this.maxPixels) {
			throw new RangeError(`Pixel count ${count} exceeds capacity ${this.maxPixels}`);
		}
		Atomics.store(this.views.header, HEADER.PIXEL_COUNT, count);
	}

	/**
	 * Set the number of regions
	 *
	 * @param count - Number of text regions
	 * @throws RangeError if count exceeds MAX_REGIONS
	 */
	setRegionCount(count: number): void {
		if (count > MAX_REGIONS) {
			throw new RangeError(`Region count ${count} exceeds maximum ${MAX_REGIONS}`);
		}
		Atomics.store(this.views.header, HEADER.REGION_COUNT, count);
	}

	/**
	 * Signal that data is ready for WASM processing
	 *
	 * Uses Atomics for thread-safe signaling
	 */
	signalReady(): void {
		Atomics.store(this.views.headerInt32, HEADER.FLAGS, FLAGS.READY_FOR_WASM);
		Atomics.notify(this.views.headerInt32, HEADER.FLAGS);
	}

	/**
	 * Check if WASM processing is complete
	 */
	isComplete(): boolean {
		return (this.flags & FLAGS.WASM_COMPLETE) !== 0;
	}

	/**
	 * Check if an error occurred
	 */
	hasError(): boolean {
		return (this.flags & FLAGS.ERROR) !== 0;
	}

	/**
	 * Wait for WASM processing to complete
	 *
	 * Uses Atomics.waitAsync for non-blocking wait
	 *
	 * @param timeoutMs - Maximum wait time in milliseconds
	 * @returns Promise that resolves when complete
	 * @throws Error on timeout or processing error
	 */
	async waitForCompletion(timeoutMs: number = 5000): Promise<void> {
		const startTime = performance.now();

		while (!this.isComplete() && !this.hasError()) {
			if (performance.now() - startTime > timeoutMs) {
				throw new Error(`WASM processing timeout after ${timeoutMs}ms`);
			}

			// Use Atomics.waitAsync if available (Chrome 87+)
			if ('waitAsync' in Atomics) {
				const result = Atomics.waitAsync(
					this.views.headerInt32,
					HEADER.FLAGS,
					FLAGS.WASM_PROCESSING
				);
				if (result.async) {
					await Promise.race([
						result.value,
						new Promise((resolve) => setTimeout(resolve, 100))
					]);
				}
			} else {
				// Fallback to polling
				await new Promise((resolve) => setTimeout(resolve, 1));
			}
		}

		if (this.hasError()) {
			throw new Error('WASM processing failed');
		}
	}

	/**
	 * Reset flags for next frame
	 */
	reset(): void {
		Atomics.store(this.views.headerInt32, HEADER.FLAGS, 0);
	}

	/**
	 * Clear all pixel data (keeps capacity)
	 */
	clear(): void {
		this.setPixelCount(0);
		this.setRegionCount(0);
		this.reset();
	}

	/**
	 * Get adjusted colors for a specific pixel range
	 *
	 * @param startPixel - Start pixel index
	 * @param count - Number of pixels
	 * @returns Uint8Array with RGB values
	 */
	getAdjustedColors(startPixel: number, count: number): Uint8Array {
		const start = startPixel * 3;
		const end = start + count * 3;
		return this.views.output.slice(start, end);
	}

	/**
	 * Populate buffer from BrowserGlyphRasterizer results
	 *
	 * @param pixelCoords - [x0, y0, x1, y1, ...] viewport coordinates
	 * @param coverageMasks - Glyph alpha values (0-255)
	 * @param regionMap - Region index per pixel
	 * @param textColors - [R0, G0, B0, R1, G1, B1, ...] per region
	 */
	populate(
		pixelCoords: Uint32Array,
		coverageMasks: Uint8Array,
		regionMap: Uint16Array,
		textColors: Uint8Array
	): void {
		const pixelCount = coverageMasks.length;
		const regionCount = textColors.length / 3;

		this.setPixelCount(pixelCount);
		this.setRegionCount(regionCount);

		// Copy data into SharedArrayBuffer views
		this.views.coords.set(pixelCoords.subarray(0, pixelCount * 2));
		this.views.coverage.set(coverageMasks.subarray(0, pixelCount));
		this.views.regionIds.set(regionMap.subarray(0, pixelCount));
		this.views.regionColors.set(textColors.subarray(0, regionCount * 3));

		this.reset();
	}
}

/**
 * Create a GlyphPixelBuffer with sensible defaults
 *
 * @param estimatedPixels - Estimated pixel count (default 10000)
 * @returns GlyphPixelBuffer instance or null if SharedArrayBuffer unavailable
 */
export function createGlyphPixelBuffer(estimatedPixels: number = 10000): GlyphPixelBuffer | null {
	try {
		return new GlyphPixelBuffer(estimatedPixels);
	} catch {
		console.warn('SharedArrayBuffer not available, falling back to postMessage');
		return null;
	}
}

/**
 * Calculate V2 buffer size for given pixel capacity
 */
export function calculateBufferSizeV2(maxPixels: number, maxRegions: number = MAX_REGIONS_V2): number {
	// V2 sections
	const coordsFloatSize = maxPixels * 2 * 4; // Float32Array [x, y, ...]
	const zIndicesSize = maxPixels * 2; // Uint16Array
	const contextIdsSize = maxPixels * 2; // Uint16Array
	const subpixelOffsetsSize = maxPixels * 2 * 2; // Uint16Array [fracX, fracY, ...]
	const fontMetricsSize = maxRegions * 6 * 4; // 6 floats per region
	const stackingContextsSize = MAX_STACKING_CONTEXTS * 4 * 4; // 4 u32 per context

	// V1 sections (for backward compatibility)
	const coordsSize = maxPixels * 2 * 4; // Uint32Array
	const coverageSize = maxPixels; // Uint8Array
	const regionIdSize = maxPixels * 2; // Uint16Array
	const colorsSize = maxRegions * 3; // RGB per region
	const outputSize = maxPixels * 3; // RGB per pixel

	return (
		HEADER_SIZE_V2 +
		coordsFloatSize +
		zIndicesSize +
		contextIdsSize +
		subpixelOffsetsSize +
		fontMetricsSize +
		stackingContextsSize +
		coordsSize +
		coverageSize +
		regionIdSize +
		colorsSize +
		outputSize
	);
}

/**
 * GlyphPixelBufferV2 - Extended buffer with XYZ positioning support
 *
 * Backward compatible with V1 while adding:
 * - Subpixel float coordinates
 * - Z-index per pixel
 * - Stacking context IDs
 * - Font metrics per region
 * - Stacking context hierarchy
 */
export class GlyphPixelBufferV2 extends GlyphPixelBuffer {
	private sabV2: SharedArrayBuffer;
	private viewsV2: GlyphPixelViewsV2;
	private readonly _maxRegions: number;
	private _featureFlags: number;

	constructor(maxPixels: number, maxRegions: number = MAX_REGIONS_V2) {
		// Call parent with same maxPixels
		super(maxPixels);

		this._maxRegions = Math.min(maxRegions, MAX_REGIONS_V2);
		this._featureFlags = 0;

		// Create extended buffer
		const size = calculateBufferSizeV2(maxPixels, this._maxRegions);
		this.sabV2 = new SharedArrayBuffer(size);

		// Calculate V2 offsets
		let offset = HEADER_SIZE_V2;

		const coordsFloatOffset = offset;
		offset += maxPixels * 2 * 4;

		const zIndicesOffset = offset;
		offset += maxPixels * 2;

		const contextIdsOffset = offset;
		offset += maxPixels * 2;

		// Align to 4-byte boundary for Float32
		if (offset % 4 !== 0) offset += 4 - (offset % 4);
		const subpixelOffsetsOffset = offset;
		offset += maxPixels * 2 * 2;

		// Align to 4-byte boundary
		if (offset % 4 !== 0) offset += 4 - (offset % 4);
		const fontMetricsOffset = offset;
		offset += this._maxRegions * 6 * 4;

		// Align to 4-byte boundary
		if (offset % 4 !== 0) offset += 4 - (offset % 4);
		const stackingContextsOffset = offset;
		offset += MAX_STACKING_CONTEXTS * 4 * 4;

		// V1 sections
		const coordsOffset = offset;
		offset += maxPixels * 2 * 4;

		const coverageOffset = offset;
		offset += maxPixels;

		if (offset % 2 !== 0) offset++;
		const regionIdOffset = offset;
		offset += maxPixels * 2;

		const colorsOffset = offset;
		offset += this._maxRegions * 3;

		const outputOffset = offset;

		// Create V2 header
		const header = new Uint32Array(this.sabV2, 0, 32);
		const headerInt32 = new Int32Array(this.sabV2, 0, 32);

		// Initialize V2 header
		header[HEADER_V2.MAGIC] = MAGIC;
		header[HEADER_V2.VERSION] = VERSION_V2;
		header[HEADER_V2.PIXEL_COUNT] = 0;
		header[HEADER_V2.MAX_PIXELS] = maxPixels;
		header[HEADER_V2.REGION_COUNT] = 0;
		header[HEADER_V2.FLAGS] = 0;
		header[HEADER_V2.DPR_BITS] = floatToUint32Bits(1.0);
		header[HEADER_V2.TEXTURE_WIDTH] = 0;
		header[HEADER_V2.TEXTURE_HEIGHT] = 0;
		header[HEADER_V2.STACKING_CONTEXT_COUNT] = 0;
		header[HEADER_V2.FEATURE_FLAGS] = 0;
		header[HEADER_V2.COORDS_FLOAT_OFFSET] = coordsFloatOffset;
		header[HEADER_V2.Z_INDICES_OFFSET] = zIndicesOffset;
		header[HEADER_V2.CONTEXT_IDS_OFFSET] = contextIdsOffset;
		header[HEADER_V2.SUBPIXEL_OFFSETS_OFFSET] = subpixelOffsetsOffset;
		header[HEADER_V2.FONT_METRICS_OFFSET] = fontMetricsOffset;
		header[HEADER_V2.STACKING_CONTEXTS_OFFSET] = stackingContextsOffset;
		header[HEADER_V2.COORDS_OFFSET] = coordsOffset;
		header[HEADER_V2.COVERAGE_OFFSET] = coverageOffset;
		header[HEADER_V2.REGION_ID_OFFSET] = regionIdOffset;
		header[HEADER_V2.COLORS_OFFSET] = colorsOffset;
		header[HEADER_V2.OUTPUT_OFFSET] = outputOffset;

		// Create V2 views
		this.viewsV2 = {
			header,
			headerInt32,
			coordsFloat: new Float32Array(this.sabV2, coordsFloatOffset, maxPixels * 2),
			zIndices: new Uint16Array(this.sabV2, zIndicesOffset, maxPixels),
			contextIds: new Uint16Array(this.sabV2, contextIdsOffset, maxPixels),
			subpixelOffsets: new Uint16Array(this.sabV2, subpixelOffsetsOffset, maxPixels * 2),
			fontMetrics: new Float32Array(this.sabV2, fontMetricsOffset, this._maxRegions * 6),
			stackingContexts: new Uint32Array(this.sabV2, stackingContextsOffset, MAX_STACKING_CONTEXTS * 4),
			// V1 compatible views
			coords: new Uint32Array(this.sabV2, coordsOffset, maxPixels * 2),
			coverage: new Uint8Array(this.sabV2, coverageOffset, maxPixels),
			regionIds: new Uint16Array(this.sabV2, regionIdOffset, maxPixels),
			regionColors: new Uint8Array(this.sabV2, colorsOffset, this._maxRegions * 3),
			output: new Uint8Array(this.sabV2, outputOffset, maxPixels * 3)
		};
	}

	/** Get the V2 buffer */
	get bufferV2(): SharedArrayBuffer {
		return this.sabV2;
	}

	/** Protocol version */
	get version(): number {
		return VERSION_V2;
	}

	/** Maximum regions supported */
	get maxRegions(): number {
		return this._maxRegions;
	}

	/** Get subpixel float coordinates */
	get coordsFloat(): Float32Array {
		return this.viewsV2.coordsFloat;
	}

	/** Get z-indices */
	get zIndices(): Uint16Array {
		return this.viewsV2.zIndices;
	}

	/** Get stacking context IDs */
	get contextIds(): Uint16Array {
		return this.viewsV2.contextIds;
	}

	/** Get subpixel offsets */
	get subpixelOffsets(): Uint16Array {
		return this.viewsV2.subpixelOffsets;
	}

	/** Get font metrics array */
	get fontMetrics(): Float32Array {
		return this.viewsV2.fontMetrics;
	}

	/** Get stacking contexts array */
	get stackingContexts(): Uint32Array {
		return this.viewsV2.stackingContexts;
	}

	/** Check if XYZ positioning is enabled */
	hasXYZPositioning(): boolean {
		return (this._featureFlags & FEATURE_FLAGS.XYZ_ENABLED) !== 0;
	}

	/** Check if font metrics are enabled */
	hasFontMetrics(): boolean {
		return (this._featureFlags & FEATURE_FLAGS.FONT_METRICS_ENABLED) !== 0;
	}

	/** Set DPR value */
	setDPR(dpr: number): void {
		Atomics.store(this.viewsV2.header, HEADER_V2.DPR_BITS, floatToUint32Bits(dpr));
	}

	/** Get DPR value */
	getDPR(): number {
		return uint32BitsToFloat(Atomics.load(this.viewsV2.header, HEADER_V2.DPR_BITS));
	}

	/** Set texture dimensions */
	setTextureDimensions(width: number, height: number): void {
		Atomics.store(this.viewsV2.header, HEADER_V2.TEXTURE_WIDTH, width);
		Atomics.store(this.viewsV2.header, HEADER_V2.TEXTURE_HEIGHT, height);
	}

	/** Set stacking context count */
	setStackingContextCount(count: number): void {
		Atomics.store(this.viewsV2.header, HEADER_V2.STACKING_CONTEXT_COUNT, Math.min(count, MAX_STACKING_CONTEXTS));
	}

	/** Get stacking context count */
	get stackingContextCount(): number {
		return Atomics.load(this.viewsV2.header, HEADER_V2.STACKING_CONTEXT_COUNT);
	}

	/** Enable/disable feature flags */
	setFeatureFlags(flags: number): void {
		this._featureFlags = flags;
		Atomics.store(this.viewsV2.header, HEADER_V2.FEATURE_FLAGS, flags);
	}

	/** Get feature flags */
	get featureFlags(): number {
		return Atomics.load(this.viewsV2.header, HEADER_V2.FEATURE_FLAGS);
	}

	/**
	 * Set font metrics for a region
	 */
	setRegionFontMetrics(regionId: number, metrics: RegionFontMetrics): void {
		if (regionId >= this._maxRegions) return;
		const offset = regionId * 6;
		this.viewsV2.fontMetrics[offset] = metrics.baseline;
		this.viewsV2.fontMetrics[offset + 1] = metrics.ascent;
		this.viewsV2.fontMetrics[offset + 2] = metrics.descent;
		this.viewsV2.fontMetrics[offset + 3] = metrics.lineHeight;
		this.viewsV2.fontMetrics[offset + 4] = metrics.emSize;
		this.viewsV2.fontMetrics[offset + 5] = metrics.flags;
	}

	/**
	 * Set a stacking context entry
	 */
	setStackingContext(index: number, entry: StackingContextEntry): void {
		if (index >= MAX_STACKING_CONTEXTS) return;
		const offset = index * 4;
		this.viewsV2.stackingContexts[offset] = entry.contextId;
		this.viewsV2.stackingContexts[offset + 1] = entry.parentId;
		// Store signed z as unsigned
		this.viewsV2.stackingContexts[offset + 2] = (entry.baseZ + 2147483648) >>> 0;
		this.viewsV2.stackingContexts[offset + 3] = 0; // padding
	}

	/**
	 * Populate V2 buffer with extended glyph data
	 */
	populateV2(data: {
		/** Subpixel X coordinates */
		x: Float32Array;
		/** Subpixel Y coordinates */
		y: Float32Array;
		/** Fractional X offsets [0, 1) */
		fracX: Float32Array;
		/** Fractional Y offsets [0, 1) */
		fracY: Float32Array;
		/** Z-indices (already shifted to unsigned) */
		zIndices: Uint16Array;
		/** Stacking context IDs */
		contextIds: Uint16Array;
		/** Coverage values */
		coverage: Uint8Array;
		/** Region IDs */
		regionIds: Uint16Array;
		/** Region colors RGB */
		regionColors: Uint8Array;
	}): void {
		const pixelCount = data.coverage.length;
		const regionCount = data.regionColors.length / 3;

		// Set counts
		Atomics.store(this.viewsV2.header, HEADER_V2.PIXEL_COUNT, pixelCount);
		Atomics.store(this.viewsV2.header, HEADER_V2.REGION_COUNT, regionCount);

		// Copy V2 data
		for (let i = 0; i < pixelCount; i++) {
			this.viewsV2.coordsFloat[i * 2] = data.x[i];
			this.viewsV2.coordsFloat[i * 2 + 1] = data.y[i];
			this.viewsV2.zIndices[i] = data.zIndices[i];
			this.viewsV2.contextIds[i] = data.contextIds[i];
			// Store fractional offsets as f16 (simplified: just multiply by 65535)
			this.viewsV2.subpixelOffsets[i * 2] = Math.round(data.fracX[i] * 65535);
			this.viewsV2.subpixelOffsets[i * 2 + 1] = Math.round(data.fracY[i] * 65535);
		}

		// Copy V1-compatible data
		for (let i = 0; i < pixelCount; i++) {
			this.viewsV2.coords[i * 2] = Math.floor(data.x[i]);
			this.viewsV2.coords[i * 2 + 1] = Math.floor(data.y[i]);
		}
		this.viewsV2.coverage.set(data.coverage.subarray(0, pixelCount));
		this.viewsV2.regionIds.set(data.regionIds.subarray(0, pixelCount));
		this.viewsV2.regionColors.set(data.regionColors.subarray(0, regionCount * 3));

		// Enable XYZ feature flag
		this.setFeatureFlags(this._featureFlags | FEATURE_FLAGS.XYZ_ENABLED | FEATURE_FLAGS.SUBPIXEL_ENABLED);
	}
}

/**
 * Create a V2 GlyphPixelBuffer with extended features
 */
export function createGlyphPixelBufferV2(maxPixels: number = 10000, maxRegions: number = MAX_REGIONS_V2): GlyphPixelBufferV2 | null {
	try {
		return new GlyphPixelBufferV2(maxPixels, maxRegions);
	} catch {
		console.warn('SharedArrayBuffer not available for V2 buffer');
		return null;
	}
}

/**
 * Helper: Convert float to uint32 bits (for header storage)
 */
function floatToUint32Bits(f: number): number {
	const buf = new ArrayBuffer(4);
	new Float32Array(buf)[0] = f;
	return new Uint32Array(buf)[0];
}

/**
 * Helper: Convert uint32 bits back to float
 */
function uint32BitsToFloat(u: number): number {
	const buf = new ArrayBuffer(4);
	new Uint32Array(buf)[0] = u;
	return new Float32Array(buf)[0];
}
