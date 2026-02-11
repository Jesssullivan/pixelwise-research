/**
 * useWebGPUStatus - Svelte 5 Composable for WebGPU Detection
 *
 * Provides reactive WebGPU status throughout the app, replacing ad-hoc detection patterns.
 * This hook centralizes all WebGPU capability detection, browser info parsing, and
 * fallback mode determination.
 *
 * Usage:
 * ```svelte
 * <script>
 *   import { useWebGPUStatus } from '$lib/composables/useWebGPUStatus.svelte';
 *
 *   const webgpu = useWebGPUStatus();
 * </script>
 *
 * {#if webgpu.isDetecting}
 *   <Spinner />
 * {:else if webgpu.available}
 *   <SuccessBadge adapter={webgpu.adapter} />
 * {:else}
 *   <WebGPUInstructions recommendation={webgpu.recommendation} />
 * {/if}
 * ```
 *
 * @module useWebGPUStatus
 */

import { browser } from '$app/environment';
import {
	getCapabilitiesAsync,
	type FeatureCapabilities
} from '$lib/pixelwise/featureDetection';
import {
	parseBrowserInfo,
	checkWebGPUBrowserSupport,
	getWebGPUUnavailabilityReason,
	type BrowserInfo
} from '$lib/pixelwise/browserSupport';

export interface WebGPUStatus {
	// Detection state
	readonly isDetecting: boolean;
	readonly available: boolean;
	readonly adapter: string | null;
	readonly gpuTier: 0 | 1 | 2 | 3;
	readonly error: Error | null;

	// Browser info
	readonly browserName: string;
	readonly browserVersion: string;
	readonly platform: string;
	readonly isMobile: boolean;

	// Screen capture
	readonly screenCaptureAvailable: boolean;
	readonly screenCaptureError: string | null;

	// Derived status
	readonly isReady: boolean;
	readonly needsInstructions: boolean;
	readonly recommendation: string;

	// Capabilities
	readonly capabilities: FeatureCapabilities | null;
	readonly fallbackMode: 'webgpu' | 'wasm-multicore' | 'js-fallback' | 'none';

	// Methods
	redetect(): Promise<void>;
	testScreenCapture(): Promise<boolean>;
}

/**
 * Creates a reactive WebGPU status composable with Svelte 5 runes
 */
export function useWebGPUStatus(): WebGPUStatus {
	// State - using $state for Svelte 5 reactivity
	let isDetecting = $state(true);
	let capabilities = $state<FeatureCapabilities | null>(null);
	let error = $state<Error | null>(null);
	let browserInfo = $state<BrowserInfo>({
		name: 'Unknown',
		version: '0',
		fullVersion: '0.0.0',
		os: 'Unknown',
		isMobile: false
	});

	// Screen capture state
	let screenCaptureAvailable = $state(false);
	let screenCaptureError = $state<string | null>(null);

	// Derived values using $derived.by()
	const available = $derived.by(() => {
		return capabilities?.webgpu ?? false;
	});

	const adapter = $derived.by(() => {
		return capabilities?.webgpuAdapter ?? null;
	});

	const gpuTier = $derived.by(() => {
		return capabilities?.gpuTier ?? 0;
	});

	const isReady = $derived.by(() => {
		return !isDetecting && available;
	});

	const needsInstructions = $derived.by(() => {
		if (!browser) return false;
		return !isDetecting && !available;
	});

	const recommendation = $derived.by(() => {
		if (isDetecting) return 'Detecting WebGPU capabilities...';
		if (available) return 'WebGPU is available and ready!';

		// Get browser-specific recommendation
		const support = checkWebGPUBrowserSupport();
		if (support.detailedIssue) {
			return support.detailedIssue;
		}
		return support.recommendation || getWebGPUUnavailabilityReason();
	});

	const fallbackMode = $derived.by((): 'webgpu' | 'wasm-multicore' | 'js-fallback' | 'none' => {
		if (!capabilities) return 'none';

		// WebGPU is the primary path
		if (capabilities.webgpu && capabilities.wasm) {
			return 'webgpu';
		}

		// Futhark WASM multicore requires SharedArrayBuffer (COOP/COEP headers)
		if (capabilities.wasm && capabilities.sharedArrayBuffer) {
			return 'wasm-multicore';
		}

		// Basic WASM without SharedArrayBuffer (single-threaded)
		if (capabilities.wasm) {
			return 'js-fallback';
		}

		return 'none';
	});

	/**
	 * Run detection (called on first use and on redetect)
	 */
	async function detect(): Promise<void> {
		if (!browser) {
			isDetecting = false;
			return;
		}

		isDetecting = true;
		error = null;

		try {
			// Parse browser info synchronously
			browserInfo = parseBrowserInfo();

			// Run async capability detection (includes full WebGPU adapter verification)
			capabilities = await getCapabilitiesAsync();
		} catch (err: unknown) {
			error = err instanceof Error ? err : new Error(String(err));
			console.error('[useWebGPUStatus] Detection failed:', err);
		} finally {
			isDetecting = false;
		}
	}

	/**
	 * Force re-detection of capabilities
	 * Useful after user changes browser settings or enables WebGPU flags
	 */
	async function redetect(): Promise<void> {
		// Clear cached capabilities in featureDetection module
		const { clearCapabilitiesCache } = await import('$lib/pixelwise/featureDetection');
		clearCapabilitiesCache();
		await detect();
	}

	/**
	 * Test screen capture permission by requesting and immediately stopping a stream.
	 * Returns true if permission was granted.
	 */
	async function testScreenCapture(): Promise<boolean> {
		if (!browser) return false;

		try {
			const stream = await navigator.mediaDevices.getDisplayMedia({
				video: { width: 1, height: 1 }
			});
			// Immediately stop all tracks
			stream.getTracks().forEach(track => track.stop());
			screenCaptureAvailable = true;
			screenCaptureError = null;
			return true;
		} catch (err: unknown) {
			screenCaptureAvailable = false;
			screenCaptureError = err instanceof Error ? err.message : String(err);
			return false;
		}
	}

	// Initialize detection when hook is first used
	if (browser) {
		detect();
		// Check screen capture API availability (not permission, just API presence)
		screenCaptureAvailable = typeof navigator?.mediaDevices?.getDisplayMedia === 'function';
	} else {
		isDetecting = false;
	}

	// Return reactive getters - Svelte 5 runes handle reactivity automatically
	return {
		// Detection state
		get isDetecting() {
			return isDetecting;
		},
		get available() {
			return available;
		},
		get adapter() {
			return adapter;
		},
		get gpuTier() {
			return gpuTier;
		},
		get error() {
			return error;
		},

		// Browser info
		get browserName() {
			return browserInfo.name;
		},
		get browserVersion() {
			return browserInfo.version;
		},
		get platform() {
			return browserInfo.os;
		},
		get isMobile() {
			return browserInfo.isMobile;
		},

		// Screen capture
		get screenCaptureAvailable() {
			return screenCaptureAvailable;
		},
		get screenCaptureError() {
			return screenCaptureError;
		},

		// Derived status
		get isReady() {
			return isReady;
		},
		get needsInstructions() {
			return needsInstructions;
		},
		get recommendation() {
			return recommendation;
		},

		// Capabilities
		get capabilities() {
			return capabilities;
		},
		get fallbackMode() {
			return fallbackMode;
		},

		// Methods
		redetect,
		testScreenCapture
	};
}

export type WebGPUStatusResult = ReturnType<typeof useWebGPUStatus>;
