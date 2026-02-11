/**
 * PixelwiseAnimationLoop - 60fps animation loop for real-time blob background sampling
 *
 * Provides frame-rate controlled animation loop with low-power device detection
 * and clean lifecycle management. Follows the isDestroyed guard pattern from
 * ViewportProcessor to prevent race conditions.
 *
 * Features:
 * - Configurable target FPS (default: 60fps)
 * - Automatic throttling to 30fps on low-power devices
 * - Frame timing to maintain consistent intervals
 * - Clean stop/reset with requestAnimationFrame cleanup
 * - isDestroyed guard to prevent race conditions
 *
 * @module PixelwiseAnimationLoop
 *
 * @example
 * ```typescript
 * const loop = new PixelwiseAnimationLoop(60);
 *
 * loop.start(() => {
 *   // Re-sample blob backgrounds at 60fps
 *   sampler.sampleBatch(positions);
 * });
 *
 * // Later, cleanup
 * loop.stop();
 * ```
 */

import { browser } from '$app/environment';

/**
 * Configuration options for PixelwiseAnimationLoop
 */
export interface AnimationLoopOptions {
	/** Target frames per second (default: 60) */
	targetFps?: number;

	/** Enable auto-detection of low-power devices (default: true) */
	detectLowPower?: boolean;

	/** FPS throttle for low-power devices (default: 30) */
	lowPowerFps?: number;
}

/**
 * Animation loop for real-time blob background sampling
 *
 * Manages requestAnimationFrame loop with frame rate limiting and
 * low-power device detection. Uses isDestroyed guard pattern to
 * prevent race conditions on cleanup.
 */
export class PixelwiseAnimationLoop {
	private rafId: number | null = null;

	// CRITICAL: Guard flag to prevent race conditions
	// Fixes race conditions where animate() runs after stop()
	private isDestroyed = false;

	private lastFrame = 0;
	private frameInterval: number;
	private targetFps: number;

	/**
	 * Creates a new animation loop
	 * @param options - Configuration options
	 */
	constructor(options?: AnimationLoopOptions) {
		// Default to 60fps
		this.targetFps = options?.targetFps ?? 60;

		// Detect low-power devices and throttle to 30fps
		if (options?.detectLowPower !== false && this.isLowPowerDevice()) {
			const lowPowerFps = options?.lowPowerFps ?? 30;
			console.log(
				`[PixelwiseAnimationLoop] Low-power device detected, throttling to ${lowPowerFps}fps`
			);
			this.targetFps = lowPowerFps;
		}

		this.frameInterval = 1000 / this.targetFps;
		console.log(`[PixelwiseAnimationLoop] Initialized at ${this.targetFps}fps`);
	}

	/**
	 * Detects low-power devices based on hardware concurrency
	 * Devices with < 4 cores are considered low-power
	 */
	private isLowPowerDevice(): boolean {
		if (!browser) return false;

		// Use navigator.hardwareConcurrency to detect low-power devices
		// Less than 4 cores indicates mobile/low-power device
		const cores = navigator.hardwareConcurrency || 4;
		return cores < 4;
	}

	/**
	 * Starts the animation loop
	 *
	 * @param onFrame - Callback function to execute each frame
	 *
	 * @example
	 * ```typescript
	 * loop.start(() => {
	 *   sampler.sampleBatch(positions);
	 * });
	 * ```
	 */
	start(onFrame: () => void): void {
		if (!browser) {
			console.warn('[PixelwiseAnimationLoop] Cannot start: not in browser environment');
			return;
		}

		// Guard against starting after destruction
		if (this.isDestroyed) {
			console.warn('[PixelwiseAnimationLoop] Cannot start: loop was destroyed');
			return;
		}

		// Guard against multiple starts
		if (this.rafId !== null) {
			console.debug('[PixelwiseAnimationLoop] Loop already running');
			return;
		}

		// Reset frame timing
		this.lastFrame = performance.now();

		const animate = (timestamp: number) => {
			// CRITICAL: Guard against processing after destroy()
			// This prevents race conditions where animate() runs after stop()
			if (this.isDestroyed) {
				console.debug('[PixelwiseAnimationLoop] animate() called after destroy, ignoring');
				return;
			}

			// Frame rate limiting - only execute callback if enough time has elapsed
			const elapsed = timestamp - this.lastFrame;

			if (elapsed >= this.frameInterval) {
				// Update last frame time, accounting for drift
				this.lastFrame = timestamp - (elapsed % this.frameInterval);

				// Execute frame callback
				try {
					onFrame();
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : String(error);
					console.error('[PixelwiseAnimationLoop] Frame callback error:', message);
				}
			}

			// Schedule next frame
			// Double-check destruction state before scheduling
			if (!this.isDestroyed) {
				this.rafId = requestAnimationFrame(animate);
			}
		};

		// Start the loop
		this.rafId = requestAnimationFrame(animate);
		console.log(`[PixelwiseAnimationLoop] Started at ${this.targetFps}fps`);
	}

	/**
	 * Stops the animation loop and cleans up resources
	 *
	 * CRITICAL: Sets isDestroyed flag FIRST to prevent race conditions
	 * where animate() might run after cancelAnimationFrame()
	 */
	stop(): void {
		// CRITICAL: Set destroyed flag FIRST to prevent race conditions
		// This ensures animate() exits early if it's already scheduled
		this.isDestroyed = true;

		// Cancel any pending animation frame
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}

		console.log('[PixelwiseAnimationLoop] Stopped');
	}

	/**
	 * Resets the loop to allow restarting after stop()
	 *
	 * NOTE: Only call this if you need to restart the loop.
	 * For normal cleanup, just call stop().
	 */
	reset(): void {
		this.isDestroyed = false;
		this.lastFrame = 0;
		this.rafId = null;

		console.log('[PixelwiseAnimationLoop] Reset');
	}

	/**
	 * Checks if the loop is currently running
	 */
	isRunning(): boolean {
		return this.rafId !== null && !this.isDestroyed;
	}

	/**
	 * Gets the current target FPS
	 */
	getTargetFps(): number {
		return this.targetFps;
	}

	/**
	 * Updates the target FPS
	 * Only takes effect if loop is restarted
	 */
	setTargetFps(fps: number): void {
		this.targetFps = fps;
		this.frameInterval = 1000 / fps;
		console.log(`[PixelwiseAnimationLoop] Target FPS updated to ${fps}`);
	}
}
