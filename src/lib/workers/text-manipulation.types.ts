/**
 * Worker Message Types for Text Manipulation WASM Worker
 *
 * Defines the communication protocol between main thread and web worker
 * for WASM-based text contrast adjustment using Futhark.
 *
 * @see futhark/esdt.fut - ESDT algorithm
 * @see futhark/wcag.fut - WCAG calculations
 */

/**
 * Message types for worker communication
 */
export enum MessageType {
	/** Initialize WASM module */
	Init = 'init',
	/** Ping/pong health check */
	Ping = 'ping',
	/** Process glyph pixels using monadic SIMD pipeline (primary API) */
	ProcessGlyphPixels = 'process_glyph_pixels',
	/** Process pixels with SIMD (direct SIMD call) */
	ProcessPixelsSIMD = 'process_pixels_simd',
	/** Batch luminance calculation (SIMD) */
	BatchLuminance = 'batch_luminance',
	/** Batch contrast ratio calculation (SIMD) */
	BatchContrast = 'batch_contrast',
	/** Kernel density estimation from glyph pixels */
	KernelDensity = 'kernel_density',
	/** Dispose worker resources */
	Dispose = 'dispose',

	// ===== ESDT Algorithm =====
	/** Compute Extended Signed Distance Transform (real verified algorithm, 14 tests) */
	ComputeESDT = 'compute_esdt',
	/** Extract glyph pixels from ESDT data */
	ExtractGlyphPixels = 'extract_glyph_pixels',

	// ===== WebGPU Direct Memory Binding (Zero-Copy) =====
	/** Bind SharedArrayBuffer for direct WASM access (WebGPU zero-copy path) */
	BindSharedBuffer = 'bind_shared_buffer',
	/** Process in-place on bound SharedArrayBuffer (no postMessage copies) */
	ProcessSharedBuffer = 'process_shared_buffer',
	/** Get WASM memory info for main thread direct access */
	GetMemoryInfo = 'get_memory_info',

	// Backwards compatibility aliases (deprecated)
	/** @deprecated Use ProcessGlyphPixels instead */
	SampleAndAdjust = 'sample_and_adjust',
	/** @deprecated Use ProcessGlyphPixels instead */
	SparseAdjust = 'sparse_adjust',
	/** @deprecated Use ProcessPixelsSIMD instead */
	PerPixelAdjust = 'per_pixel_adjust'
}

/**
 * Payload for ProcessGlyphPixels operation (PRIMARY API)
 *
 * This is the main entry point for the monadic SIMD pipeline:
 * 1. Kernel density estimation (OUTWARD from glyphs)
 * 2. Inverse density violation detection (edge-weighted)
 * 3. Color adjustment (hue-preserving)
 */
export interface ProcessGlyphPixelsPayload {
	/** Glyph pixel coordinates [x0, y0, x1, y1, ...] */
	pixelCoords: Uint32Array;
	/** Glyph coverage per pixel (0-255, from rasterization) */
	coverage: Uint8Array;
	/** Which region each pixel belongs to */
	regionIds: Uint16Array;
	/** Text color per region [R0, G0, B0, R1, G1, B1, ...] */
	textColors: Uint8Array;
	/** Full background pixel buffer (RGB, 3 bytes per pixel) */
	bgPixels: Uint8Array;
	/** Background buffer width */
	bgWidth: number;
	/** Background buffer height */
	bgHeight: number;
	/** Target WCAG contrast ratio (e.g., 4.5 for AA, 7.0 for AAA) */
	targetContrast: number;
}

/**
 * Payload for ProcessPixelsSIMD operation
 *
 * Parallel processing via Futhark WASM multicore.
 * Note: Despite the name, Futhark uses pthreads/Web Workers, not v128 SIMD.
 */
export interface ProcessPixelsSIMDPayload {
	/** Pixel coordinates [x0, y0, x1, y1, ...] */
	pixelCoords: Uint32Array;
	/** Coverage masks (0-255) */
	coverage: Uint8Array;
	/** Region index for each pixel */
	regionIds: Uint16Array;
	/** Text color per region [R, G, B, ...] */
	regionColors: Uint8Array;
	/** Background pixel buffer (RGB) */
	bgPixels: Uint8Array;
	/** Background width */
	bgWidth: number;
	/** Background height */
	bgHeight: number;
	/** Target contrast ratio */
	targetContrast: number;
}

/**
 * Payload for BatchLuminance operation
 */
export interface BatchLuminancePayload {
	/** RGB data [R0, G0, B0, R1, G1, B1, ...] */
	rgbData: Uint8Array;
}

/**
 * Payload for BatchContrast operation
 */
export interface BatchContrastPayload {
	/** Text RGB data [R0, G0, B0, ...] */
	textRgb: Uint8Array;
	/** Background RGB data [R0, G0, B0, ...] */
	bgRgb: Uint8Array;
}

/**
 * Payload for KernelDensity operation
 */
export interface KernelDensityPayload {
	/** Pixel coordinates [x0, y0, x1, y1, ...] */
	pixelCoords: Uint32Array;
	/** Coverage values (0-255) */
	coverage: Uint8Array;
	/** Background pixel buffer (RGB) */
	bgPixels: Uint8Array;
	/** Background width */
	bgWidth: number;
	/** Background height */
	bgHeight: number;
}

/**
 * Payload for ComputeESDT operation
 *
 * Computes the Extended Signed Distance Transform using the Futhark
 * implementation.
 *
 * @see futhark/esdt.fut - compute_esdt_2d()
 */
export interface ComputeESDTPayload {
	/** Grayscale levels [0.0-1.0], row-major order */
	levels: Float32Array;
	/** Image width in pixels */
	width: number;
	/** Image height in pixels */
	height: number;
	/** Whether to use relaxation pass for smoother gradients */
	useRelaxation: boolean;
}

/**
 * Payload for ExtractGlyphPixels operation
 */
export interface ExtractGlyphPixelsPayload {
	/** ESDT data [Δx₀, Δy₀, Δx₁, Δy₁, ...] from ComputeESDT */
	esdtData: Float32Array;
	/** Image width */
	width: number;
	/** Image height */
	height: number;
	/** Maximum distance for pixel inclusion */
	maxDistance: number;
}

// ============================================================================
// WebGPU Direct Memory Binding Types (Zero-Copy Architecture)
// ============================================================================

/**
 * Payload for BindSharedBuffer operation
 *
 * Binds a SharedArrayBuffer for direct WASM access.
 * This enables true zero-copy processing with WebGPU:
 * 1. WebGPU maps buffer → SharedArrayBuffer
 * 2. SharedArrayBuffer passed to worker (no copy!)
 * 3. WASM writes directly to SharedArrayBuffer
 * 4. WebGPU unmaps buffer → GPU has modified data
 */
export interface BindSharedBufferPayload {
	/** SharedArrayBuffer to bind (from WebGPU getMappedRange) */
	buffer: SharedArrayBuffer;
	/** Buffer width in pixels */
	width: number;
	/** Buffer height in pixels */
	height: number;
	/** Bytes per pixel (typically 4 for RGBA) */
	bytesPerPixel: number;
	/** Target WCAG contrast ratio */
	targetContrast: number;
}

/**
 * Payload for ProcessSharedBuffer operation
 *
 * Processes the previously bound SharedArrayBuffer in-place.
 * No data is copied - WASM writes directly to GPU-mapped memory.
 */
export interface ProcessSharedBufferPayload {
	/** Glyph pixel coordinates [x0, y0, x1, y1, ...] */
	pixelCoords: Uint32Array;
	/** Glyph coverage per pixel (0-255) */
	coverage: Uint8Array;
	/** Region IDs for each pixel */
	regionIds: Uint16Array;
	/** Text color per region [R, G, B, ...] */
	textColors: Uint8Array;
	/** Number of regions */
	regionCount: number;
}

/**
 * Result for BindSharedBuffer operation
 */
export interface BindSharedBufferResult {
	/** Whether binding succeeded */
	bound: boolean;
	/** Buffer dimensions */
	width: number;
	height: number;
	/** Total buffer size in bytes */
	bufferSize: number;
}

/**
 * Result for ProcessSharedBuffer operation
 */
export interface ProcessSharedBufferResult {
	/** Number of pixels processed */
	pixelsProcessed: number;
	/** Number of violations found and adjusted */
	violationsAdjusted: number;
	/** Processing time in milliseconds */
	processingTimeMs: number;
}

/**
 * Result for GetMemoryInfo operation
 */
export interface GetMemoryInfoResult {
	/** Whether WASM is initialized */
	initialized: boolean;
	/** Whether SIMD is available */
	simdAvailable: boolean;
	/** WASM linear memory size in bytes */
	memorySize: number;
	/** Maximum pixels supported */
	maxPixels: number;
	/** Maximum regions supported */
	maxRegions: number;
	/** Maximum background width */
	maxBgWidth: number;
	/** Maximum background height */
	maxBgHeight: number;
}

/**
 * Message sent from main thread to worker
 */
export interface WorkerMessage {
	/** Message type identifier */
	type: MessageType;
	/** Unique message ID for request/response matching */
	id: number;
	/** Message-specific payload */
	payload: unknown;
}

/**
 * Response sent from worker to main thread
 */
export interface WorkerResponse {
	/** Matching message ID */
	id: number;
	/** Whether operation succeeded */
	success: boolean;
	/** Result data if successful */
	data?: unknown;
	/** Error message if failed */
	error?: string;
}

/**
 * Result type for ProcessGlyphPixels operation
 */
export interface ProcessGlyphPixelsResult {
	/** Indices of pixels that need adjustment */
	pixelIndices: Uint32Array;
	/** Violation scores (edge-weighted) */
	violationScores: Float32Array;
	/** Adjusted RGB colors [R, G, B, ...] for violated pixels only */
	adjustedColors: Uint8Array;
	/** Number of violations found */
	count: number;
}

/**
 * Result type for ProcessPixelsSIMD operation
 */
export interface ProcessPixelsSIMDResult {
	/** Indices of violating pixels */
	violationIndices: Uint32Array;
	/** Adjusted RGB colors [R, G, B, ...] */
	adjustedColors: Uint8Array;
	/** Number of violations */
	count: number;
}

/**
 * Result type for BatchLuminance operation
 */
export interface BatchLuminanceResult {
	/** Luminance values (0.0-1.0) for each pixel */
	luminances: Float32Array;
}

/**
 * Result type for BatchContrast operation
 */
export interface BatchContrastResult {
	/** Contrast ratios (1.0-21.0) for each pixel pair */
	ratios: Float32Array;
}

/**
 * Result type for KernelDensity operation
 */
export interface KernelDensityResult {
	/** Background RGB estimates [R, G, B, ...] per pixel */
	bgEstimates: Uint8Array;
	/** Inverse density values (0.0-1.0, higher = edge pixel) */
	inverseDensity: Float32Array;
	/** Number of pixels processed */
	pixelCount: number;
}

/**
 * Result type for ComputeESDT operation
 *
 * Returns per-pixel distance vectors to nearest edge.
 */
export interface ComputeESDTResult {
	/** ESDT data [Δx₀, Δy₀, Δx₁, Δy₁, ...] for each pixel */
	esdtData: Float32Array;
	/** Number of pixels (width × height) */
	pixelCount: number;
	/** Processing time in milliseconds */
	processingTimeMs: number;
}

/**
 * Result type for ExtractGlyphPixels operation
 */
export interface ExtractGlyphPixelsResult {
	/** Glyph pixel data [x, y, coverage, distance, gradientX, gradientY, ...] */
	glyphData: Float32Array;
	/** Number of glyph pixels extracted */
	pixelCount: number;
}

// ============================================================================
// BACKWARDS COMPATIBILITY ALIASES (deprecated - use new APIs above)
// ============================================================================

/**
 * @deprecated Use ProcessGlyphPixelsPayload instead
 */
export interface SampleAndAdjustPayload {
	pixels: Uint8ClampedArray;
	width: number;
	height: number;
	positions: Uint32Array;
	textColors: Uint8Array;
	targetContrast: number;
}

/**
 * @deprecated Use ProcessGlyphPixelsResult instead
 */
export interface SampleAndAdjustResult {
	adjustedRgb: Uint8Array;
}

/**
 * @deprecated Use ProcessGlyphPixelsPayload instead
 */
export interface SparseAdjustPayload {
	charBounds: Float32Array;
	edgeCoords: Uint32Array;
	edgePixels: Uint8Array;
	charEdgeCounts: Uint32Array;
	textColors: Uint8Array;
	targetContrast: number;
}

/**
 * @deprecated Use ProcessGlyphPixelsResult instead
 */
export interface SparseAdjustResult {
	charIndices: Uint32Array;
	adjustedColors: Uint8Array;
	count: number;
}

/**
 * @deprecated Use ProcessPixelsSIMDPayload instead
 */
export interface PerPixelAdjustPayload {
	pixelCoords: Uint32Array;
	glyphMasks: Uint8Array;
	edgeCoords: Uint32Array;
	edgePixels: Uint8Array;
	regionColors: Uint8Array;
	pixelRegionMap: Uint32Array;
	targetContrast: number;
}

/**
 * @deprecated Use ProcessPixelsSIMDResult instead
 */
export interface PerPixelAdjustResult {
	pixelIndices: Uint32Array;
	adjustedColors: Uint8Array;
	count: number;
}
