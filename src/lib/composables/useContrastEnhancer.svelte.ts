/**
 * useContrastEnhancer - Svelte 5 Composable for WCAG Contrast Enhancement
 *
 * A clean, minimal composable that combines:
 * - ViewportCapture: DOM to pixel data
 * - ComputeDispatcher: ESDT + WCAG processing (Futhark WASM)
 * - OverlayCompositor: WebGL2 overlay rendering
 *
 * Usage:
 * ```svelte
 * <script>
 *   const enhancer = useContrastEnhancer({ targetContrast: 7.0 });
 *
 *   onMount(() => {
 *     enhancer.start();
 *     return () => enhancer.stop();
 *   });
 * </script>
 * ```
 *
 * @module useContrastEnhancer
 */

import { browser } from '$app/environment';
import { createViewportCapture } from '$lib/core/ViewportCapture';
import { createComputeDispatcher, DEFAULT_CONFIG } from '$lib/core/ComputeDispatcher';
import { createOverlayCompositor } from '$lib/core/OverlayCompositor';

export interface ContrastEnhancerOptions {
	/** Target WCAG contrast ratio (default: 7.0 for AAA) */
	targetContrast?: number;
	/** Maximum distance for glyph pixel extraction (default: 3.0) */
	maxDistance?: number;
	/** Distance to sample for background estimation (default: 5.0) */
	sampleDistance?: number;
	/** Target frame rate (default: 30) */
	targetFps?: number;
	/** Auto-start on initialization (default: false) */
	autoStart?: boolean;
	/** Enable debug mode (default: false) */
	debug?: boolean;
}

export interface ContrastEnhancerStats {
	frameCount: number;
	lastFrameTime: number;
	averageFrameTime: number;
	glyphPixelCount: number;
	adjustedPixelCount: number;
	backend: string;
}

export interface ContrastEnhancerResult {
	// State (reactive in Svelte 5 runes mode)
	readonly isInitialized: boolean;
	readonly isRunning: boolean;
	readonly error: Error | null;
	readonly stats: ContrastEnhancerStats;

	// Actions
	initialize(): Promise<boolean>;
	start(): void;
	stop(): void;
	processFrame(): Promise<void>;
	destroy(): void;

	// Configuration
	setTargetContrast(contrast: number): void;
	setMaxDistance(distance: number): void;
}

/**
 * Creates a contrast enhancer composable with Svelte 5 runes for reactivity
 */
export function useContrastEnhancer(options: ContrastEnhancerOptions = {}): ContrastEnhancerResult {
	const {
		targetContrast = DEFAULT_CONFIG.targetContrast,
		maxDistance = DEFAULT_CONFIG.maxDistance,
		sampleDistance = DEFAULT_CONFIG.sampleDistance,
		targetFps = 30,
		autoStart = false,
		debug = false
	} = options;

	// Core modules
	const capture = createViewportCapture();
	const compute = createComputeDispatcher();
	const overlay = createOverlayCompositor();

	// Configuration
	let config = {
		targetContrast,
		maxDistance,
		sampleDistance,
		useRelaxation: false
	};

	// State - using $state for Svelte 5 reactivity
	let isInitialized = $state(false);
	let isRunning = $state(false);
	let error = $state<Error | null>(null);
	let animationFrameId: number | null = null;
	let lastFrameTimestamp = 0;
	const frameInterval = 1000 / targetFps;

	// Stats - using $state for reactivity
	let stats = $state<ContrastEnhancerStats>({
		frameCount: 0,
		lastFrameTime: 0,
		averageFrameTime: 0,
		glyphPixelCount: 0,
		adjustedPixelCount: 0,
		backend: 'none'
	});

	// Frame time tracking for average
	const frameTimes: number[] = [];
	const maxFrameTimeHistory = 30;

	/**
	 * Initialize all subsystems
	 */
	async function initialize(): Promise<boolean> {
		if (!browser) return false;
		if (isInitialized) return true;

		try {
			// Initialize compute dispatcher (Futhark WASM)
			const computeOk = await compute.initialize('auto');
			if (!computeOk) {
				throw new Error('Failed to initialize compute dispatcher');
			}

			// Initialize overlay compositor (WebGL2)
			const overlayOk = overlay.initialize({ debug });
			if (!overlayOk) {
				throw new Error('Failed to initialize overlay compositor');
			}

			// Check if Screen Capture API is supported
			if (!capture.isSupported()) {
				console.warn('[ContrastEnhancer] Screen Capture API not supported, some features may be limited');
			}

			stats.backend = compute.activeBackend;
			isInitialized = true;

			if (autoStart) {
				start();
			}

			return true;
		} catch (err: unknown) {
			error = err instanceof Error ? err : new Error(String(err));
			console.error('ContrastEnhancer initialization failed:', err);
			return false;
		}
	}

	/**
	 * Process a single frame using the full GPU pipeline
	 *
	 * This now uses the unified ComputeDispatcher.runFullPipeline() which runs
	 * all 6 GPU passes on WebGPU:
	 * 1. Grayscale + Gradient
	 * 2. ESDT X-pass
	 * 3. ESDT Y-pass
	 * 4. Extract glyph pixels
	 * 5. Background sampling
	 * 6. Contrast analysis + Color adjustment
	 */
	async function processFrame(): Promise<void> {
		if (!isInitialized || !isRunning) return;

		const frameStart = performance.now();

		try {
			// 1. Capture viewport (uses Screen Capture API)
			// First call will prompt user for permission
			const captureResult = await capture.capture({
				maxWidth: 1920,
				maxHeight: 1080
			});

			if (!captureResult) {
				// No capture yet - user may need to grant permission
				// Don't spam the console, just skip this frame
				return;
			}

			// 2. Run the full GPU pipeline (CPU preprocessing + 6 GPU passes)
			const result = await compute.runFullPipeline(
				captureResult.data,
				captureResult.width,
				captureResult.height,
				config
			);

			// 3. Update overlay with adjusted pixels
			if (result.adjustedCount > 0) {
				overlay.updateTexture(result.adjustedPixels, captureResult.width, captureResult.height);
				overlay.render();
				overlay.show();
			} else {
				overlay.hide();
			}

			// Update stats
			const frameTime = performance.now() - frameStart;
			frameTimes.push(frameTime);
			if (frameTimes.length > maxFrameTimeHistory) {
				frameTimes.shift();
			}

			stats = {
				frameCount: stats.frameCount + 1,
				lastFrameTime: frameTime,
				averageFrameTime: frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length,
				glyphPixelCount: result.adjustedCount, // Now tracked by GPU pipeline
				adjustedPixelCount: result.adjustedCount,
				backend: result.backend
			};
		} catch (err: unknown) {
			error = err instanceof Error ? err : new Error(String(err));
			console.error('Frame processing error:', err);
		}
	}

	/**
	 * Animation loop
	 */
	function loop(timestamp: number) {
		if (!isRunning) return;

		// Throttle to target FPS
		if (timestamp - lastFrameTimestamp >= frameInterval) {
			lastFrameTimestamp = timestamp;
			processFrame();
		}

		animationFrameId = requestAnimationFrame(loop);
	}

	/**
	 * Start the enhancement loop
	 */
	function start() {
		if (!browser || !isInitialized || isRunning) return;

		isRunning = true;
		overlay.show();
		animationFrameId = requestAnimationFrame(loop);
	}

	/**
	 * Stop the enhancement loop
	 */
	function stop() {
		isRunning = false;

		if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}

		overlay.hide();
		overlay.clear();
	}

	/**
	 * Set target contrast ratio
	 */
	function setTargetContrast(contrast: number) {
		config.targetContrast = Math.max(1, Math.min(21, contrast));
	}

	/**
	 * Set maximum distance for glyph extraction
	 */
	function setMaxDistance(distance: number) {
		config.maxDistance = Math.max(0.5, Math.min(10, distance));
	}

	/**
	 * Cleanup all resources
	 */
	function destroy() {
		stop();
		capture.destroy();
		compute.destroy();
		overlay.destroy();
		isInitialized = false;
	}

	// Return reactive getters - Svelte 5 runes handle reactivity automatically
	return {
		// State (reactive via $state)
		get isInitialized() {
			return isInitialized;
		},
		get isRunning() {
			return isRunning;
		},
		get error() {
			return error;
		},
		get stats() {
			return stats;
		},

		// Actions
		initialize,
		start,
		stop,
		processFrame,
		destroy,

		// Configuration
		setTargetContrast,
		setMaxDistance
	};
}

export type ContrastEnhancer = ReturnType<typeof useContrastEnhancer>;
