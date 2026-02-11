/**
 * Futhark ESDT WASM Module Wrapper
 *
 * Combines the Emscripten runtime (esdt.mjs) with the Futhark context wrapper (esdt.class.js)
 * to provide a proper ES module interface.
 *
 * Usage:
 *   import { newFutharkContext } from '$lib/futhark';
 *   const ctx = await newFutharkContext();
 *   const result = ctx.compute_esdt_2d(levels2d, useRelaxation);
 */

// Import the Emscripten runtime which provides loadWASM
import loadWASM from './esdt.mjs';

// Augment globalThis to include the loadWASM function
// esdt.class.js expects loadWASM to be in global scope
declare global {
	// eslint-disable-next-line no-var
	var loadWASM: typeof import('./esdt.mjs').default;
}

// Make loadWASM available globally for esdt.class.js
globalThis.loadWASM = loadWASM;

// Re-export everything from esdt.class.js
export { newFutharkContext, FutharkContext, FutharkArray, FutharkOpaque } from './esdt.class.js';

// Also export loadWASM for direct access if needed
export { loadWASM };
