/**
 * Feature Detection for Pixelwise WCAG Compositor
 *
 * Provides feature detection for:
 * - WebGPU support (primary path - Futhark WebGPU backend)
 * - Futhark WASM multicore (CPU fallback via Emscripten pthreads)
 *
 * Architecture: Futhark WebGPU → Futhark WASM → Error
 *
 * Note: Futhark's wasm-multicore backend uses Emscripten pthreads (Web Workers)
 * for parallelism, NOT WASM SIMD v128 instructions. SharedArrayBuffer is
 * required for the multicore backend (COOP/COEP headers must be set).
 */

import { browser } from '$app/environment';

// ============================================================================
// Types
// ============================================================================

// Research mode: WebGPU or nothing. No fallbacks.
export type CompositorMode = 'webgpu' | 'none';

export interface FeatureCapabilities {
	/** WebGPU is available and functional (PRIMARY - GPU compute) */
	webgpu: boolean;

	/** WebGPU adapter info (for debugging) */
	webgpuAdapter: string | null;

	/** WebAssembly is available */
	wasm: boolean;

	/** WASM SIMD is available (v128 instructions) - detected but not currently used by Futhark */
	wasmSimd: boolean;

	/** SharedArrayBuffer is available (requires COOP/COEP headers) */
	sharedArrayBuffer: boolean;

	/** OffscreenCanvas is available */
	offscreenCanvas: boolean;

	/** Device pixel ratio */
	devicePixelRatio: number;

	/** Estimated GPU tier (0 = none, 1 = low, 2 = mid, 3 = high) */
	gpuTier: 0 | 1 | 2 | 3;

	/** Recommended compositor mode based on capabilities */
	recommendedMode: CompositorMode;

	/** Whether the device is mobile */
	isMobile: boolean;

	/** Whether reduced motion is preferred */
	prefersReducedMotion: boolean;

	/** @deprecated WebGL2 detection kept for compatibility checks */
	webgl2: boolean;

	// Screen Capture capabilities
	/** Screen Capture API (getDisplayMedia) is available */
	screenCapture: boolean;

	/** importExternalTexture is supported (zero-copy video) */
	importExternalTexture: boolean;

	/** copyExternalImageToTexture is supported (fallback video import) */
	copyExternalImage: boolean;

	/** requestVideoFrameCallback is available */
	videoFrameCallback: boolean;

	/** MediaStreamTrackProcessor is available (WebCodecs) */
	mediaStreamTrackProcessor: boolean;
}

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Check if WebGPU is available and functional
 * This is the PRIMARY detection - enables GPU compute path
 */
export async function detectWebGPU(): Promise<{ available: boolean; adapter: string | null }> {
	if (!browser) return { available: false, adapter: null };

	try {
		// Check if navigator.gpu exists
		if (!navigator.gpu) {
			console.error('[featureDetection] WebGPU: navigator.gpu not available');
			console.log('[featureDetection] Browser:', navigator.userAgent);
			console.log('[featureDetection] Secure Context:', window.isSecureContext);
			console.log('[featureDetection] Origin:', window.location.origin);
			console.log('[featureDetection] Cross-Origin Isolated:', typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated);
			return { available: false, adapter: null };
		}

		console.log('[featureDetection] WebGPU: navigator.gpu exists, requesting adapter...');

		// Request adapter - try high-performance first (discrete GPU)
		let adapter = await navigator.gpu.requestAdapter({
			powerPreference: 'high-performance'
		});

		// Fallback to default if null
		if (!adapter) {
			console.log('[featureDetection] Retrying with default power preference...');
			adapter = await navigator.gpu.requestAdapter();

			if (!adapter) {
				console.error('[featureDetection] WebGPU: No adapter available after fallback');
				console.log('[featureDetection] This may indicate:');
				console.log('  - GPU is blacklisted by browser');
				console.log('  - Running in headless/VM environment');
				console.log('  - Browser does not support WebGPU on this system');
				return { available: false, adapter: null };
			}
		}

		// Get adapter info for debugging (with compatibility check for older WebGPU implementations)
		let adapterInfo = 'Unknown Adapter';
		let info: GPUAdapterInfo | null = null;

		// Type-safe check for newer WebGPU API methods
		// GPUAdapter may have requestAdapterInfo in newer specs (v1.1+)
		// and isFallbackAdapter as a property
		interface ExtendedGPUAdapter extends GPUAdapter {
			requestAdapterInfo?: () => Promise<GPUAdapterInfo>;
			isFallbackAdapter?: boolean;
		}
		const extendedAdapter = adapter as ExtendedGPUAdapter;

		if (typeof extendedAdapter.requestAdapterInfo === 'function') {
			try {
				info = await extendedAdapter.requestAdapterInfo();
				adapterInfo = `${info.vendor} ${info.architecture} (${info.device})`;

				console.log('[featureDetection] WebGPU Adapter Details:', {
					vendor: info.vendor,
					architecture: info.architecture,
					device: info.device,
					description: info.description,
					features: Array.from(adapter.features),
					isFallbackAdapter: extendedAdapter.isFallbackAdapter ?? false,
					limits: {
						maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
						maxBufferSize: adapter.limits.maxBufferSize,
						maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize
					}
				});
			} catch (error: unknown) {
				console.warn('[featureDetection] requestAdapterInfo() failed:', error);
				adapterInfo = 'WebGPU Adapter (info unavailable)';
			}
		} else {
			// Fallback for older WebGPU implementations (pre-v1.1)
			console.warn('[featureDetection] requestAdapterInfo() not available (WebGPU < v1.1)');
			adapterInfo = 'WebGPU Adapter (legacy)';

			// Log basic adapter info without requestAdapterInfo()
			console.log('[featureDetection] WebGPU Adapter Details (basic):', {
				features: Array.from(adapter.features),
				isFallbackAdapter: extendedAdapter.isFallbackAdapter ?? false,
				limits: {
					maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
					maxBufferSize: adapter.limits.maxBufferSize,
					maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize
				}
			});
		}

		// Check for required features
		const requiredFeatures: GPUFeatureName[] = [];
		for (const feature of requiredFeatures) {
			if (!adapter.features.has(feature)) {
				console.warn(`[featureDetection] WebGPU: Missing feature ${feature}`);
				return { available: false, adapter: adapterInfo };
			}
		}

		// Try to request a device to verify functionality
		let device: GPUDevice;
		try {
			device = await adapter.requestDevice({
				requiredFeatures: [],
				requiredLimits: {
					maxBufferSize: 256 * 1024 * 1024 // 256MB for pixel buffer
				}
			});
		} catch (error: unknown) {
			console.error('[featureDetection] WebGPU: Device request failed:', error);
			console.log('[featureDetection] This may indicate insufficient GPU limits');
			return { available: false, adapter: adapterInfo };
		}

		// Verify we can create a buffer with MAP_WRITE (required for WASM direct access)
		try {
			const testBuffer = device.createBuffer({
				size: 256,
				usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
				mappedAtCreation: true
			});
			testBuffer.unmap();
			testBuffer.destroy();
		} catch (e: unknown) {
			console.warn('[featureDetection] WebGPU: Buffer mapping not supported');
			return { available: false, adapter: adapterInfo };
		}

		// Cleanup
		device.destroy();

		console.log(`[featureDetection] WebGPU: Available (${adapterInfo})`);
		return { available: true, adapter: adapterInfo };
	} catch (e: unknown) {
		console.warn('[featureDetection] WebGPU detection failed:', e);
		return { available: false, adapter: null };
	}
}

/**
 * Synchronous WebGPU check (basic - for initial detection)
 * Use detectWebGPU() for full async detection
 */
export function detectWebGPUSync(): boolean {
	if (!browser) return false;
	return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Check if WASM SIMD (v128) is available
 * Note: Futhark's wasm-multicore backend does NOT use SIMD instructions.
 * This detection is kept for future optimizations and browser capability reporting.
 */
export function detectWASMSimd(): boolean {
	if (!browser) return false;

	try {
		// Test for SIMD support by compiling a valid WASM module with v128 type
		// This is a minimal module: func test() -> v128 { v128.const 0 }
		//
		// Bytecode breakdown:
		// - Magic + Version: 8 bytes
		// - Type section (id=1): func () -> v128
		// - Function section (id=3): 1 function using type 0
		// - Code section (id=10): body with v128.const + 16 zero bytes
		//
		// Body size = 1 (locals count) + 2 (v128.const opcode) + 16 (constant) + 1 (end) = 20 = 0x14
		// Code section size = 1 (func count) + 1 (body size) + 20 (body) = 22 = 0x16
		const simdTest = new Uint8Array([
			// WASM magic + version
			0x00, 0x61, 0x73, 0x6d, // magic: \0asm
			0x01, 0x00, 0x00, 0x00, // version: 1

			// Type section (id=1)
			0x01,                   // section id: type
			0x05,                   // section size: 5 bytes
			0x01,                   // num types: 1
			0x60,                   // func type
			0x00,                   // num params: 0
			0x01,                   // num results: 1
			0x7b,                   // result type: v128

			// Function section (id=3)
			0x03,                   // section id: function
			0x02,                   // section size: 2 bytes
			0x01,                   // num functions: 1
			0x00,                   // function 0 uses type index 0

			// Code section (id=10)
			0x0a,                   // section id: code
			0x16,                   // section size: 22 bytes
			0x01,                   // num functions: 1
			0x14,                   // body size: 20 bytes
			0x00,                   // num local groups: 0
			0xfd, 0x0c,             // v128.const (SIMD prefix 0xfd, opcode 0x0c)
			0x00, 0x00, 0x00, 0x00, // v128 constant (16 zero bytes)
			0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00,
			0x0b                    // end
		]);

		const module = new WebAssembly.Module(simdTest);
		const isValid = module instanceof WebAssembly.Module;

		if (isValid) {
			console.log('[featureDetection] WASM SIMD: Available');
		}

		return isValid;
	} catch (e: unknown) {
		console.log('[featureDetection] WASM SIMD not available:', e);
		return false;
	}
}

/**
 * Check if WebGL2 is available and functional
 * @deprecated WebGL2 is not used by the Futhark WebGPU backend.
 * Kept only for GPU tier estimation. Use detectWebGPU() for primary detection.
 */
export function detectWebGL2(): boolean {
	if (!browser) return false;

	try {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2');

		if (!gl) return false;

		// Check for required extensions
		const requiredExtensions: string[] = [
			// EXT_color_buffer_float is nice but not required
		];

		for (const ext of requiredExtensions) {
			if (!gl.getExtension(ext)) {
				console.warn(`[featureDetection] Missing WebGL2 extension: ${ext}`);
				return false;
			}
		}

		// Verify basic functionality
		const testShader = gl.createShader(gl.FRAGMENT_SHADER);
		if (!testShader) return false;

		gl.shaderSource(testShader, '#version 300 es\nprecision highp float;\nout vec4 c;\nvoid main(){c=vec4(1);}');
		gl.compileShader(testShader);

		const success = gl.getShaderParameter(testShader, gl.COMPILE_STATUS);
		gl.deleteShader(testShader);

		// Cleanup context
		const loseContext = gl.getExtension('WEBGL_lose_context');
		if (loseContext) loseContext.loseContext();

		return success;
	} catch (e: unknown) {
		console.warn('[featureDetection] WebGL2 detection failed:', e);
		return false;
	}
}

/**
 * Check if WebAssembly is available
 */
export function detectWASM(): boolean {
	if (!browser) return false;

	try {
		if (typeof WebAssembly !== 'object') return false;

		// Check for basic WASM functionality
		const module = new WebAssembly.Module(
			Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00)
		);
		return module instanceof WebAssembly.Module;
	} catch (e: unknown) {
		console.warn('[featureDetection] WASM detection failed:', e);
		return false;
	}
}

/**
 * Check if SharedArrayBuffer is available
 * Requires Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers
 */
export function detectSharedArrayBuffer(): boolean {
	if (!browser) return false;

	try {
		return typeof SharedArrayBuffer !== 'undefined' &&
			new SharedArrayBuffer(1) instanceof SharedArrayBuffer;
	} catch (e: unknown) {
		return false;
	}
}

/**
 * Check if OffscreenCanvas is available
 */
export function detectOffscreenCanvas(): boolean {
	if (!browser) return false;

	try {
		return typeof OffscreenCanvas !== 'undefined' &&
			new OffscreenCanvas(1, 1) instanceof OffscreenCanvas;
	} catch (e: unknown) {
		return false;
	}
}

/**
 * Estimate GPU tier based on available features and performance hints
 */
export function estimateGPUTier(): 0 | 1 | 2 | 3 {
	if (!browser) return 0;

	try {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

		if (!gl) return 0;

		// Get renderer info
		const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
		let renderer = '';

		if (debugInfo) {
			renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
		}

		// Check for known high-end GPUs
		const highEnd = /nvidia|geforce|rtx|gtx|radeon rx|intel iris/i;
		const midRange = /intel hd|intel uhd|radeon|amd|mali-g7|adreno 6/i;
		const lowEnd = /mali-4|mali-t|adreno 3|adreno 4|adreno 5|powervr|intel gma/i;

		if (highEnd.test(renderer)) return 3;
		if (midRange.test(renderer)) return 2;
		if (lowEnd.test(renderer)) return 1;

		// Fallback: check max texture size as proxy
		const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
		if (maxTextureSize >= 16384) return 3;
		if (maxTextureSize >= 8192) return 2;
		if (maxTextureSize >= 4096) return 1;

		return 1; // Default to low tier
	} catch (e: unknown) {
		return 0;
	}
}

/**
 * Check if device is mobile
 */
export function detectMobile(): boolean {
	if (!browser) return false;

	return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
		navigator.userAgent
	) || (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
}

/**
 * Check if reduced motion is preferred
 */
export function detectPrefersReducedMotion(): boolean {
	if (!browser) return false;

	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ============================================================================
// Screen Capture Detection Functions
// ============================================================================

/**
 * Check if Screen Capture API is available
 */
export function detectScreenCapture(): boolean {
	if (!browser) return false;

	return (
		typeof navigator !== 'undefined' &&
		'mediaDevices' in navigator &&
		'getDisplayMedia' in navigator.mediaDevices
	);
}

/**
 * Check if importExternalTexture is supported (zero-copy video import)
 */
export function detectImportExternalTexture(): boolean {
	if (!browser) return false;

	return typeof GPUDevice !== 'undefined' && 'importExternalTexture' in GPUDevice.prototype;
}

/**
 * Check if copyExternalImageToTexture is supported (fallback video import)
 */
export function detectCopyExternalImage(): boolean {
	if (!browser) return false;

	return typeof GPUQueue !== 'undefined' && 'copyExternalImageToTexture' in GPUQueue.prototype;
}

/**
 * Check if requestVideoFrameCallback is available
 */
export function detectVideoFrameCallback(): boolean {
	if (!browser) return false;

	return 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
}

/**
 * Check if MediaStreamTrackProcessor is available (WebCodecs)
 */
export function detectMediaStreamTrackProcessor(): boolean {
	if (!browser) return false;

	return 'MediaStreamTrackProcessor' in window;
}

// ============================================================================
// Main Detection Function
// ============================================================================

/**
 * Detect all capabilities and recommend compositor mode (SYNC version)
 * For full WebGPU detection, use detectCapabilitiesAsync()
 */
export function detectCapabilities(): FeatureCapabilities {
	const webgpu = detectWebGPUSync();
	const webgl2 = detectWebGL2();
	const wasm = detectWASM();
	const wasmSimd = detectWASMSimd();
	const sharedArrayBuffer = detectSharedArrayBuffer();
	const offscreenCanvas = detectOffscreenCanvas();
	const gpuTier = estimateGPUTier();
	const isMobile = detectMobile();
	const prefersReducedMotion = detectPrefersReducedMotion();
	const devicePixelRatio = browser ? window.devicePixelRatio || 1 : 1;

	// Screen capture capabilities
	const screenCapture = detectScreenCapture();
	const importExternalTexture = detectImportExternalTexture();
	const copyExternalImage = detectCopyExternalImage();
	const videoFrameCallback = detectVideoFrameCallback();
	const mediaStreamTrackProcessor = detectMediaStreamTrackProcessor();

	// Determine recommended mode - Futhark WebGPU or nothing
	let recommendedMode: CompositorMode = 'none';

	if (webgpu && wasm) {
		// Futhark WebGPU with WASM is the primary path
		// Note: wasmSimd is detected but not required (Futhark uses pthreads, not SIMD)
		recommendedMode = 'webgpu';
	}

	// Log capabilities in development
	if (browser && import.meta.env.DEV) {
		console.log('[featureDetection] Capabilities (sync):', {
			webgpu,
			webgl2,
			wasm,
			wasmSimd,
			sharedArrayBuffer,
			offscreenCanvas,
			gpuTier,
			isMobile,
			prefersReducedMotion,
			recommendedMode,
			screenCapture,
			importExternalTexture,
			copyExternalImage,
			videoFrameCallback,
			mediaStreamTrackProcessor
		});
	}

	return {
		webgpu,
		webgpuAdapter: null, // Use async version for adapter info
		webgl2,
		wasm,
		wasmSimd,
		sharedArrayBuffer,
		offscreenCanvas,
		devicePixelRatio,
		gpuTier,
		recommendedMode,
		isMobile,
		prefersReducedMotion,
		screenCapture,
		importExternalTexture,
		copyExternalImage,
		videoFrameCallback,
		mediaStreamTrackProcessor
	};
}

/**
 * Detect all capabilities with full WebGPU detection (ASYNC version)
 * This performs complete WebGPU adapter/device verification
 */
export async function detectCapabilitiesAsync(): Promise<FeatureCapabilities> {
	const webgpuResult = await detectWebGPU();
	const webgl2 = detectWebGL2();
	const wasm = detectWASM();
	const wasmSimd = detectWASMSimd();
	const sharedArrayBuffer = detectSharedArrayBuffer();
	const offscreenCanvas = detectOffscreenCanvas();
	const gpuTier = estimateGPUTier();
	const isMobile = detectMobile();
	const prefersReducedMotion = detectPrefersReducedMotion();
	const devicePixelRatio = browser ? window.devicePixelRatio || 1 : 1;

	// Screen capture capabilities
	const screenCapture = detectScreenCapture();
	const importExternalTexture = detectImportExternalTexture();
	const copyExternalImage = detectCopyExternalImage();
	const videoFrameCallback = detectVideoFrameCallback();
	const mediaStreamTrackProcessor = detectMediaStreamTrackProcessor();

	// Determine recommended mode - Futhark WebGPU or nothing
	let recommendedMode: CompositorMode = 'none';

	if (webgpuResult.available && wasm) {
		// Futhark WebGPU with WASM is the primary path
		// Note: wasmSimd is detected but not required (Futhark uses pthreads, not SIMD)
		recommendedMode = 'webgpu';
	}

	// Log capabilities in development
	if (browser && import.meta.env.DEV) {
		console.log('[featureDetection] Capabilities (async):', {
			webgpu: webgpuResult.available,
			webgpuAdapter: webgpuResult.adapter,
			webgl2,
			wasm,
			wasmSimd,
			sharedArrayBuffer,
			offscreenCanvas,
			gpuTier,
			isMobile,
			prefersReducedMotion,
			recommendedMode,
			screenCapture,
			importExternalTexture,
			copyExternalImage,
			videoFrameCallback,
			mediaStreamTrackProcessor
		});
	}

	return {
		webgpu: webgpuResult.available,
		webgpuAdapter: webgpuResult.adapter,
		webgl2,
		wasm,
		wasmSimd,
		sharedArrayBuffer,
		offscreenCanvas,
		devicePixelRatio,
		gpuTier,
		recommendedMode,
		isMobile,
		prefersReducedMotion,
		screenCapture,
		importExternalTexture,
		copyExternalImage,
		videoFrameCallback,
		mediaStreamTrackProcessor
	};
}

// ============================================================================
// Cached Detection
// ============================================================================

let cachedCapabilities: FeatureCapabilities | null = null;
let asyncCapabilitiesPromise: Promise<FeatureCapabilities> | null = null;

/**
 * Get capabilities (cached after first call) - SYNC version
 * For full WebGPU detection, use getCapabilitiesAsync()
 */
export function getCapabilities(): FeatureCapabilities {
	if (!cachedCapabilities) {
		cachedCapabilities = detectCapabilities();
	}
	return cachedCapabilities;
}

/**
 * Get capabilities with full WebGPU detection (cached after first call) - ASYNC version
 * This is the RECOMMENDED method as it performs complete WebGPU verification
 */
export async function getCapabilitiesAsync(): Promise<FeatureCapabilities> {
	if (cachedCapabilities && cachedCapabilities.webgpuAdapter !== null) {
		// Already have async result
		return cachedCapabilities;
	}

	if (!asyncCapabilitiesPromise) {
		asyncCapabilitiesPromise = detectCapabilitiesAsync().then((caps) => {
			cachedCapabilities = caps;
			return caps;
		});
	}

	return asyncCapabilitiesPromise;
}

/**
 * Clear cached capabilities (for testing)
 */
export function clearCapabilitiesCache(): void {
	cachedCapabilities = null;
	asyncCapabilitiesPromise = null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get requirements message for missing features
 */
export function getMissingFeaturesMessage(caps: FeatureCapabilities): string {
	const missing: string[] = [];

	if (!caps.webgpu) {
		missing.push('WebGPU (Chrome 113+, Edge 113+, Firefox 129+)');
	}
	if (!caps.wasm) {
		missing.push('WebAssembly');
	}
	if (!caps.wasmSimd) {
		missing.push('WASM SIMD (Chrome 91+, Firefox 89+, Safari 16.4+)');
	}
	if (!caps.sharedArrayBuffer) {
		missing.push('SharedArrayBuffer (requires COOP/COEP headers)');
	}

	if (missing.length === 0) {
		return 'All required features are available.';
	}

	return `Missing features: ${missing.join(', ')}`;
}

/**
 * Check if the COOP/COEP headers are properly configured
 * (required for SharedArrayBuffer)
 */
export function checkCrossOriginIsolation(): {
	isolated: boolean;
	headers: { coep: string | null; coop: string | null };
} {
	if (!browser) {
		return { isolated: false, headers: { coep: null, coop: null } };
	}

	return {
		isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
		headers: {
			coep: document.querySelector('meta[http-equiv="Cross-Origin-Embedder-Policy"]')?.getAttribute('content') || null,
			coop: document.querySelector('meta[http-equiv="Cross-Origin-Opener-Policy"]')?.getAttribute('content') || null
		}
	};
}

export default {
	// Main detection
	detectCapabilities,
	detectCapabilitiesAsync,
	getCapabilities,
	getCapabilitiesAsync,
	clearCapabilitiesCache,

	// Primary detectors (Futhark WebGPU)
	detectWebGPU,
	detectWebGPUSync,
	detectWASMSimd,
	detectWASM,

	// Secondary detectors
	detectSharedArrayBuffer,
	detectOffscreenCanvas,
	estimateGPUTier,
	detectMobile,
	detectPrefersReducedMotion,

	// Screen capture detectors
	detectScreenCapture,
	detectImportExternalTexture,
	detectCopyExternalImage,
	detectVideoFrameCallback,
	detectMediaStreamTrackProcessor,

	// Utility functions
	getMissingFeaturesMessage,
	checkCrossOriginIsolation,

	// @deprecated
	detectWebGL2
};
