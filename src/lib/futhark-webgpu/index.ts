/**
 * Futhark WebGPU Module Wrapper
 *
 * Provides TypeScript bindings for the Futhark-generated WebGPU compute pipeline.
 * This module wraps the output of `futhark webgpu --library pipeline.fut`.
 *
 * The Futhark WebGPU backend (PR #2140) generates:
 * - pipeline-webgpu.js: Emscripten runtime + WASM loader (IIFE that assigns to global Module)
 * - pipeline-webgpu.wasm: Host code for buffer management and GPU dispatch
 * - pipeline-webgpu.wrapper.js: FutharkModule class with entry points and array types
 *
 * Build instructions:
 *   1. Install Futhark WebGPU: just futhark-webgpu-build
 *   2. Compile pipeline: just futhark-webgpu-compile
 */

/**
 * Opaque handle to a Futhark array living in WASM/GPU memory.
 * Call .values() to read data back, .free() to release.
 */
export interface FutharkArray {
	values(): Promise<Uint8Array | Float32Array>;
	free(): void;
}

/**
 * Initialized Futhark WebGPU context with typed entry points.
 */
export interface FutharkWebGPUContext {
	/**
	 * Run the full ESDT contrast enhancement pipeline on GPU.
	 *
	 * @param imageFlat - Flattened RGBA pixel data (width * height * 4 bytes)
	 * @param width - Image width in pixels
	 * @param height - Image height in pixels
	 * @param targetContrast - Target WCAG contrast ratio (e.g., 7.0 for AAA)
	 * @param maxDistance - Maximum ESDT search distance in pixels
	 * @param sampleDistance - Background sampling distance in pixels
	 * @returns Adjusted RGBA pixel data as Uint8Array
	 */
	enhanceContrastRgba(
		imageFlat: Uint8Array,
		width: number,
		height: number,
		targetContrast: number,
		maxDistance: number,
		sampleDistance: number
	): Promise<Uint8Array>;

	/**
	 * Compute ESDT from flat RGBA data (debug/visualization entry point).
	 *
	 * Returns per-pixel offset vectors [delta_x, delta_y, ...] as a flat
	 * Float32Array of length width * height * 2.
	 *
	 * @param imageFlat - Flattened RGBA pixel data (width * height * 4 bytes)
	 * @param width - Image width in pixels
	 * @param height - Image height in pixels
	 * @param maxDistance - Maximum ESDT search distance in pixels
	 * @returns Flat Float32Array of [delta_x, delta_y, ...] per pixel
	 */
	debugEsdtFlat(
		imageFlat: Uint8Array,
		width: number,
		height: number,
		maxDistance: number
	): Promise<Float32Array>;

	/** Synchronize all pending GPU operations */
	sync(): Promise<void>;

	/** Release all GPU/WASM resources */
	free(): void;
}

// Internal types for the Futhark module
interface FutharkModuleInternal {
	init(emscriptenModule: unknown): Promise<void>;
	entry: Record<string, (...args: unknown[]) => Promise<[FutharkArray]>>;
	u8_1d: {
		from_data(data: Uint8Array, length: number): FutharkArray;
	};
	f32_1d: {
		from_data(data: Float32Array, length: number): FutharkArray;
	};
	context_sync(): Promise<void>;
	free(): void;
}

// Cache for the loaded module
let contextPromise: Promise<FutharkWebGPUContext> | null = null;

/**
 * Create a new Futhark WebGPU context.
 *
 * Initializes the Emscripten runtime, WASM module, and Futhark context.
 * The context is cached after first creation.
 *
 * @example
 * ```typescript
 * const ctx = await newFutharkWebGPUContext();
 * const rgba = new Uint8Array(imageData.data);
 * const result = await ctx.enhanceContrastRgba(rgba, width, height, 7.0, 3.0, 5.0);
 * ctx.free();
 * ```
 */
export async function newFutharkWebGPUContext(): Promise<FutharkWebGPUContext> {
	if (contextPromise) {
		return contextPromise;
	}

	contextPromise = (async () => {
		try {
			// Import the Emscripten module factory (ESM default export added by build)
			const { default: ModuleFactory } = await import('./pipeline-webgpu.js') as {
				default: (config?: { locateFile?: (path: string) => string }) => Promise<unknown>;
			};

			// Get the WASM URL relative to this module using import.meta.url
			const wasmUrl = new URL('./pipeline-webgpu.wasm', import.meta.url).href;

			// Initialize Emscripten runtime with proper WASM path
			const emscriptenModule = await ModuleFactory({
				locateFile: (path: string) => {
					if (path.endsWith('.wasm')) {
						return wasmUrl;
					}
					return path;
				}
			});

			// Import the wrapper module (ESM exports added by build)
			const { FutharkModule } = await import('./pipeline-webgpu.wrapper.js') as {
				FutharkModule: new () => FutharkModuleInternal;
			};

			// Create and initialize FutharkModule
			const fut = new FutharkModule();
			await fut.init(emscriptenModule);

			return createContext(fut);
		} catch (err: unknown) {
			contextPromise = null; // Reset on failure to allow retry
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(
				`Failed to initialize Futhark WebGPU context. ` +
					`Ensure 'just futhark-webgpu-compile' has been run. ` +
					`Original error: ${message}`
			);
		}
	})();

	return contextPromise;
}

/**
 * Create a typed context wrapper around the raw FutharkModule.
 */
function createContext(fut: FutharkModuleInternal): FutharkWebGPUContext {
	return {
		async enhanceContrastRgba(
			imageFlat: Uint8Array,
			width: number,
			height: number,
			targetContrast: number,
			maxDistance: number,
			sampleDistance: number
		): Promise<Uint8Array> {
			// Create Futhark input array from raw pixel data
			const inputArray = fut.u8_1d.from_data(imageFlat, imageFlat.length);

			try {
				// Call the Futhark entry point
				// i64 params must be BigInt, f32 params are plain numbers
				const [resultArray] = await fut.entry['enhance_contrast_rgba'](
					inputArray,
					BigInt(width),
					BigInt(height),
					targetContrast,
					maxDistance,
					sampleDistance
				);

				// Read result data back from GPU/WASM memory
				const resultData = (await resultArray.values()) as Uint8Array;

				// Free the result array (input is freed in finally)
				resultArray.free();

				return resultData;
			} finally {
				inputArray.free();
			}
		},

		async debugEsdtFlat(
			imageFlat: Uint8Array,
			width: number,
			height: number,
			maxDistance: number
		): Promise<Float32Array> {
			// Create Futhark input array from raw pixel data
			const inputArray = fut.u8_1d.from_data(imageFlat, imageFlat.length);

			try {
				// Call the Futhark entry point
				// i64 params must be BigInt, f32 params are plain numbers
				const [resultArray] = await fut.entry['debug_esdt_flat'](
					inputArray,
					BigInt(width),
					BigInt(height),
					maxDistance
				);

				// Read result data back from GPU/WASM memory
				const resultData = (await resultArray.values()) as Float32Array;

				// Free the result array (input is freed in finally)
				resultArray.free();

				return resultData;
			} finally {
				inputArray.free();
			}
		},

		async sync(): Promise<void> {
			await fut.context_sync();
		},

		free(): void {
			fut.free();
			contextPromise = null;
		}
	};
}

/**
 * Check if the Futhark WebGPU module is available.
 */
export async function isFutharkWebGPUAvailable(): Promise<boolean> {
	try {
		await newFutharkWebGPUContext();
		return true;
	} catch {
		return false;
	}
}

