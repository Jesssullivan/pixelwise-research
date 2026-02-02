/**
 * Pixelwise Core Modules
 *
 * Clean, modular architecture for WCAG contrast enhancement:
 * - ViewportCapture: DOM to pixel data
 * - ComputeDispatcher: ESDT + WCAG processing (Futhark WASM or WebGPU)
 * - OverlayCompositor: WebGL2 overlay rendering
 */

export { createViewportCapture } from './ViewportCapture';
export type { ViewportCapture, CaptureOptions, CaptureResult, ViewportCaptureState } from './ViewportCapture';

export { createComputeDispatcher, DEFAULT_CONFIG } from './ComputeDispatcher';
export type { ComputeDispatcher, ComputeConfig, EsdtResult, PipelineResult, ComputeBackend } from './ComputeDispatcher';

export { createOverlayCompositor } from './OverlayCompositor';
export type { OverlayCompositor, OverlayConfig } from './OverlayCompositor';
