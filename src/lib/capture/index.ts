/**
 * Capture Module - Screen Capture + WebGPU Video Pipeline
 *
 * Provides real-time screen capture with WebGPU video frame processing
 * for the ESDT contrast enhancement pipeline.
 *
 * Components:
 * - ScreenCaptureSource: Screen Capture API wrapper
 * - WebGPUVideoCapture: Zero-copy video frame import to WebGPU
 * - FrameLifetimeManager: External texture lifecycle management
 * - BufferRing: Triple-buffer frame pipeline for 60fps
 * - GlyphFrameSynchronizer: Glyph-frame coordination
 *
 * @module capture
 */

// Core capture components
export {
	ScreenCaptureSource,
	createScreenCaptureSource,
	startScreenCapture,
	type ScreenCaptureConfig,
	type FrameMetadata,
	type FrameCallback,
	type CaptureState,
	DEFAULT_CAPTURE_CONFIG
} from './ScreenCaptureSource';

export {
	WebGPUVideoCapture,
	createWebGPUVideoCapture,
	isVideoCaptureSupported,
	type VideoFrameImport,
	type VideoCaptureCapabilities
} from './WebGPUVideoCapture';

export {
	FrameLifetimeManager,
	createFrameLifetimeManager,
	type FrameProcessingResult,
	type FrameLifetimeConfig,
	type PipelineStage,
	DEFAULT_FRAME_CONFIG
} from './FrameLifetimeManager';

export {
	BufferRing,
	createBufferRing,
	type FrameBuffers,
	type BufferStatus,
	type BufferRingConfig,
	DEFAULT_RING_CONFIG
} from './BufferRing';

export {
	GlyphFrameSynchronizer,
	createGlyphFrameSynchronizer,
	type GlyphSyncConfig,
	type FrameGlyphData,
	DEFAULT_SYNC_CONFIG
} from './GlyphFrameSynchronizer';
