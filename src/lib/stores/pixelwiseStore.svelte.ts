/**
 * Pixelwise WCAG Contrast Store
 *
 * Svelte 5 runes-based store for managing pixelwise contrast shader state.
 * Uses fingerprint-sticky persistence to maintain settings per device.
 *
 * Features:
 * - Class-based singleton pattern (like themeStore)
 * - Fingerprint-sticky localStorage persistence (like a11yStore)
 * - WebGL/WASM shader state management
 * - WCAG AA/AAA contrast level configuration
 * - Processing mode selection (per-pixel, per-character, adaptive)
 * - SSR-safe with browser environment checks
 */

import { browser } from '$app/environment';
import type {
	ProcessingMode as GPUProcessingMode,
	FallbackChainResult
} from '$lib/pixelwise/featureDetection';

/**
 * WCAG conformance levels
 * - AA: 4.5:1 contrast ratio (normal text), 3:1 (large text)
 * - AAA: 7:1 contrast ratio (normal text), 4.5:1 (large text)
 */
export type WCAGLevel = 'AA' | 'AAA';

/**
 * Pixelwise processing modes
 * - per-pixel: Process every pixel independently (slowest, most accurate)
 * - per-character: Process text by character boundaries (faster, good for typography)
 * - adaptive: Automatically choose mode based on content type (balanced)
 */
export type ProcessingMode = 'per-pixel' | 'per-character' | 'adaptive';

/**
 * Rendering modes for compositor loop
 * - continuous: RAF loop at target FPS (good for animations)
 * - event-driven: Only process on significant changes (better performance for static content)
 */
export type RenderMode = 'continuous' | 'event-driven';

/**
 * Persisted settings structure
 * Stored in localStorage with fingerprint key
 */
interface PixelwiseSettings {
	enabled: boolean;
	wcagLevel: WCAGLevel;
	processingMode: ProcessingMode;
	singleRenderMode?: boolean;
	renderMode?: RenderMode;
	trueSingleRenderMode?: boolean;
	fingerprint?: string;
}

/**
 * Processing statistics for tiered architecture
 * Tracks how many elements were processed at each tier:
 * - Tier 1: CSS-based detection (fastest, OKLCH/RGB thresholds)
 * - Tier 2: Canvas pixel sampling (medium speed, color extraction)
 * - Tier 3: Full WASM processing (slowest, pixel-perfect analysis)
 */
export interface ProcessingStats {
	/** Elements resolved using CSS color detection only */
	tier1Count: number;
	/** Elements requiring canvas pixel sampling */
	tier2Count: number;
	/** Elements requiring full WASM pixel processing */
	tier3Count: number;
	/** Total elements analyzed in current session */
	totalElements: number;
	/** Elements where corrections were applied */
	correctedElements: number;
	/** Total processing time in milliseconds */
	processingTimeMs: number;
}

/**
 * WebGPU device information
 * Captures capabilities and limits of the GPU device
 */
export interface GPUDeviceInfo {
	/** Vendor name (e.g., "NVIDIA", "AMD", "Apple") */
	vendor: string;
	/** Architecture identifier */
	architecture: string;
	/** Whether device supports compute shaders */
	supportsCompute: boolean;
	/** Maximum buffer size in bytes */
	maxBufferSize: number;
	/** Maximum texture dimension */
	maxTextureDimension: number;
}

/**
 * WebGPU-specific state
 * Tracks GPU processing mode, device capabilities, and zero-copy status
 */
export interface WebGPUState {
	/** Current GPU processing mode (webgpu, shared-buffer, worker, none) */
	gpuProcessingMode: GPUProcessingMode;
	/** Whether WebGPU is initialized and ready */
	webgpuReady: boolean;
	/** Full fallback chain detection result */
	fallbackChainResult: FallbackChainResult | null;
	/** Whether true zero-copy is active (GPU buffer → WASM → GPU) */
	zeroCopyEnabled: boolean;
	/** Whether SharedArrayBuffer is bound to worker */
	sharedBufferBound: boolean;
	/** GPU device information (null if not using WebGPU) */
	gpuDeviceInfo: GPUDeviceInfo | null;
	/** Whether cross-origin isolation is available (required for SharedArrayBuffer) */
	crossOriginIsolated: boolean;
}

/**
 * Color correction record
 * Tracks original and corrected colors for each element
 */
export interface ColorCorrection {
	/** Original color value (e.g., "rgb(255, 0, 0)") */
	original: string;
	/** Corrected color value meeting WCAG requirements */
	corrected: string;
	/** Which tier performed the correction */
	tier: 1 | 2 | 3;
	/** Timestamp of correction */
	timestamp: number;
}

/**
 * Pixelwise Store - Singleton class managing shader state
 *
 * Pattern follows themeStore.svelte.ts with private reactive state using $state runes
 * Persistence follows a11yStore.svelte.ts with fingerprint-sticky localStorage
 */
class PixelwiseStore {
	// ===================================================================
	// PRIVATE REACTIVE STATE (using Svelte 5 $state rune)
	// ===================================================================

	/** Whether pixelwise contrast shader is enabled */
	#enabled = $state<boolean>(false);

	/** Target WCAG conformance level (AA = 4.5:1, AAA = 7:1) */
	#wcagLevel = $state<WCAGLevel>('AA');

	/** Processing mode for shader algorithm */
	#processingMode = $state<ProcessingMode>('adaptive');

	/** Whether store has been initialized (prevents double-init) */
	#isInitialized = $state<boolean>(false);

	/** Whether WASM module is loaded and ready */
	#wasmReady = $state<boolean>(false);

	/** Whether shader is actively processing (for UI loading indicators) */
	#isProcessing = $state<boolean>(false);

	/** Number of regions processed (for progress tracking) */
	#processedRegions = $state<number>(0);

	/** Last error that occurred during processing */
	#error = $state<Error | null>(null);

	/** Device fingerprint for persistence */
	#fingerprint = $state<string | null>(null);

	/**
	 * Single Render Mode - Hides original DOM text when compositor is active
	 *
	 * When enabled:
	 * - DOM text becomes invisible (color: transparent)
	 * - Layout is preserved (box model, line height)
	 * - Text selection is disabled
	 * - Screen readers still read the text
	 * - Only compositor overlay shows text
	 */
	#singleRenderMode = $state<boolean>(false);

	/**
	 * Render Mode - Determines when compositor processes frames
	 * - continuous: RAF loop at target FPS (good for animations)
	 * - event-driven: Only on scroll/resize/mutations (85-95% reduction in WASM calls)
	 */
	#renderMode = $state<RenderMode>('continuous');

	/**
	 * True Single Render Mode - Hides DOM text entirely
	 *
	 * Unlike singleRenderMode, this makes DOM text truly invisible via CSS
	 * while preserving accessibility and glyph detection capabilities.
	 */
	#trueSingleRenderMode = $state<boolean>(false);

	/** Processing statistics for tiered architecture */
	#stats = $state<ProcessingStats>({
		tier1Count: 0,
		tier2Count: 0,
		tier3Count: 0,
		totalElements: 0,
		correctedElements: 0,
		processingTimeMs: 0
	});

	// ===================================================================
	// WEBGPU-SPECIFIC STATE
	// ===================================================================

	/** Current GPU processing mode from fallback chain detection */
	#gpuProcessingMode = $state<GPUProcessingMode>('none');

	/** Whether WebGPU is initialized and ready for rendering */
	#webgpuReady = $state<boolean>(false);

	/** Full fallback chain detection result (includes capabilities) */
	#fallbackChainResult = $state<FallbackChainResult | null>(null);

	/** Whether true zero-copy is active (GPU buffer → WASM SIMD → GPU) */
	#zeroCopyEnabled = $state<boolean>(false);

	/** Whether SharedArrayBuffer is bound to worker for near-zero-copy */
	#sharedBufferBound = $state<boolean>(false);

	/** GPU device information (vendor, architecture, limits) */
	#gpuDeviceInfo = $state<GPUDeviceInfo | null>(null);

	/** Whether cross-origin isolation is available (COOP/COEP headers) */
	#crossOriginIsolated = $state<boolean>(false);

	/** Set of element IDs that have been processed (prevents duplicate work) */
	#processedElements = $state<Set<string>>(new Set());

	/** Map of element IDs to their color corrections */
	#corrections = $state<Map<string, ColorCorrection>>(new Map());

	// ===================================================================
	// DERIVED VALUES (computed from reactive state)
	// ===================================================================

	/**
	 * Target contrast ratio based on WCAG level
	 * AA = 4.5:1, AAA = 7:1 (for normal text)
	 */
	get targetContrast(): number {
		return this.#wcagLevel === 'AAA' ? 7.0 : 4.5;
	}

	/**
	 * Whether processing mode indicates large text optimization
	 * Per-character mode is optimized for text rendering
	 */
	get isLargeText(): boolean {
		return this.#processingMode === 'per-character';
	}

	/**
	 * Whether adaptive mode is enabled
	 * Adaptive mode automatically selects per-pixel or per-character based on content
	 */
	get isAdaptive(): boolean {
		return this.#processingMode === 'adaptive';
	}

	/**
	 * Whether the pixelwise system is ready for processing
	 * Requires: enabled, WASM loaded, and no active errors
	 */
	get isReady(): boolean {
		return this.#enabled && this.#wasmReady && !this.#error;
	}

	/**
	 * Processing efficiency metric (percentage of elements handled by Tier 1)
	 * Higher percentage = better performance (more CSS-only processing)
	 */
	get tier1Efficiency(): number {
		if (this.#stats.totalElements === 0) return 0;
		return (this.#stats.tier1Count / this.#stats.totalElements) * 100;
	}

	/**
	 * Correction rate (percentage of elements that needed color adjustments)
	 */
	get correctionRate(): number {
		if (this.#stats.totalElements === 0) return 0;
		return (this.#stats.correctedElements / this.#stats.totalElements) * 100;
	}

	/**
	 * Whether true zero-copy rendering is available
	 * Requires: WebGPU mode + WASM ready + zero-copy enabled
	 */
	get isZeroCopy(): boolean {
		return this.#gpuProcessingMode === 'webgpu' && this.#zeroCopyEnabled && this.#wasmReady;
	}

	/**
	 * Whether near-zero-copy (SharedArrayBuffer) is available
	 * Requires: shared-buffer mode + WASM ready + buffer bound
	 */
	get isNearZeroCopy(): boolean {
		return this.#gpuProcessingMode === 'shared-buffer' && this.#sharedBufferBound && this.#wasmReady;
	}

	/**
	 * Whether any optimized processing path is available
	 * True if zero-copy, near-zero-copy, or standard worker is active
	 */
	get hasOptimizedPath(): boolean {
		return this.#gpuProcessingMode !== 'none' && this.#wasmReady;
	}

	/**
	 * Human-readable description of current processing mode
	 */
	get processingModeDescription(): string {
		if (this.#fallbackChainResult) {
			return this.#fallbackChainResult.description;
		}
		return 'Not initialized';
	}

	/**
	 * Full WebGPU state object for external consumers
	 */
	get webgpuState(): WebGPUState {
		return {
			gpuProcessingMode: this.#gpuProcessingMode,
			webgpuReady: this.#webgpuReady,
			fallbackChainResult: this.#fallbackChainResult,
			zeroCopyEnabled: this.#zeroCopyEnabled,
			sharedBufferBound: this.#sharedBufferBound,
			gpuDeviceInfo: this.#gpuDeviceInfo,
			crossOriginIsolated: this.#crossOriginIsolated
		};
	}

	// ===================================================================
	// PUBLIC GETTERS (read-only access to reactive state)
	// ===================================================================

	get enabled(): boolean {
		return this.#enabled;
	}

	get wcagLevel(): WCAGLevel {
		return this.#wcagLevel;
	}

	get processingMode(): ProcessingMode {
		return this.#processingMode;
	}

	get isInitialized(): boolean {
		return this.#isInitialized;
	}

	get wasmReady(): boolean {
		return this.#wasmReady;
	}

	get isProcessing(): boolean {
		return this.#isProcessing;
	}

	get processedRegions(): number {
		return this.#processedRegions;
	}

	get error(): Error | null {
		return this.#error;
	}

	get fingerprint(): string | null {
		return this.#fingerprint;
	}

	get stats(): ProcessingStats {
		return this.#stats;
	}

	get singleRenderMode(): boolean {
		return this.#singleRenderMode;
	}

	get renderMode(): RenderMode {
		return this.#renderMode;
	}

	get trueSingleRenderMode(): boolean {
		return this.#trueSingleRenderMode;
	}

	// WebGPU-specific getters

	get gpuProcessingMode(): GPUProcessingMode {
		return this.#gpuProcessingMode;
	}

	get webgpuReady(): boolean {
		return this.#webgpuReady;
	}

	get fallbackChainResult(): FallbackChainResult | null {
		return this.#fallbackChainResult;
	}

	get zeroCopyEnabled(): boolean {
		return this.#zeroCopyEnabled;
	}

	get sharedBufferBound(): boolean {
		return this.#sharedBufferBound;
	}

	get gpuDeviceInfo(): GPUDeviceInfo | null {
		return this.#gpuDeviceInfo;
	}

	get crossOriginIsolated(): boolean {
		return this.#crossOriginIsolated;
	}

	// ===================================================================
	// CONSTRUCTOR
	// ===================================================================

	constructor() {
		// SSR guard: Only initialize in browser
		if (!browser) {
			console.debug('[Pixelwise] Server-side rendering detected, skipping initialization');
			return;
		}

		// Load settings from localStorage (without fingerprint)
		// Fingerprint will be initialized via initializeFingerprint() method
		this.loadSettings();

		// Mark as initialized after settings load (basic initialization)
		// Fingerprint initialization is optional for enhanced persistence
		this.#isInitialized = true;
		console.debug('[Pixelwise] Store initialized');
	}

	// ===================================================================
	// PUBLIC API METHODS
	// ===================================================================

	/**
	 * Set enabled state and persist to localStorage
	 * @param value - Whether to enable pixelwise contrast shader
	 */
	setEnabled(value: boolean): void {
		if (!browser) return;

		this.#enabled = value;
		this.saveSettings();

		// Dispatch event for components to react
		window.dispatchEvent(
			new CustomEvent('pixelwise-change', {
				detail: { enabled: value, wcagLevel: this.#wcagLevel, processingMode: this.#processingMode }
			})
		);

		console.log(`[Pixelwise] Shader ${value ? 'enabled' : 'disabled'}`);
	}

	/**
	 * Set WCAG conformance level and persist
	 * @param level - Target WCAG level ('AA' or 'AAA')
	 */
	setWCAGLevel(level: WCAGLevel): void {
		if (!browser) return;

		this.#wcagLevel = level;
		this.saveSettings();

		// Dispatch event for shader to reconfigure
		window.dispatchEvent(
			new CustomEvent('pixelwise-wcag-change', {
				detail: { wcagLevel: level, targetContrast: this.targetContrast }
			})
		);

		console.log(`[Pixelwise] WCAG level set to ${level} (${this.targetContrast}:1 contrast)`);
	}

	/**
	 * Set processing mode and persist
	 * @param mode - Processing algorithm mode
	 */
	setProcessingMode(mode: ProcessingMode): void {
		if (!browser) return;

		this.#processingMode = mode;
		this.saveSettings();

		// Dispatch event for shader to reconfigure
		window.dispatchEvent(
			new CustomEvent('pixelwise-mode-change', {
				detail: { processingMode: mode, isLargeText: this.isLargeText }
			})
		);

		console.log(`[Pixelwise] Processing mode set to ${mode}`);
	}

	/**
	 * Set single render mode
	 *
	 * When enabled, original DOM text is hidden (color: transparent) while
	 * the compositor overlay displays the contrast-adjusted version.
	 * This prevents "double rendering" of text.
	 *
	 * @param value - Whether to enable single render mode
	 */
	setSingleRenderMode(value: boolean): void {
		if (!browser) return;

		this.#singleRenderMode = value;
		this.saveSettings();

		// Dispatch event for compositor to apply/remove CSS class
		window.dispatchEvent(
			new CustomEvent('pixelwise-single-render-change', {
				detail: { singleRenderMode: value }
			})
		);

		console.log(`[Pixelwise] Single render mode ${value ? 'enabled' : 'disabled'}`);
	}

	/**
	 * Set render mode (continuous vs event-driven)
	 *
	 * @param mode - Rendering mode to use
	 */
	setRenderMode(mode: RenderMode): void {
		if (!browser) return;

		this.#renderMode = mode;
		this.saveSettings();

		// Dispatch event for compositor to switch modes
		window.dispatchEvent(
			new CustomEvent('pixelwise-render-mode-change', {
				detail: { renderMode: mode }
			})
		);

		console.log(`[Pixelwise] Render mode set to ${mode}`);
	}

	/**
	 * Set true single render mode
	 *
	 * When enabled, DOM text becomes completely invisible (color: transparent)
	 * while preserving layout, accessibility, and glyph detection.
	 *
	 * @param value - Whether to enable true single render mode
	 */
	setTrueSingleRenderMode(value: boolean): void {
		if (!browser) return;

		this.#trueSingleRenderMode = value;
		this.saveSettings();

		// Apply/remove CSS class immediately
		if (value) {
			document.documentElement.classList.add('pixelwise-true-single-render');
		} else {
			document.documentElement.classList.remove('pixelwise-true-single-render');
		}

		console.log(`[Pixelwise] True single render mode ${value ? 'enabled' : 'disabled'}`);
	}

	/**
	 * Initialize fingerprint for sticky persistence
	 * Should be called after device fingerprint is available
	 * @param fingerprint - Device fingerprint string
	 */
	initializeFingerprint(fingerprint: string): void {
		if (!browser) return;

		this.#fingerprint = fingerprint;
		this.#isInitialized = true;

		// Reload settings with fingerprint key
		this.loadSettings();

		console.log(`[Pixelwise] Fingerprint initialized: ${fingerprint}`);
	}

	/**
	 * Set WASM ready status
	 * Called by ShaderPipeline after WASM module is loaded
	 * @param ready - Whether WASM is loaded and ready
	 */
	setWasmReady(ready: boolean): void {
		if (!browser) return;

		this.#wasmReady = ready;
		console.log(`[Pixelwise] WASM ${ready ? 'ready' : 'not ready'}`);
	}

	/**
	 * Start processing (set isProcessing flag for UI)
	 * Call before shader begins work
	 */
	startProcessing(): void {
		if (!browser) return;

		this.#isProcessing = true;
		this.#processedRegions = 0;
		this.#error = null;

		console.log('[Pixelwise] Processing started');
	}

	/**
	 * Stop processing (clear isProcessing flag)
	 * Call after shader completes or errors
	 */
	stopProcessing(): void {
		if (!browser) return;

		this.#isProcessing = false;

		console.log(`[Pixelwise] Processing stopped (${this.#processedRegions} regions processed)`);
	}

	/**
	 * Increment processed regions counter
	 * Call for each shader pass/region completed
	 */
	incrementProcessedRegions(): void {
		if (!browser) return;

		this.#processedRegions++;
	}

	/**
	 * Reset processed regions counter
	 * Call when starting new processing session
	 */
	resetProcessedRegions(): void {
		if (!browser) return;

		this.#processedRegions = 0;
	}

	/**
	 * Set error state
	 * @param error - Error that occurred during processing (null to clear)
	 */
	setError(error: Error | null): void {
		if (!browser) return;

		this.#error = error;

		if (error) {
			console.error('[Pixelwise] Error:', error);

			// Dispatch error event
			window.dispatchEvent(
				new CustomEvent('pixelwise-error', {
					detail: { error }
				})
			);
		}
	}

	// ===================================================================
	// WEBGPU STATE METHODS
	// ===================================================================

	/**
	 * Initialize WebGPU state from fallback chain detection
	 * Called by compositor after running detectFallbackChain()
	 * @param result - Fallback chain detection result
	 */
	initializeFallbackChain(result: FallbackChainResult): void {
		if (!browser) return;

		this.#fallbackChainResult = result;
		this.#gpuProcessingMode = result.mode;
		this.#zeroCopyEnabled = result.zeroCopy;
		this.#crossOriginIsolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;

		// Dispatch event for components to react
		window.dispatchEvent(
			new CustomEvent('pixelwise-fallback-chain-init', {
				detail: {
					mode: result.mode,
					description: result.description,
					zeroCopy: result.zeroCopy,
					warning: result.warning
				}
			})
		);

		console.log(`[Pixelwise] Fallback chain initialized: ${result.description}`, {
			mode: result.mode,
			zeroCopy: result.zeroCopy,
			crossOriginIsolated: this.#crossOriginIsolated
		});
	}

	/**
	 * Set WebGPU ready state
	 * Called when WebGPU device is created and ready
	 * @param ready - Whether WebGPU is ready
	 */
	setWebGPUReady(ready: boolean): void {
		if (!browser) return;

		this.#webgpuReady = ready;

		window.dispatchEvent(
			new CustomEvent('pixelwise-webgpu-ready', {
				detail: { ready }
			})
		);

		console.log(`[Pixelwise] WebGPU ${ready ? 'ready' : 'not ready'}`);
	}

	/**
	 * Set GPU device info
	 * Called after WebGPU adapter/device creation
	 * @param info - GPU device information
	 */
	setGPUDeviceInfo(info: GPUDeviceInfo): void {
		if (!browser) return;

		this.#gpuDeviceInfo = info;

		console.log('[Pixelwise] GPU device info:', {
			vendor: info.vendor,
			architecture: info.architecture,
			supportsCompute: info.supportsCompute
		});
	}

	/**
	 * Set zero-copy enabled state
	 * Called when WebGPU buffer binding is established
	 * @param enabled - Whether zero-copy is active
	 */
	setZeroCopyEnabled(enabled: boolean): void {
		if (!browser) return;

		this.#zeroCopyEnabled = enabled;

		window.dispatchEvent(
			new CustomEvent('pixelwise-zero-copy-change', {
				detail: { zeroCopy: enabled }
			})
		);

		console.log(`[Pixelwise] Zero-copy ${enabled ? 'enabled' : 'disabled'}`);
	}

	/**
	 * Set SharedArrayBuffer bound state
	 * Called when SharedArrayBuffer is successfully bound to worker
	 * @param bound - Whether buffer is bound
	 */
	setSharedBufferBound(bound: boolean): void {
		if (!browser) return;

		this.#sharedBufferBound = bound;

		console.log(`[Pixelwise] SharedArrayBuffer ${bound ? 'bound' : 'unbound'}`);
	}

	/**
	 * Reset all WebGPU state
	 * Call when compositor is destroyed or reinitialized
	 */
	resetWebGPUState(): void {
		if (!browser) return;

		this.#gpuProcessingMode = 'none';
		this.#webgpuReady = false;
		this.#fallbackChainResult = null;
		this.#zeroCopyEnabled = false;
		this.#sharedBufferBound = false;
		this.#gpuDeviceInfo = null;

		console.log('[Pixelwise] WebGPU state reset');
	}

	// ===================================================================
	// STATS TRACKING METHODS
	// ===================================================================

	/**
	 * Record processing at a specific tier
	 * @param tier - Which tier processed the element (1 = CSS, 2 = Canvas, 3 = WASM)
	 * @param count - Number of elements processed at this tier (default 1)
	 */
	recordProcessing(tier: 1 | 2 | 3, count: number = 1): void {
		if (!browser) return;

		this.#stats.totalElements += count;

		switch (tier) {
			case 1:
				this.#stats.tier1Count += count;
				break;
			case 2:
				this.#stats.tier2Count += count;
				break;
			case 3:
				this.#stats.tier3Count += count;
				break;
		}

		console.debug(`[Pixelwise] Tier ${tier} processed ${count} element(s)`);
	}

	/**
	 * Record a color correction applied to an element
	 * @param elementId - Unique identifier for the element (e.g., DOM node path)
	 * @param original - Original color value
	 * @param corrected - Corrected color value
	 * @param tier - Which tier applied the correction
	 */
	recordCorrection(elementId: string, original: string, corrected: string, tier: 1 | 2 | 3): void {
		if (!browser) return;

		const correction: ColorCorrection = {
			original,
			corrected,
			tier,
			timestamp: Date.now()
		};

		// Only increment corrected count if this is a new correction
		if (!this.#corrections.has(elementId)) {
			this.#stats.correctedElements++;
		}

		this.#corrections.set(elementId, correction);

		console.debug(`[Pixelwise] Correction recorded for ${elementId}: ${original} -> ${corrected}`);
	}

	/**
	 * Add processing time to total
	 * @param timeMs - Time in milliseconds to add
	 */
	addProcessingTime(timeMs: number): void {
		if (!browser) return;

		this.#stats.processingTimeMs += timeMs;
	}

	/**
	 * Reset all statistics
	 * Call when starting a new processing session
	 */
	resetStats(): void {
		if (!browser) return;

		this.#stats = {
			tier1Count: 0,
			tier2Count: 0,
			tier3Count: 0,
			totalElements: 0,
			correctedElements: 0,
			processingTimeMs: 0
		};

		console.log('[Pixelwise] Stats reset');
	}

	// ===================================================================
	// ELEMENT TRACKING METHODS
	// ===================================================================

	/**
	 * Mark an element as processed to prevent duplicate work
	 * @param elementId - Unique identifier for the element
	 */
	markProcessed(elementId: string): void {
		if (!browser) return;

		this.#processedElements.add(elementId);
	}

	/**
	 * Check if an element has already been processed
	 * @param elementId - Unique identifier for the element
	 * @returns true if element was already processed
	 */
	isElementProcessed(elementId: string): boolean {
		return this.#processedElements.has(elementId);
	}

	/**
	 * Clear the set of processed elements
	 * Call when resetting processing state (e.g., theme change)
	 */
	clearProcessedElements(): void {
		if (!browser) return;

		this.#processedElements.clear();
		console.log('[Pixelwise] Processed elements cleared');
	}

	/**
	 * Get correction for a specific element
	 * @param elementId - Unique identifier for the element
	 * @returns ColorCorrection if found, undefined otherwise
	 */
	getCorrection(elementId: string): ColorCorrection | undefined {
		return this.#corrections.get(elementId);
	}

	/**
	 * Get all corrections as an array
	 * Useful for debugging and analytics
	 */
	getAllCorrections(): Array<{ elementId: string; correction: ColorCorrection }> {
		return Array.from(this.#corrections.entries()).map(([elementId, correction]) => ({
			elementId,
			correction
		}));
	}

	/**
	 * Clear all corrections
	 * Call when resetting processing state
	 */
	clearCorrections(): void {
		if (!browser) return;

		this.#corrections.clear();
		console.log('[Pixelwise] Corrections cleared');
	}

	// ===================================================================
	// PRIVATE PERSISTENCE METHODS
	// ===================================================================

	/**
	 * Get localStorage key for current fingerprint
	 * Format: "pixelwise-settings-{fingerprint}" or "pixelwise-settings" if no fingerprint
	 */
	private getStorageKey(): string {
		return this.#fingerprint ? `pixelwise-settings-${this.#fingerprint}` : 'pixelwise-settings';
	}

	/**
	 * Load settings from localStorage
	 * Uses fingerprint-sticky key if available
	 *
	 * NOTE: The `enabled` state is NEVER loaded from storage.
	 * The compositor should ALWAYS start OFF on page load/refresh.
	 * Users must explicitly enable it via the A11y UI component.
	 */
	private loadSettings(): void {
		if (!browser) return;

		try {
			const key = this.getStorageKey();
			const stored = localStorage.getItem(key);

			if (stored) {
				const settings: PixelwiseSettings = JSON.parse(stored);

				// IMPORTANT: Do NOT load `enabled` state!
				// Compositor must always start OFF on page load.
				// This prevents rendering issues if user hard-refreshes.
				// The user must explicitly toggle it ON via the A11y UI.
				// if (typeof settings.enabled === 'boolean') {
				// 	this.#enabled = settings.enabled;
				// }

				if (settings.wcagLevel === 'AA' || settings.wcagLevel === 'AAA') {
					this.#wcagLevel = settings.wcagLevel;
				}

				if (
					settings.processingMode === 'per-pixel' ||
					settings.processingMode === 'per-character' ||
					settings.processingMode === 'adaptive'
				) {
					this.#processingMode = settings.processingMode;
				}

				// IMPORTANT: Do NOT load singleRenderMode from storage!
				// Like `enabled`, these settings should always start OFF on page load.
				// if (typeof settings.singleRenderMode === 'boolean') {
				// 	this.#singleRenderMode = settings.singleRenderMode;
				// }

				if (settings.renderMode === 'continuous' || settings.renderMode === 'event-driven') {
					this.#renderMode = settings.renderMode;
				}

				// IMPORTANT: Do NOT load trueSingleRenderMode from storage!
				// This prevents CSS class from being applied on page load.
				// if (typeof settings.trueSingleRenderMode === 'boolean') {
				// 	this.#trueSingleRenderMode = settings.trueSingleRenderMode;
				// 	if (settings.trueSingleRenderMode) {
				// 		document.documentElement.classList.add('pixelwise-true-single-render');
				// 	}
				// }

				console.log(`[Pixelwise] Settings loaded from ${key}:`, {
					enabled: this.#enabled,
					wcagLevel: this.#wcagLevel,
					processingMode: this.#processingMode,
					singleRenderMode: this.#singleRenderMode,
				renderMode: this.#renderMode,
				trueSingleRenderMode: this.#trueSingleRenderMode
				});
			} else {
				console.debug(`[Pixelwise] No saved settings found at ${key}, using defaults`);
			}
		} catch (error) {
			console.error('[Pixelwise] Failed to load settings from localStorage:', error);
		}
	}

	/**
	 * Save settings to localStorage
	 * Uses fingerprint-sticky key if available
	 */
	private saveSettings(): void {
		if (!browser) return;

		try {
			const key = this.getStorageKey();

			const settings: PixelwiseSettings = {
				enabled: this.#enabled,
				wcagLevel: this.#wcagLevel,
				processingMode: this.#processingMode,
				singleRenderMode: this.#singleRenderMode,
				renderMode: this.#renderMode,
				trueSingleRenderMode: this.#trueSingleRenderMode,
				fingerprint: this.#fingerprint || undefined
			};

			localStorage.setItem(key, JSON.stringify(settings));

			console.debug(`[Pixelwise] Settings saved to ${key}`);
		} catch (error) {
			console.error('[Pixelwise] Failed to save settings to localStorage:', error);
		}
	}

	// ===================================================================
	// DEBUG METHODS
	// ===================================================================

	/**
	 * Log current store state for debugging
	 */
	logState(): void {
		console.log('[Pixelwise] Current state:', {
			// Core state
			enabled: this.#enabled,
			wcagLevel: this.#wcagLevel,
			processingMode: this.#processingMode,
			targetContrast: this.targetContrast,
			isLargeText: this.isLargeText,
			isAdaptive: this.isAdaptive,
			isReady: this.isReady,
			isInitialized: this.#isInitialized,
			isProcessing: this.#isProcessing,
			wasmReady: this.#wasmReady,
			processedRegions: this.#processedRegions,
			error: this.#error,
			fingerprint: this.#fingerprint,
			storageKey: this.getStorageKey(),
			// WebGPU state
			gpuProcessingMode: this.#gpuProcessingMode,
			webgpuReady: this.#webgpuReady,
			zeroCopyEnabled: this.#zeroCopyEnabled,
			sharedBufferBound: this.#sharedBufferBound,
			crossOriginIsolated: this.#crossOriginIsolated,
			isZeroCopy: this.isZeroCopy,
			isNearZeroCopy: this.isNearZeroCopy,
			hasOptimizedPath: this.hasOptimizedPath,
			processingModeDescription: this.processingModeDescription,
			gpuDeviceInfo: this.#gpuDeviceInfo,
			// Stats
			stats: this.#stats,
			tier1Efficiency: this.tier1Efficiency.toFixed(1) + '%',
			correctionRate: this.correctionRate.toFixed(1) + '%',
			processedElements: this.#processedElements.size,
			corrections: this.#corrections.size
		});
	}

	/**
	 * Get a summary report of processing performance
	 * Useful for analytics and optimization
	 */
	getPerformanceReport(): {
		stats: ProcessingStats;
		efficiency: {
			tier1Percentage: number;
			tier2Percentage: number;
			tier3Percentage: number;
		};
		correctionRate: number;
		avgProcessingTimePerElement: number;
		webgpu: {
			mode: GPUProcessingMode;
			description: string;
			zeroCopy: boolean;
			nearZeroCopy: boolean;
			optimizedPath: boolean;
		};
	} {
		const total = this.#stats.totalElements || 1; // Prevent division by zero

		return {
			stats: { ...this.#stats },
			efficiency: {
				tier1Percentage: (this.#stats.tier1Count / total) * 100,
				tier2Percentage: (this.#stats.tier2Count / total) * 100,
				tier3Percentage: (this.#stats.tier3Count / total) * 100
			},
			correctionRate: this.correctionRate,
			avgProcessingTimePerElement: this.#stats.processingTimeMs / total,
			webgpu: {
				mode: this.#gpuProcessingMode,
				description: this.processingModeDescription,
				zeroCopy: this.isZeroCopy,
				nearZeroCopy: this.isNearZeroCopy,
				optimizedPath: this.hasOptimizedPath
			}
		};
	}
}

// ===================================================================
// SINGLETON EXPORT
// ===================================================================

/**
 * Singleton instance of PixelwiseStore
 * Safe for both SSR and client-side usage
 */
export const pixelwiseStore = new PixelwiseStore();
