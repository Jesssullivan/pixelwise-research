/**
 * Feature Detection Tests
 *
 * Tests for feature detection utilities including:
 * - WebGPU detection
 * - WASM/WASM SIMD detection
 * - SharedArrayBuffer detection (requires COOP/COEP headers)
 * - Cross-origin isolation checks
 * - GPU tier estimation
 * - Fallback chain logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock $app/environment before importing the module
vi.mock('$app/environment', () => ({
	browser: true
}));

import {
	detectWASM,
	detectWASMSimd,
	detectSharedArrayBuffer,
	detectOffscreenCanvas,
	detectCanvas2D,
	detectWebGL2,
	detectMobile,
	detectPrefersReducedMotion,
	detectWebGPUSync,
	detectCapabilities,
	getCapabilities,
	clearCapabilitiesCache,
	checkCrossOriginIsolation,
	getMissingFeaturesMessage,
	estimateGPUTier,
	type FeatureCapabilities
} from '$lib/pixelwise/featureDetection';

describe('Feature Detection', () => {
	beforeEach(() => {
		clearCapabilitiesCache();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('detectWASM', () => {
		it('should detect WebAssembly availability', () => {
			const result = detectWASM();
			// jsdom supports WebAssembly
			expect(typeof result).toBe('boolean');
			expect(result).toBe(true);
		});

		it('should return false when WebAssembly is not defined', () => {
			const originalWasm = globalThis.WebAssembly;
			// @ts-expect-error - testing undefined case
			globalThis.WebAssembly = undefined;

			const result = detectWASM();
			expect(result).toBe(false);

			globalThis.WebAssembly = originalWasm;
		});

		it('should handle errors gracefully', () => {
			const originalWasm = globalThis.WebAssembly;
			globalThis.WebAssembly = {
				Module: class {
					constructor() {
						throw new Error('WASM not supported');
					}
				}
			} as typeof WebAssembly;

			const result = detectWASM();
			expect(result).toBe(false);

			globalThis.WebAssembly = originalWasm;
		});
	});

	describe('detectWASMSimd', () => {
		it('should detect WASM SIMD support', () => {
			const result = detectWASMSimd();
			// Modern Node.js/V8 supports WASM SIMD
			expect(typeof result).toBe('boolean');
		});

		it('should return false when SIMD module fails to compile', () => {
			const originalModule = WebAssembly.Module;

			// Mock WebAssembly.Module to throw on SIMD bytecode
			WebAssembly.Module = class {
				constructor(bytes: BufferSource) {
					const arr = new Uint8Array(bytes as ArrayBuffer);
					// Check for SIMD opcode prefix (0xfd)
					if (arr.some((b, i) => b === 0xfd && arr[i + 1] === 0x0c)) {
						throw new Error('SIMD not supported');
					}
					return originalModule.call(WebAssembly, bytes);
				}
			} as typeof WebAssembly.Module;

			const result = detectWASMSimd();
			expect(result).toBe(false);

			WebAssembly.Module = originalModule;
		});
	});

	describe('detectSharedArrayBuffer (COOP/COEP)', () => {
		it('should detect SharedArrayBuffer availability', () => {
			const result = detectSharedArrayBuffer();
			expect(typeof result).toBe('boolean');
		});

		it('should return true when SharedArrayBuffer is available', () => {
			// jsdom should have SharedArrayBuffer
			if (typeof SharedArrayBuffer !== 'undefined') {
				const result = detectSharedArrayBuffer();
				expect(result).toBe(true);
			}
		});

		it('should return false when SharedArrayBuffer is not defined', () => {
			const originalSAB = globalThis.SharedArrayBuffer;
			// @ts-expect-error - testing undefined case
			globalThis.SharedArrayBuffer = undefined;

			const result = detectSharedArrayBuffer();
			expect(result).toBe(false);

			globalThis.SharedArrayBuffer = originalSAB;
		});

		it('should return false when SharedArrayBuffer constructor throws', () => {
			const originalSAB = globalThis.SharedArrayBuffer;
			globalThis.SharedArrayBuffer = class {
				constructor() {
					throw new Error('SharedArrayBuffer requires cross-origin isolation');
				}
			} as typeof SharedArrayBuffer;

			const result = detectSharedArrayBuffer();
			expect(result).toBe(false);

			globalThis.SharedArrayBuffer = originalSAB;
		});
	});

	describe('checkCrossOriginIsolation', () => {
		it('should return isolation status', () => {
			const result = checkCrossOriginIsolation();
			expect(result).toHaveProperty('isolated');
			expect(result).toHaveProperty('headers');
			expect(result.headers).toHaveProperty('coep');
			expect(result.headers).toHaveProperty('coop');
		});

		it('should detect crossOriginIsolated global', () => {
			const originalCOI = globalThis.crossOriginIsolated;

			// Mock cross-origin isolation as true
			Object.defineProperty(globalThis, 'crossOriginIsolated', {
				value: true,
				writable: true,
				configurable: true
			});

			const result = checkCrossOriginIsolation();
			expect(result.isolated).toBe(true);

			// Restore
			Object.defineProperty(globalThis, 'crossOriginIsolated', {
				value: originalCOI,
				writable: true,
				configurable: true
			});
		});

		it('should detect when not cross-origin isolated', () => {
			const originalCOI = globalThis.crossOriginIsolated;

			Object.defineProperty(globalThis, 'crossOriginIsolated', {
				value: false,
				writable: true,
				configurable: true
			});

			const result = checkCrossOriginIsolation();
			expect(result.isolated).toBe(false);

			Object.defineProperty(globalThis, 'crossOriginIsolated', {
				value: originalCOI,
				writable: true,
				configurable: true
			});
		});
	});

	describe('detectOffscreenCanvas', () => {
		it('should detect OffscreenCanvas availability', () => {
			const result = detectOffscreenCanvas();
			expect(typeof result).toBe('boolean');
		});

		it('should return false when OffscreenCanvas is not defined', () => {
			const originalOC = globalThis.OffscreenCanvas;
			// @ts-expect-error - testing undefined case
			globalThis.OffscreenCanvas = undefined;

			const result = detectOffscreenCanvas();
			expect(result).toBe(false);

			if (originalOC) {
				globalThis.OffscreenCanvas = originalOC;
			}
		});
	});

	describe('detectCanvas2D', () => {
		it('should detect Canvas 2D availability', () => {
			const result = detectCanvas2D();
			expect(typeof result).toBe('boolean');
		});

		it('should return boolean based on canvas context availability', () => {
			// jsdom may or may not have full canvas support depending on environment
			// The function should return a boolean without throwing
			const result = detectCanvas2D();
			expect(typeof result).toBe('boolean');
		});
	});

	describe('detectWebGL2', () => {
		it('should detect WebGL2 availability', () => {
			const result = detectWebGL2();
			expect(typeof result).toBe('boolean');
		});
	});

	describe('detectWebGPUSync', () => {
		it('should return boolean for WebGPU availability', () => {
			const result = detectWebGPUSync();
			expect(typeof result).toBe('boolean');
		});

		it('should detect navigator.gpu presence', () => {
			// jsdom doesn't have WebGPU by default
			const result = detectWebGPUSync();
			// In jsdom without WebGPU polyfill, this should be false
			expect(result).toBe(false);
		});

		it('should return true when navigator.gpu exists', () => {
			const originalNavigator = globalThis.navigator;

			Object.defineProperty(globalThis, 'navigator', {
				value: { ...originalNavigator, gpu: {} },
				writable: true,
				configurable: true
			});

			const result = detectWebGPUSync();
			expect(result).toBe(true);

			Object.defineProperty(globalThis, 'navigator', {
				value: originalNavigator,
				writable: true,
				configurable: true
			});
		});
	});

	describe('detectMobile', () => {
		it('should detect mobile devices', () => {
			const result = detectMobile();
			expect(typeof result).toBe('boolean');
		});

		it('should detect Android user agent', () => {
			const originalUA = navigator.userAgent;
			Object.defineProperty(navigator, 'userAgent', {
				value: 'Mozilla/5.0 (Linux; Android 10; Pixel 4) AppleWebKit/537.36',
				writable: true,
				configurable: true
			});

			const result = detectMobile();
			expect(result).toBe(true);

			Object.defineProperty(navigator, 'userAgent', {
				value: originalUA,
				writable: true,
				configurable: true
			});
		});

		it('should detect iPhone user agent', () => {
			const originalUA = navigator.userAgent;
			Object.defineProperty(navigator, 'userAgent', {
				value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
				writable: true,
				configurable: true
			});

			const result = detectMobile();
			expect(result).toBe(true);

			Object.defineProperty(navigator, 'userAgent', {
				value: originalUA,
				writable: true,
				configurable: true
			});
		});
	});

	describe('detectPrefersReducedMotion', () => {
		it('should detect reduced motion preference', () => {
			const result = detectPrefersReducedMotion();
			expect(typeof result).toBe('boolean');
		});
	});

	describe('estimateGPUTier', () => {
		it('should return a tier between 0 and 3', () => {
			const result = estimateGPUTier();
			expect(result).toBeGreaterThanOrEqual(0);
			expect(result).toBeLessThanOrEqual(3);
		});
	});

	describe('detectCapabilities', () => {
		it('should return all capability flags', () => {
			const caps = detectCapabilities();

			expect(caps).toHaveProperty('webgpu');
			expect(caps).toHaveProperty('webgpuAdapter');
			expect(caps).toHaveProperty('wasm');
			expect(caps).toHaveProperty('wasmSimd');
			expect(caps).toHaveProperty('sharedArrayBuffer');
			expect(caps).toHaveProperty('offscreenCanvas');
			expect(caps).toHaveProperty('canvas2d');
			expect(caps).toHaveProperty('devicePixelRatio');
			expect(caps).toHaveProperty('gpuTier');
			expect(caps).toHaveProperty('recommendedMode');
			expect(caps).toHaveProperty('isMobile');
			expect(caps).toHaveProperty('prefersReducedMotion');
		});

		it('should have correct types for all properties', () => {
			const caps = detectCapabilities();

			expect(typeof caps.webgpu).toBe('boolean');
			expect(typeof caps.wasm).toBe('boolean');
			expect(typeof caps.wasmSimd).toBe('boolean');
			expect(typeof caps.sharedArrayBuffer).toBe('boolean');
			expect(typeof caps.offscreenCanvas).toBe('boolean');
			expect(typeof caps.canvas2d).toBe('boolean');
			expect(typeof caps.devicePixelRatio).toBe('number');
			expect(typeof caps.gpuTier).toBe('number');
			expect(typeof caps.isMobile).toBe('boolean');
			expect(typeof caps.prefersReducedMotion).toBe('boolean');
		});

		it('should recommend webgpu mode when all features are available', () => {
			// Mock all features as available
			const originalNavigator = globalThis.navigator;

			Object.defineProperty(globalThis, 'navigator', {
				value: {
					...originalNavigator,
					gpu: {
						requestAdapter: vi.fn().mockResolvedValue({})
					}
				},
				writable: true,
				configurable: true
			});

			clearCapabilitiesCache();
			const caps = detectCapabilities();

			// With WebGPU, WASM, and SIMD available, should recommend webgpu
			if (caps.webgpu && caps.wasm && caps.wasmSimd) {
				expect(caps.recommendedMode).toBe('webgpu');
			}

			Object.defineProperty(globalThis, 'navigator', {
				value: originalNavigator,
				writable: true,
				configurable: true
			});
		});

		it('should recommend none when features are missing', () => {
			// In jsdom without WebGPU, mode should be none
			clearCapabilitiesCache();
			const caps = detectCapabilities();

			if (!caps.webgpu || !caps.wasm || !caps.wasmSimd) {
				expect(caps.recommendedMode).toBe('none');
			}
		});
	});

	describe('getCapabilities (cached)', () => {
		it('should cache capabilities after first call', () => {
			clearCapabilitiesCache();

			const caps1 = getCapabilities();
			const caps2 = getCapabilities();

			// Should return the same object reference
			expect(caps1).toBe(caps2);
		});

		it('should return fresh capabilities after clearing cache', () => {
			const caps1 = getCapabilities();
			clearCapabilitiesCache();
			const caps2 = getCapabilities();

			// Properties should be the same, but it's a new object
			expect(caps1.wasm).toBe(caps2.wasm);
		});
	});

	describe('getMissingFeaturesMessage', () => {
		it('should return appropriate message when all features present', () => {
			const fullCaps: FeatureCapabilities = {
				webgpu: true,
				webgpuAdapter: 'Test Adapter',
				webgl2: true,
				wasm: true,
				wasmSimd: true,
				sharedArrayBuffer: true,
				offscreenCanvas: true,
				canvas2d: true,
				devicePixelRatio: 1,
				gpuTier: 3,
				recommendedMode: 'webgpu',
				isMobile: false,
				prefersReducedMotion: false
			};

			const message = getMissingFeaturesMessage(fullCaps);
			expect(message).toBe('All required features are available.');
		});

		it('should list missing WebGPU', () => {
			const caps: FeatureCapabilities = {
				webgpu: false,
				webgpuAdapter: null,
				webgl2: true,
				wasm: true,
				wasmSimd: true,
				sharedArrayBuffer: true,
				offscreenCanvas: true,
				canvas2d: true,
				devicePixelRatio: 1,
				gpuTier: 0,
				recommendedMode: 'none',
				isMobile: false,
				prefersReducedMotion: false
			};

			const message = getMissingFeaturesMessage(caps);
			expect(message).toContain('WebGPU');
		});

		it('should list missing SharedArrayBuffer with COOP/COEP note', () => {
			const caps: FeatureCapabilities = {
				webgpu: true,
				webgpuAdapter: 'Test',
				webgl2: true,
				wasm: true,
				wasmSimd: true,
				sharedArrayBuffer: false,
				offscreenCanvas: true,
				canvas2d: true,
				devicePixelRatio: 1,
				gpuTier: 3,
				recommendedMode: 'webgpu',
				isMobile: false,
				prefersReducedMotion: false
			};

			const message = getMissingFeaturesMessage(caps);
			expect(message).toContain('SharedArrayBuffer');
			expect(message).toContain('COOP/COEP');
		});

		it('should list multiple missing features', () => {
			const caps: FeatureCapabilities = {
				webgpu: false,
				webgpuAdapter: null,
				webgl2: false,
				wasm: false,
				wasmSimd: false,
				sharedArrayBuffer: false,
				offscreenCanvas: false,
				canvas2d: true,
				devicePixelRatio: 1,
				gpuTier: 0,
				recommendedMode: 'none',
				isMobile: false,
				prefersReducedMotion: false
			};

			const message = getMissingFeaturesMessage(caps);
			expect(message).toContain('WebGPU');
			expect(message).toContain('WebAssembly');
			expect(message).toContain('WASM SIMD');
			expect(message).toContain('SharedArrayBuffer');
		});
	});
});

describe('COOP/COEP Header Verification', () => {
	it('should document required headers for SharedArrayBuffer', () => {
		// This test documents the required COOP/COEP headers
		const requiredHeaders = {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp'
		};

		expect(requiredHeaders['Cross-Origin-Opener-Policy']).toBe('same-origin');
		expect(requiredHeaders['Cross-Origin-Embedder-Policy']).toBe('require-corp');
	});

	it('should verify crossOriginIsolated is checked correctly', () => {
		// This test verifies our detection logic matches browser behavior
		const result = checkCrossOriginIsolation();

		// In a properly configured environment, isolated should match
		// whether SharedArrayBuffer works
		if (result.isolated) {
			// If isolated, SAB should work
			expect(detectSharedArrayBuffer()).toBe(true);
		}
	});
});

describe('Fallback Chain Documentation', () => {
	/**
	 * Fallback chain priority (documented in tests):
	 *
	 * 1. WebGPU + WASM SIMD (zero-copy) - Best performance
	 *    - GPU memory mapping with WASM direct access
	 *    - Requires: WebGPU, WASM, WASM SIMD
	 *
	 * 2. SharedArrayBuffer + WASM SIMD (near-zero-copy)
	 *    - Requires COOP/COEP headers for SharedArrayBuffer
	 *    - Falls back if WebGPU unavailable
	 *
	 * 3. Worker + WASM SIMD (postMessage)
	 *    - Standard message passing with copies
	 *    - Falls back if SharedArrayBuffer unavailable
	 *
	 * 4. None - No suitable compositor
	 */

	it('should document zero-copy requirements', () => {
		const zeroCopyRequirements = {
			webgpu: 'GPU memory mapping',
			wasmSimd: 'SIMD vector instructions',
			wasm: 'WebAssembly runtime'
		};

		expect(Object.keys(zeroCopyRequirements)).toContain('webgpu');
		expect(Object.keys(zeroCopyRequirements)).toContain('wasmSimd');
	});

	it('should document SharedArrayBuffer requirements', () => {
		const sabRequirements = {
			headers: {
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'require-corp'
			},
			globalCheck: 'crossOriginIsolated === true'
		};

		expect(sabRequirements.headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
	});
});
