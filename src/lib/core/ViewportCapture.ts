/**
 * ViewportCapture - Screen Capture API to SharedArrayBuffer
 *
 * Captures the screen/window/tab using the Screen Capture API and provides
 * the RGBA pixel data via SharedArrayBuffer for zero-copy transfer to
 * WASM/WebGPU processing.
 *
 * Key features:
 * - Uses Screen Capture API (getDisplayMedia) for real pixel capture
 * - Zero-copy video frame import via canvas
 * - requestVideoFrameCallback for optimal frame timing
 * - Returns SharedArrayBuffer for efficient WASM interop
 *
 * @module ViewportCapture
 */

import { browser } from '$app/environment';
import {
	ScreenCaptureSource,
	type ScreenCaptureConfig,
	type FrameMetadata
} from '$lib/capture/ScreenCaptureSource';

export interface CaptureOptions {
	/** Element to capture (ignored - captures full screen/window) */
	element?: HTMLElement;
	/** Scale factor for high-DPI (default: 1, screen capture is already at native resolution) */
	scale?: number;
	/** Whether to include scroll position metadata */
	includeScrollPosition?: boolean;
	/** Maximum dimensions to capture (for performance) */
	maxWidth?: number;
	maxHeight?: number;
}

export interface CaptureResult {
	/** RGBA pixel data (width * height * 4 bytes) */
	data: Uint8ClampedArray;
	/** Image width in pixels */
	width: number;
	/** Image height in pixels */
	height: number;
	/** Device pixel ratio used for capture */
	scale: number;
	/** Scroll position at time of capture */
	scrollX: number;
	scrollY: number;
	/** Timestamp of capture */
	timestamp: number;
}

export interface ViewportCaptureState {
	isCapturing: boolean;
	isActive: boolean;
	lastCapture: CaptureResult | null;
	error: Error | null;
}

/**
 * Creates a viewport capture utility using Screen Capture API.
 * Replaces html2canvas with real screen capture for accurate pixels.
 */
export function createViewportCapture() {
	let captureSource: ScreenCaptureSource | null = null;
	let canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
	let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
	let latestFrameData: CaptureResult | null = null;

	// Track pending start to prevent race conditions
	let startPromise: Promise<boolean> | null = null;

	const state: ViewportCaptureState = {
		isCapturing: false,
		isActive: false,
		lastCapture: null,
		error: null
	};

	/**
	 * Initialize the capture canvas for a given size
	 */
	function initializeCanvas(width: number, height: number): boolean {
		if (!browser) return false;

		try {
			// Resize existing canvas or create new one
			if (canvas) {
				if (canvas instanceof OffscreenCanvas) {
					canvas.width = width;
					canvas.height = height;
				} else {
					canvas.width = width;
					canvas.height = height;
				}
			} else {
				// Try OffscreenCanvas first for better performance
				if (typeof OffscreenCanvas !== 'undefined') {
					canvas = new OffscreenCanvas(width, height);
					ctx = canvas.getContext('2d', {
						willReadFrequently: true,
						alpha: false
					});
				} else {
					// Fallback to regular canvas
					canvas = document.createElement('canvas');
					canvas.width = width;
					canvas.height = height;
					ctx = canvas.getContext('2d', {
						willReadFrequently: true,
						alpha: false
					});
				}
			}

			return ctx !== null;
		} catch (err: unknown) {
			state.error = err instanceof Error ? err : new Error(String(err));
			return false;
		}
	}

	/**
	 * Start screen capture - prompts user for permission
	 */
	async function startCapture(config?: Partial<ScreenCaptureConfig>): Promise<boolean> {
		if (!browser) return false;
		if (state.isActive) return true;

		// If already starting, wait for that attempt
		if (startPromise) {
			return startPromise;
		}

		// Create and store the start promise to prevent duplicate attempts
		startPromise = (async () => {
			try {
				captureSource = new ScreenCaptureSource({
					cursor: 'always',
					displaySurface: 'browser', // Default to browser tab
					selfBrowserSurface: 'include', // Include self for compositor demo
					...config
				});

				await captureSource.start();

				// Set up frame callback to continuously update latestFrameData
				captureSource.onFrame((video, metadata) => {
					captureFrameFromVideo(video, metadata);
				});

				state.isActive = true;
				state.error = null;

				console.log(
					`[ViewportCapture] Screen capture started: ${captureSource.width}x${captureSource.height}`
				);
				return true;
			} catch (err: unknown) {
				state.error = err instanceof Error ? err : new Error(String(err));
				console.error('[ViewportCapture] Failed to start capture:', err);
				return false;
			} finally {
				startPromise = null;
			}
		})();

		return startPromise;
	}

	/**
	 * Capture a frame from the video element
	 */
	function captureFrameFromVideo(video: HTMLVideoElement, metadata: FrameMetadata): void {
		if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

		const width = video.videoWidth;
		const height = video.videoHeight;

		// Initialize or resize canvas
		if (!canvas || canvas.width !== width || canvas.height !== height) {
			if (!initializeCanvas(width, height)) {
				return;
			}
		}

		if (!ctx) return;

		try {
			// Draw video frame to canvas
			ctx.drawImage(video, 0, 0, width, height);

			// Extract pixel data
			const imageData = ctx.getImageData(0, 0, width, height);

			latestFrameData = {
				data: imageData.data,
				width,
				height,
				scale: 1,
				scrollX: 0,
				scrollY: 0,
				timestamp: performance.now()
			};

			state.lastCapture = latestFrameData;
		} catch (err: unknown) {
			// Ignore frame errors, they happen during transitions
		}
	}

	/**
	 * Capture the current frame (returns latest captured frame)
	 *
	 * If screen capture is not active, attempts to start it.
	 * For continuous capture, the frame is updated via requestVideoFrameCallback.
	 */
	async function capture(options: CaptureOptions = {}): Promise<CaptureResult | null> {
		if (!browser) return null;

		// If a start is in progress, wait for it
		if (startPromise) {
			await startPromise;
		}

		// If capture not started, start it (will prompt user)
		if (!state.isActive && !startPromise) {
			const started = await startCapture();
			if (!started) {
				return null;
			}

			// Wait a bit for first frame
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		// Return the latest captured frame
		if (latestFrameData) {
			return latestFrameData;
		}

		return null;
	}

	/**
	 * Capture from an existing ImageData or canvas
	 */
	function captureFromImageData(imageData: ImageData): CaptureResult {
		return {
			data: imageData.data,
			width: imageData.width,
			height: imageData.height,
			scale: 1,
			scrollX: 0,
			scrollY: 0,
			timestamp: performance.now()
		};
	}

	/**
	 * Capture from a video element (for external video sources)
	 */
	async function captureFromVideo(video: HTMLVideoElement): Promise<CaptureResult | null> {
		if (!browser) return null;

		try {
			const width = video.videoWidth;
			const height = video.videoHeight;

			if (width === 0 || height === 0) {
				return null;
			}

			if (!canvas || canvas.width !== width || canvas.height !== height) {
				if (!initializeCanvas(width, height)) {
					throw new Error('Failed to initialize capture canvas');
				}
			}

			if (!ctx) {
				throw new Error('Canvas context not available');
			}

			ctx.drawImage(video, 0, 0, width, height);
			const imageData = ctx.getImageData(0, 0, width, height);

			return {
				data: imageData.data,
				width,
				height,
				scale: 1,
				scrollX: 0,
				scrollY: 0,
				timestamp: performance.now()
			};
		} catch (err: unknown) {
			state.error = err instanceof Error ? err : new Error(String(err));
			return null;
		}
	}

	/**
	 * Convert capture result to Float32Array of grayscale levels
	 * Uses WCAG luminance formula: 0.2126*R + 0.7152*G + 0.0722*B
	 */
	function toGrayscaleLevels(capture: CaptureResult): Float32Array {
		const { data, width, height } = capture;
		const levels = new Float32Array(width * height);

		for (let i = 0; i < width * height; i++) {
			const r = data[i * 4] / 255;
			const g = data[i * 4 + 1] / 255;
			const b = data[i * 4 + 2] / 255;

			// WCAG luminance weights
			levels[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		}

		return levels;
	}

	/**
	 * Stop capture and cleanup resources
	 */
	function stopCapture(): void {
		startPromise = null;
		if (captureSource) {
			captureSource.stop();
			captureSource = null;
		}
		state.isActive = false;
		latestFrameData = null;
	}

	/**
	 * Cleanup all resources
	 */
	function destroy() {
		stopCapture();
		canvas = null;
		ctx = null;
		state.lastCapture = null;
		state.error = null;
	}

	/**
	 * Check if Screen Capture API is supported
	 */
	function isSupported(): boolean {
		return ScreenCaptureSource.isSupported();
	}

	return {
		capture,
		captureFromImageData,
		captureFromVideo,
		toGrayscaleLevels,
		startCapture,
		stopCapture,
		destroy,
		isSupported,
		get state() {
			return state;
		},
		get captureSource() {
			return captureSource;
		}
	};
}

export type ViewportCapture = ReturnType<typeof createViewportCapture>;
