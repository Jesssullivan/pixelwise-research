/**
 * WASM Shader Integration E2E Tests
 *
 * Verifies WASM module loads and functions correctly in real browser environment:
 * - Module loading and initialization
 * - Worker communication and WASM setup
 * - WCAG contrast ratio calculations
 * - Pixel adjustment operations
 * - Memory safety and cleanup
 *
 * These tests run in actual browser context via Playwright, unlike unit tests
 * which are skipped in Node.js environment.
 *
 * NOTE: These tests check WASM functionality independent of whether the pixelwise
 * canvas is rendered on the page. The WASM module can be tested directly.
 */

import { test, expect } from '@playwright/test';
import { BASE_URL, captureConsoleErrors } from './helpers';

test.describe('WASM Shader Integration', () => {
	test.beforeEach(async ({ page }) => {
		// Navigate to home page which loads WASM infrastructure
		await page.goto(BASE_URL);
		await page.waitForLoadState('networkidle');
	});

	test('should load WASM module without errors', async ({ page }) => {
		const errorCapture = await captureConsoleErrors(page);

		// Wait for any WASM initialization to complete
		await page.waitForTimeout(1000);

		const errors = errorCapture.getErrors();
		const wasmErrors = errors.filter(
			(err) =>
				err.toLowerCase().includes('wasm') ||
				err.toLowerCase().includes('text_processor') ||
				err.toLowerCase().includes('worker')
		);

		expect(wasmErrors).toHaveLength(0);
	});

	test('should verify WASM module is available', async ({ page }) => {
		const wasmModuleExists = await page.evaluate(async () => {
			try {
				// Dynamic import - same path as worker uses
				const module = await import('/static/wasm/text_processor.js');
				return {
					loaded: true,
					hasInit: typeof module.default === 'function',
					hasContrastRatio: typeof module.contrast_ratio === 'function',
					hasRelativeLuminance: typeof module.relative_luminance === 'function',
					hasAdjustPixels: typeof module.adjust_pixels_per_pixel === 'function'
				};
			} catch (error) {
				return {
					loaded: false,
					error: error instanceof Error ? error.message : String(error)
				};
			}
		});

		expect(wasmModuleExists.loaded).toBe(true);
		expect(wasmModuleExists.hasInit).toBe(true);
		expect(wasmModuleExists.hasContrastRatio).toBe(true);
		expect(wasmModuleExists.hasRelativeLuminance).toBe(true);
		expect(wasmModuleExists.hasAdjustPixels).toBe(true);
	});

	test('should initialize WASM module', async ({ page }) => {
		const initResult = await page.evaluate(async () => {
			try {
				const module = await import('/static/wasm/text_processor.js');

				// Initialize WASM - wasm-bindgen's default() is the init function
				await module.default('/static/wasm/text_processor_bg.wasm');

				return {
					success: true,
					canCallFunctions: typeof module.contrast_ratio === 'function'
				};
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error)
				};
			}
		});

		expect(initResult.success).toBe(true);
		expect(initResult.canCallFunctions).toBe(true);
	});

	test('should create and communicate with worker', async ({ page }) => {
		const workerResult = await page.evaluate(async () => {
			return new Promise((resolve, reject) => {
				try {
					// Create worker - Vite will bundle the TypeScript worker
					const worker = new Worker(
						'/src/workers/text-manipulation.worker.ts',
						{ type: 'module' }
					);

					// Set timeout for worker response
					const timeout = setTimeout(() => {
						worker.terminate();
						reject(new Error('Worker timeout'));
					}, 5000);

					worker.onmessage = (event) => {
						clearTimeout(timeout);
						worker.terminate();
						resolve({
							success: event.data.success,
							pong: event.data.data?.pong,
							wasmInitialized: event.data.data?.wasmInitialized
						});
					};

					worker.onerror = (error) => {
						clearTimeout(timeout);
						worker.terminate();
						reject(error);
					};

					// Send ping message
					worker.postMessage({
						type: 'ping',
						id: 'test-ping',
						payload: {}
					});
				} catch (error) {
					reject(error);
				}
			});
		});

		expect(workerResult.success).toBe(true);
		expect(workerResult.pong).toBe(true);
	});

	test('should initialize WASM in worker', async ({ page }) => {
		const initResult = await page.evaluate(async () => {
			return new Promise((resolve, reject) => {
				const worker = new Worker(
					'/src/workers/text-manipulation.worker.ts',
					{ type: 'module' }
				);

				const timeout = setTimeout(() => {
					worker.terminate();
					reject(new Error('Worker initialization timeout'));
				}, 10000);

				worker.onmessage = (event) => {
					if (event.data.id === 'test-init') {
						clearTimeout(timeout);
						worker.terminate();
						resolve({
							success: event.data.success,
							initialized: event.data.data?.initialized,
							error: event.data.error
						});
					}
				};

				worker.onerror = (error) => {
					clearTimeout(timeout);
					worker.terminate();
					reject(error);
				};

				// Send init message
				worker.postMessage({
					type: 'init',
					id: 'test-init',
					payload: {
						wasmUrl: '/static/wasm/text_processor_bg.wasm'
					}
				});
			});
		});

		expect(initResult.success).toBe(true);
		expect(initResult.initialized).toBe(true);
		if (!initResult.success) {
			console.error('Init error:', initResult.error);
		}
	});

	test('should calculate relative luminance correctly', async ({ page }) => {
		const luminanceResult = await page.evaluate(async () => {
			const module = await import('/static/wasm/text_processor.js');
			await module.default('/static/wasm/text_processor_bg.wasm');

			// Test black, white, and mid-gray
			return {
				black: module.relative_luminance(0, 0, 0),
				white: module.relative_luminance(255, 255, 255),
				gray: module.relative_luminance(128, 128, 128),
				red: module.relative_luminance(255, 0, 0)
			};
		});

		// Black should be ~0
		expect(luminanceResult.black).toBeCloseTo(0, 4);

		// White should be ~1.0
		expect(luminanceResult.white).toBeCloseTo(1.0, 4);

		// Gray should be between black and white
		expect(luminanceResult.gray).toBeGreaterThan(luminanceResult.black);
		expect(luminanceResult.gray).toBeLessThan(luminanceResult.white);

		// Red should have some luminance but less than white
		expect(luminanceResult.red).toBeGreaterThan(0);
		expect(luminanceResult.red).toBeLessThan(luminanceResult.white);
	});

	test('should calculate contrast ratio for black on white', async ({ page }) => {
		const contrastResult = await page.evaluate(async () => {
			const module = await import('/static/wasm/text_processor.js');
			await module.default('/static/wasm/text_processor_bg.wasm');

			const blackLum = module.relative_luminance(0, 0, 0);
			const whiteLum = module.relative_luminance(255, 255, 255);
			const contrast = module.contrast_ratio(blackLum, whiteLum);

			return {
				blackLum,
				whiteLum,
				contrast
			};
		});

		// Black on white should be approximately 21:1
		expect(contrastResult.contrast).toBeCloseTo(21, 0);
		expect(contrastResult.contrast).toBeGreaterThanOrEqual(20);
		expect(contrastResult.contrast).toBeLessThanOrEqual(22);
	});

	test('should validate WCAG AA compliance', async ({ page }) => {
		const wcagResult = await page.evaluate(async () => {
			const module = await import('/static/wasm/text_processor.js');
			await module.default('/static/wasm/text_processor_bg.wasm');

			return {
				// Normal text requires 4.5:1
				normalPass: module.is_aa_compliant(4.5, false),
				normalFail: module.is_aa_compliant(4.4, false),
				// Large text requires 3:1
				largePass: module.is_aa_compliant(3.0, true),
				largeFail: module.is_aa_compliant(2.9, true)
			};
		});

		expect(wcagResult.normalPass).toBe(true);
		expect(wcagResult.normalFail).toBe(false);
		expect(wcagResult.largePass).toBe(true);
		expect(wcagResult.largeFail).toBe(false);
	});

	test('should validate WCAG AAA compliance', async ({ page }) => {
		const wcagResult = await page.evaluate(async () => {
			const module = await import('/static/wasm/text_processor.js');
			await module.default('/static/wasm/text_processor_bg.wasm');

			return {
				// Normal text requires 7:1
				normalPass: module.is_aaa_compliant(7.0, false),
				normalFail: module.is_aaa_compliant(6.9, false),
				// Large text requires 4.5:1
				largePass: module.is_aaa_compliant(4.5, true),
				largeFail: module.is_aaa_compliant(4.4, true)
			};
		});

		expect(wcagResult.normalPass).toBe(true);
		expect(wcagResult.normalFail).toBe(false);
		expect(wcagResult.largePass).toBe(true);
		expect(wcagResult.largeFail).toBe(false);
	});

	test('should adjust pixels to meet contrast target', async ({ page }) => {
		const adjustResult = await page.evaluate(async () => {
			const module = await import('/static/wasm/text_processor.js');
			await module.default('/static/wasm/text_processor_bg.wasm');

			// Create test pixel data: 2x2 pixels
			// Text: dark gray (85, 85, 85) - insufficient contrast on white
			// Background: white (255, 255, 255)
			const width = 2;
			const height = 2;
			const pixelCount = width * height;

			const textPixels = new Uint8Array(pixelCount * 4);
			const bgPixels = new Uint8Array(pixelCount * 4);

			// Fill with test data (RGBA format)
			for (let i = 0; i < pixelCount * 4; i += 4) {
				// Text: dark gray
				textPixels[i] = 85;     // R
				textPixels[i + 1] = 85; // G
				textPixels[i + 2] = 85; // B
				textPixels[i + 3] = 255; // A

				// Background: white
				bgPixels[i] = 255;     // R
				bgPixels[i + 1] = 255; // G
				bgPixels[i + 2] = 255; // B
				bgPixels[i + 3] = 255; // A
			}

			// Calculate original contrast
			const originalTextLum = module.relative_luminance(85, 85, 85);
			const bgLum = module.relative_luminance(255, 255, 255);
			const originalContrast = module.contrast_ratio(originalTextLum, bgLum);

			// Adjust pixels to meet 4.5:1 contrast (WCAG AA)
			const adjusted = module.adjust_pixels_per_pixel(
				textPixels,
				bgPixels,
				width,
				height,
				4.5, // target contrast
				false // not large text
			);

			// Calculate new contrast
			const newTextLum = module.relative_luminance(
				adjusted[0],
				adjusted[1],
				adjusted[2]
			);
			const newContrast = module.contrast_ratio(newTextLum, bgLum);

			return {
				originalContrast,
				newContrast,
				originalColor: { r: 85, g: 85, b: 85 },
				adjustedColor: {
					r: adjusted[0],
					g: adjusted[1],
					b: adjusted[2]
				},
				adjustedLength: adjusted.length,
				expectedLength: pixelCount * 4
			};
		});

		// Original contrast should be insufficient
		expect(adjustResult.originalContrast).toBeLessThan(4.5);

		// New contrast should meet target
		expect(adjustResult.newContrast).toBeGreaterThanOrEqual(4.5);

		// Output should have correct length
		expect(adjustResult.adjustedLength).toBe(adjustResult.expectedLength);

		// Adjusted color should be different (darker to increase contrast)
		expect(adjustResult.adjustedColor.r).toBeLessThan(adjustResult.originalColor.r);
	});

	test('should handle worker color adjustment via message', async ({ page }) => {
		const workerAdjustResult = await page.evaluate(async () => {
			return new Promise((resolve, reject) => {
				const worker = new Worker(
					'/src/workers/text-manipulation.worker.ts',
					{ type: 'module' }
				);

				const timeout = setTimeout(() => {
					worker.terminate();
					reject(new Error('Worker adjustment timeout'));
				}, 10000);

				let initialized = false;

				worker.onmessage = (event) => {
					if (event.data.id === 'test-init' && event.data.success) {
						initialized = true;

						// Create test data
						const width = 2;
						const height = 2;
						const pixelCount = width * height;

						const textPixels = new Uint8Array(pixelCount * 4);
						const bgPixels = new Uint8Array(pixelCount * 4);

						for (let i = 0; i < pixelCount * 4; i += 4) {
							textPixels[i] = 85;
							textPixels[i + 1] = 85;
							textPixels[i + 2] = 85;
							textPixels[i + 3] = 255;

							bgPixels[i] = 255;
							bgPixels[i + 1] = 255;
							bgPixels[i + 2] = 255;
							bgPixels[i + 3] = 255;
						}

						// Send adjustment request
						worker.postMessage({
							type: 'adjust_colors',
							id: 'test-adjust',
							payload: {
								textPixels,
								backgroundPixels: bgPixels,
								width,
								height,
								targetContrast: 4.5,
								isLargeText: false
							}
						});
					} else if (event.data.id === 'test-adjust') {
						clearTimeout(timeout);
						worker.terminate();

						resolve({
							success: event.data.success,
							hasAdjustedPixels: !!event.data.data?.adjustedPixels,
							adjustedLength: event.data.data?.adjustedPixels?.length,
							processingTime: event.data.metrics?.processingTime,
							error: event.data.error
						});
					}
				};

				worker.onerror = (error) => {
					clearTimeout(timeout);
					worker.terminate();
					reject(error);
				};

				// Initialize worker first
				worker.postMessage({
					type: 'init',
					id: 'test-init',
					payload: {
						wasmUrl: '/static/wasm/text_processor_bg.wasm'
					}
				});
			});
		});

		expect(workerAdjustResult.success).toBe(true);
		expect(workerAdjustResult.hasAdjustedPixels).toBe(true);
		expect(workerAdjustResult.adjustedLength).toBe(16); // 2x2 pixels * 4 channels
		if (!workerAdjustResult.success) {
			console.error('Worker adjustment error:', workerAdjustResult.error);
		}
	});

	test('should detect SIMD support if available', async ({ page }) => {
		const simdResult = await page.evaluate(async () => {
			const module = await import('/static/wasm/text_processor.js');
			await module.default('/static/wasm/text_processor_bg.wasm');

			return {
				hasSimdFunction: typeof module.adjust_pixels_per_pixel_simd === 'function',
				hasBatchLuminance: typeof module.batch_luminance_simd === 'function',
				hasBatchContrast: typeof module.batch_contrast_simd === 'function'
			};
		});

		// SIMD support is optional and depends on build configuration
		// Just verify the check doesn't throw
		expect(typeof simdResult.hasSimdFunction).toBe('boolean');
		expect(typeof simdResult.hasBatchLuminance).toBe('boolean');
		expect(typeof simdResult.hasBatchContrast).toBe('boolean');
	});

	test('should not leak memory during WASM operations', async ({ page }) => {
		const memoryResult = await page.evaluate(async () => {
			const module = await import('/static/wasm/text_processor.js');
			await module.default('/static/wasm/text_processor_bg.wasm');

			const getMemory = () => {
				const memory = (performance as any).memory;
				return memory?.usedJSHeapSize || 0;
			};

			const initialMemory = getMemory();

			// Perform multiple WASM operations
			const iterations = 100;
			const width = 10;
			const height = 10;
			const pixelCount = width * height;

			for (let i = 0; i < iterations; i++) {
				const textPixels = new Uint8Array(pixelCount * 4);
				const bgPixels = new Uint8Array(pixelCount * 4);

				textPixels.fill(85);
				bgPixels.fill(255);

				const adjusted = module.adjust_pixels_per_pixel(
					textPixels,
					bgPixels,
					width,
					height,
					4.5,
					false
				);

				// Use the result to prevent optimization
				if (adjusted[0] === 999) {
					console.log('Unlikely');
				}
			}

			// Force garbage collection if available
			if ((globalThis as any).gc) {
				(globalThis as any).gc();
			}

			const finalMemory = getMemory();
			const memoryIncrease = finalMemory - initialMemory;

			return {
				initialMemory,
				finalMemory,
				memoryIncrease,
				iterations
			};
		});

		// Memory increase should be reasonable (less than 5MB for 100 iterations)
		if (memoryResult.initialMemory > 0 && memoryResult.finalMemory > 0) {
			expect(memoryResult.memoryIncrease).toBeLessThan(5 * 1024 * 1024);
		}
	});
});
