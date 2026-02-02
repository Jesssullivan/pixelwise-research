/**
 * ScreenCaptureSource - Screen Capture API wrapper
 *
 * Provides access to display content via getDisplayMedia() with
 * optimal frame timing via requestVideoFrameCallback.
 *
 * Features:
 * - Display/window/browser tab capture
 * - requestVideoFrameCallback for optimal frame timing
 * - MediaStreamTrackProcessor fallback for fine-grained control
 * - Auto-cleanup on stream end
 *
 * @module capture/ScreenCaptureSource
 */

import { browser } from '$app/environment';

/**
 * Configuration for screen capture
 */
export interface ScreenCaptureConfig {
	/** Whether to show cursor in capture */
	cursor: 'always' | 'motion' | 'never';
	/** Type of surface to capture */
	displaySurface: 'monitor' | 'window' | 'browser';
	/** Whether to include the current browser in capture options */
	selfBrowserSurface: 'include' | 'exclude';
	/** Whether to include system audio */
	systemAudio: 'include' | 'exclude';
	/** Whether to prefer current tab for capture */
	preferCurrentTab: boolean;
	/** Target frame rate (hint, not guaranteed) */
	frameRate?: number;
	/** Target width (hint) */
	width?: number;
	/** Target height (hint) */
	height?: number;
}

/**
 * Default configuration for screen capture
 */
export const DEFAULT_CAPTURE_CONFIG: ScreenCaptureConfig = {
	cursor: 'always',
	displaySurface: 'monitor',
	selfBrowserSurface: 'exclude',
	systemAudio: 'exclude',
	preferCurrentTab: false,
	frameRate: 60
};

/**
 * Metadata about a captured video frame
 */
export interface FrameMetadata {
	/** Frame presentation time in microseconds */
	presentationTime: number;
	/** Expected display time */
	expectedDisplayTime: number;
	/** Frame width in pixels */
	width: number;
	/** Frame height in pixels */
	height: number;
	/** Frame number since capture started */
	frameNumber: number;
	/** Time since last frame in milliseconds */
	deltaTime: number;
}

/**
 * Callback type for frame processing
 */
export type FrameCallback = (video: HTMLVideoElement, metadata: FrameMetadata) => void;

/**
 * State of the capture source
 */
export type CaptureState = 'idle' | 'requesting' | 'active' | 'paused' | 'stopped' | 'error';

/**
 * ScreenCaptureSource - Wraps Screen Capture API for video frame access
 *
 * @example
 * ```typescript
 * const capture = new ScreenCaptureSource();
 *
 * // Start capture with user permission
 * await capture.start();
 *
 * // Process frames
 * capture.onFrame((video, metadata) => {
 *   console.log(`Frame ${metadata.frameNumber}: ${metadata.width}x${metadata.height}`);
 *   // Import to WebGPU texture here
 * });
 *
 * // Stop when done
 * capture.stop();
 * ```
 */
export class ScreenCaptureSource {
	private video: HTMLVideoElement | null = null;
	private stream: MediaStream | null = null;
	private frameCallbackId: number | null = null;
	private frameCallback: FrameCallback | null = null;
	private frameNumber = 0;
	private lastFrameTime = 0;
	private _state: CaptureState = 'idle';
	private config: ScreenCaptureConfig;
	private errorMessage: string | null = null;

	/**
	 * Create a new ScreenCaptureSource
	 *
	 * @param config - Capture configuration options
	 */
	constructor(config: Partial<ScreenCaptureConfig> = {}) {
		this.config = { ...DEFAULT_CAPTURE_CONFIG, ...config };
	}

	/** Current capture state */
	get state(): CaptureState {
		return this._state;
	}

	/** Last error message if state is 'error' */
	get error(): string | null {
		return this.errorMessage;
	}

	/** Video element for texture import */
	get videoElement(): HTMLVideoElement | null {
		return this.video;
	}

	/** Media stream (for direct track access) */
	get mediaStream(): MediaStream | null {
		return this.stream;
	}

	/** Current video width */
	get width(): number {
		return this.video?.videoWidth ?? 0;
	}

	/** Current video height */
	get height(): number {
		return this.video?.videoHeight ?? 0;
	}

	/** Whether capture is currently active */
	get isActive(): boolean {
		return this._state === 'active';
	}

	/**
	 * Check if Screen Capture API is available
	 */
	static isSupported(): boolean {
		if (!browser) return false;
		return (
			typeof navigator !== 'undefined' &&
			'mediaDevices' in navigator &&
			'getDisplayMedia' in navigator.mediaDevices
		);
	}

	/**
	 * Check if requestVideoFrameCallback is available
	 */
	static hasVideoFrameCallback(): boolean {
		if (!browser) return false;
		return 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
	}

	/**
	 * Start screen capture
	 *
	 * This will prompt the user to select a capture source.
	 *
	 * @throws Error if capture fails or is denied
	 */
	async start(): Promise<void> {
		if (!browser) {
			throw new Error('Screen capture is only available in browser environment');
		}

		if (!ScreenCaptureSource.isSupported()) {
			throw new Error('Screen Capture API is not supported in this browser');
		}

		if (this._state === 'active') {
			console.warn('[ScreenCaptureSource] Capture already active');
			return;
		}

		this._state = 'requesting';
		this.errorMessage = null;

		try {
			// Build constraints from config
			const constraints: DisplayMediaStreamOptions = {
				video: {
					cursor: this.config.cursor,
					displaySurface: this.config.displaySurface,
					frameRate: this.config.frameRate,
					width: this.config.width,
					height: this.config.height
				} as MediaTrackConstraints,
				audio: this.config.systemAudio === 'include'
			};

			// Add experimental options if supported
			const extendedConstraints = constraints as DisplayMediaStreamOptions & {
				selfBrowserSurface?: string;
				preferCurrentTab?: boolean;
			};
			extendedConstraints.selfBrowserSurface = this.config.selfBrowserSurface;
			extendedConstraints.preferCurrentTab = this.config.preferCurrentTab;

			// Request user permission and get stream
			this.stream = await navigator.mediaDevices.getDisplayMedia(extendedConstraints);

			// Set up video element
			this.video = document.createElement('video');
			this.video.srcObject = this.stream;
			this.video.muted = true;
			this.video.autoplay = true;
			this.video.playsInline = true;

			// Handle stream ending (user clicks "Stop sharing")
			const videoTrack = this.stream.getVideoTracks()[0];
			if (videoTrack) {
				videoTrack.addEventListener('ended', () => {
					this.handleStreamEnded();
				});
			}

			// Wait for video to be ready
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error('Video element failed to load within timeout'));
				}, 10000);

				this.video!.addEventListener(
					'loadedmetadata',
					() => {
						clearTimeout(timeout);
						resolve();
					},
					{ once: true }
				);

				this.video!.addEventListener(
					'error',
					(e) => {
						clearTimeout(timeout);
						reject(new Error(`Video error: ${e}`));
					},
					{ once: true }
				);
			});

			// Start playback
			await this.video.play();

			this._state = 'active';
			this.frameNumber = 0;
			this.lastFrameTime = performance.now();

			// Start frame callback loop if callback is registered
			if (this.frameCallback) {
				this.startFrameLoop();
			}

			console.log(
				`[ScreenCaptureSource] Capture started: ${this.video.videoWidth}x${this.video.videoHeight}`
			);
		} catch (err) {
			this._state = 'error';
			this.errorMessage = err instanceof Error ? err.message : String(err);

			// Clean up on error
			this.cleanup();

			throw err;
		}
	}

	/**
	 * Stop capture and release resources
	 */
	stop(): void {
		if (this._state === 'stopped') return;

		this._state = 'stopped';
		this.cleanup();
		console.log('[ScreenCaptureSource] Capture stopped');
	}

	/**
	 * Pause frame processing (stream continues)
	 */
	pause(): void {
		if (this._state !== 'active') return;

		this._state = 'paused';
		this.stopFrameLoop();

		if (this.video) {
			this.video.pause();
		}
	}

	/**
	 * Resume frame processing
	 */
	resume(): void {
		if (this._state !== 'paused') return;

		this._state = 'active';

		if (this.video) {
			this.video.play();
		}

		if (this.frameCallback) {
			this.startFrameLoop();
		}
	}

	/**
	 * Register a callback to be called on each video frame
	 *
	 * Uses requestVideoFrameCallback for optimal timing if available,
	 * falls back to requestAnimationFrame otherwise.
	 *
	 * @param callback - Function to call with video element and frame metadata
	 */
	onFrame(callback: FrameCallback): void {
		this.frameCallback = callback;

		// Start loop if capture is already active
		if (this._state === 'active') {
			this.startFrameLoop();
		}
	}

	/**
	 * Remove frame callback
	 */
	offFrame(): void {
		this.frameCallback = null;
		this.stopFrameLoop();
	}

	/**
	 * Get a single snapshot as ImageBitmap
	 */
	async captureSnapshot(): Promise<ImageBitmap | null> {
		if (!this.video || this._state !== 'active') {
			return null;
		}

		return createImageBitmap(this.video);
	}

	/**
	 * Update capture configuration
	 *
	 * Note: Some changes may require restarting capture
	 */
	updateConfig(config: Partial<ScreenCaptureConfig>): void {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Start the frame callback loop
	 */
	private startFrameLoop(): void {
		if (!this.video || this.frameCallbackId !== null) return;

		if (ScreenCaptureSource.hasVideoFrameCallback()) {
			// Use requestVideoFrameCallback for optimal frame timing
			const handleFrame = (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
				if (this._state !== 'active' || !this.frameCallback || !this.video) return;

				const deltaTime = now - this.lastFrameTime;
				this.lastFrameTime = now;
				this.frameNumber++;

				const frameMetadata: FrameMetadata = {
					presentationTime: metadata.presentationTime,
					expectedDisplayTime: metadata.expectedDisplayTime,
					width: metadata.width,
					height: metadata.height,
					frameNumber: this.frameNumber,
					deltaTime
				};

				this.frameCallback(this.video, frameMetadata);

				// Schedule next frame
				this.frameCallbackId = this.video.requestVideoFrameCallback(handleFrame);
			};

			this.frameCallbackId = this.video.requestVideoFrameCallback(handleFrame);
		} else {
			// Fallback to requestAnimationFrame
			const handleFrame = () => {
				if (this._state !== 'active' || !this.frameCallback || !this.video) return;

				const now = performance.now();
				const deltaTime = now - this.lastFrameTime;
				this.lastFrameTime = now;
				this.frameNumber++;

				const frameMetadata: FrameMetadata = {
					presentationTime: now * 1000, // Convert to microseconds
					expectedDisplayTime: now * 1000,
					width: this.video.videoWidth,
					height: this.video.videoHeight,
					frameNumber: this.frameNumber,
					deltaTime
				};

				this.frameCallback(this.video, frameMetadata);

				// Schedule next frame
				this.frameCallbackId = requestAnimationFrame(handleFrame);
			};

			this.frameCallbackId = requestAnimationFrame(handleFrame);
		}
	}

	/**
	 * Stop the frame callback loop
	 */
	private stopFrameLoop(): void {
		if (this.frameCallbackId === null) return;

		if (ScreenCaptureSource.hasVideoFrameCallback() && this.video) {
			this.video.cancelVideoFrameCallback(this.frameCallbackId);
		} else {
			cancelAnimationFrame(this.frameCallbackId);
		}

		this.frameCallbackId = null;
	}

	/**
	 * Handle stream ending (user stopped sharing)
	 */
	private handleStreamEnded(): void {
		console.log('[ScreenCaptureSource] Stream ended by user');
		this._state = 'stopped';
		this.cleanup();
	}

	/**
	 * Clean up resources
	 */
	private cleanup(): void {
		this.stopFrameLoop();

		if (this.stream) {
			this.stream.getTracks().forEach((track) => track.stop());
			this.stream = null;
		}

		if (this.video) {
			this.video.srcObject = null;
			this.video = null;
		}
	}
}

/**
 * Create a ScreenCaptureSource with default configuration
 */
export function createScreenCaptureSource(
	config?: Partial<ScreenCaptureConfig>
): ScreenCaptureSource {
	return new ScreenCaptureSource(config);
}

/**
 * Quick capture start - creates source and starts capture in one call
 */
export async function startScreenCapture(
	config?: Partial<ScreenCaptureConfig>
): Promise<ScreenCaptureSource> {
	const source = new ScreenCaptureSource(config);
	await source.start();
	return source;
}
