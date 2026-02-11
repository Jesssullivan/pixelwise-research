/**
 * Text Manipulation Web Worker
 *
 * Handles Futhark WASM-based text contrast adjustment in a separate thread.
 * Uses Futhark's auto-parallelized WASM backend for ESDT and WCAG computations.
 *
 * Pipeline stages:
 * 1. Grayscale conversion + gradient computation
 * 2. ESDT X-pass (horizontal propagation)
 * 3. ESDT Y-pass (vertical propagation)
 * 4. Glyph extraction (distance thresholding)
 * 5. Background sampling (outward along gradient)
 * 6. WCAG contrast check + color adjustment
 *
 * @see futhark/esdt.fut for ESDT algorithm implementation
 * @see futhark/wcag.fut for WCAG contrast calculations
 * @see futhark/pipeline.fut for full pipeline
 */

import {
	MessageType,
	type WorkerMessage,
	type WorkerResponse,
	type BatchLuminancePayload,
	type BatchContrastPayload,
	type ComputeESDTPayload,
	type GetMemoryInfoResult
} from './text-manipulation.types';

// Futhark context interface (from esdt.class.js)
interface FutharkContext {
	new_f32_2d(data: Float32Array, rows: number, cols: number): FutharkArray;
	compute_esdt_2d(input: FutharkArray, useRelaxation: boolean): FutharkArray;
}

interface FutharkArray {
	toTypedArray(): Promise<Float32Array>;
	free(): void;
}

// Module state
let futharkContext: FutharkContext | null = null;
let isInitialized = false;

/**
 * Initialize Futhark WASM module
 */
async function initFuthark(): Promise<boolean> {
	try {
		// Dynamic import of the Futhark WASM module wrapper
		// Note: In worker context, we need to use the full path
		const module = await import('../futhark/index');

		if (typeof module.newFutharkContext === 'function') {
			futharkContext = await module.newFutharkContext();
			isInitialized = true;
			console.log('[Worker] Futhark WASM context initialized');
			return true;
		}

		throw new Error('Futhark module missing newFutharkContext');
	} catch (error: unknown) {
		console.error('[Worker] Failed to initialize Futhark WASM:', error);
		return false;
	}
}

/**
 * Handle ComputeESDT message
 *
 * Computes the Extended Signed Distance Transform using Futhark WASM.
 * This is the real algorithm with 2D separable passes.
 *
 * @see futhark/esdt.fut - compute_esdt_2d()
 */
async function handleComputeESDT(payload: ComputeESDTPayload): Promise<{
	esdtData: Float32Array;
	pixelCount: number;
	processingTimeMs: number;
}> {
	if (!futharkContext || !isInitialized) {
		throw new Error('Futhark not initialized');
	}

	const startTime = performance.now();
	const { levels, width, height, useRelaxation } = payload;

	// Create 2D input array for Futhark
	const input2d = futharkContext.new_f32_2d(levels, height, width);

	try {
		// Run ESDT computation
		const result = futharkContext.compute_esdt_2d(input2d, useRelaxation);
		const data = await result.toTypedArray();
		result.free();

		const elapsed = performance.now() - startTime;
		const pixelCount = width * height;

		console.log(`[Worker] compute_esdt_2d: ${pixelCount} pixels in ${elapsed.toFixed(2)}ms`);

		return {
			esdtData: data,
			pixelCount,
			processingTimeMs: elapsed
		};
	} finally {
		input2d.free();
	}
}

/**
 * Handle BatchLuminance message
 *
 * Computes relative luminance for batches of RGB pixels using WCAG 2.1 formula.
 * Uses pure TypeScript implementation (Futhark WCAG module is for full pipeline).
 */
function handleBatchLuminance(payload: BatchLuminancePayload): {
	luminances: Float32Array;
} {
	const { rgbData } = payload;
	const pixelCount = rgbData.length / 3;
	const luminances = new Float32Array(pixelCount);

	for (let i = 0; i < pixelCount; i++) {
		const r = rgbData[i * 3] / 255;
		const g = rgbData[i * 3 + 1] / 255;
		const b = rgbData[i * 3 + 2] / 255;

		// sRGB gamma correction per WCAG 2.1
		const linearR = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
		const linearG = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
		const linearB = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

		// Relative luminance
		luminances[i] = 0.2126 * linearR + 0.7152 * linearG + 0.0722 * linearB;
	}

	return { luminances };
}

/**
 * Handle BatchContrast message
 *
 * Computes contrast ratios for batches of text/background pixel pairs.
 * Uses pure TypeScript implementation with WCAG 2.1 formula.
 */
function handleBatchContrast(payload: BatchContrastPayload): {
	ratios: Float32Array;
} {
	const { textRgb, bgRgb } = payload;
	const pairCount = textRgb.length / 3;
	const ratios = new Float32Array(pairCount);

	for (let i = 0; i < pairCount; i++) {
		// Text color
		const tr = textRgb[i * 3] / 255;
		const tg = textRgb[i * 3 + 1] / 255;
		const tb = textRgb[i * 3 + 2] / 255;

		// Background color
		const br = bgRgb[i * 3] / 255;
		const bg = bgRgb[i * 3 + 1] / 255;
		const bb = bgRgb[i * 3 + 2] / 255;

		// Gamma correction
		const linearTR = tr <= 0.03928 ? tr / 12.92 : Math.pow((tr + 0.055) / 1.055, 2.4);
		const linearTG = tg <= 0.03928 ? tg / 12.92 : Math.pow((tg + 0.055) / 1.055, 2.4);
		const linearTB = tb <= 0.03928 ? tb / 12.92 : Math.pow((tb + 0.055) / 1.055, 2.4);

		const linearBR = br <= 0.03928 ? br / 12.92 : Math.pow((br + 0.055) / 1.055, 2.4);
		const linearBG = bg <= 0.03928 ? bg / 12.92 : Math.pow((bg + 0.055) / 1.055, 2.4);
		const linearBB = bb <= 0.03928 ? bb / 12.92 : Math.pow((bb + 0.055) / 1.055, 2.4);

		// Relative luminances
		const lumText = 0.2126 * linearTR + 0.7152 * linearTG + 0.0722 * linearTB;
		const lumBg = 0.2126 * linearBR + 0.7152 * linearBG + 0.0722 * linearBB;

		// Contrast ratio
		const lighter = Math.max(lumText, lumBg);
		const darker = Math.min(lumText, lumBg);
		ratios[i] = (lighter + 0.05) / (darker + 0.05);
	}

	return { ratios };
}

/**
 * Handle GetMemoryInfo message
 *
 * Returns Futhark WASM info for debugging and capacity checks.
 */
function handleGetMemoryInfo(): GetMemoryInfoResult {
	return {
		initialized: isInitialized,
		simdAvailable: false, // Futhark uses its own parallelization strategy
		memorySize: 0, // Futhark manages its own memory
		maxPixels: 0,
		maxRegions: 0,
		maxBgWidth: 0,
		maxBgHeight: 0
	};
}

/**
 * Send response back to main thread
 */
function respond(id: number, success: boolean, data?: unknown, error?: string): void {
	const response: WorkerResponse = { id, success, data, error };
	self.postMessage(response);
}

/**
 * Handle incoming messages
 */
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
	const { type, id, payload } = event.data;

	try {
		switch (type) {
			case MessageType.Init: {
				const success = await initFuthark();
				respond(id, success, { initialized: success }, success ? undefined : 'Futhark init failed');
				break;
			}

			case MessageType.Ping: {
				respond(id, true, { pong: true, simdEnabled: isInitialized });
				break;
			}

			case MessageType.BatchLuminance: {
				const result = handleBatchLuminance(payload as BatchLuminancePayload);
				respond(id, true, result);
				break;
			}

			case MessageType.BatchContrast: {
				const result = handleBatchContrast(payload as BatchContrastPayload);
				respond(id, true, result);
				break;
			}

			case MessageType.ComputeESDT: {
				const result = await handleComputeESDT(payload as ComputeESDTPayload);
				respond(id, true, result);
				break;
			}

			case MessageType.Dispose: {
				futharkContext = null;
				isInitialized = false;
				respond(id, true, { disposed: true });
				break;
			}

			case MessageType.GetMemoryInfo: {
				const result = handleGetMemoryInfo();
				respond(id, true, result);
				break;
			}

			// Legacy message types that were specific to Rust WASM - provide stub responses
			case MessageType.ProcessGlyphPixels:
			case MessageType.ProcessPixelsSIMD:
			case MessageType.KernelDensity:
			case MessageType.ExtractGlyphPixels:
			case MessageType.BindSharedBuffer:
			case MessageType.ProcessSharedBuffer: {
				respond(id, false, undefined, `Message type ${type} not implemented in Futhark worker. Use ComputeDispatcher for full pipeline.`);
				break;
			}

			default: {
				respond(id, false, undefined, `Unknown message type: ${type}`);
			}
		}
	} catch (error: unknown) {
		console.error('[Worker] Error handling message:', error);
		respond(id, false, undefined, error instanceof Error ? error.message : String(error));
	}
};

// Export for type safety
export {};
