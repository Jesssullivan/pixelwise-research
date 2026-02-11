/**
 * WebGPUVideoCapture - Zero-copy video frame import for WebGPU
 *
 * Provides efficient video frame import using:
 * - importExternalTexture() for zero-copy access (Chrome, Safari)
 * - copyExternalImageToTexture() fallback for Firefox
 *
 * External textures have single-frame lifetime - they expire after
 * command buffer submission and must be recreated each frame.
 *
 * @module capture/WebGPUVideoCapture
 */

import { browser } from '$app/environment';

/**
 * Result of importing a video frame to WebGPU
 */
export interface VideoFrameImport {
	/** External texture (Chrome/Safari) or null if using fallback */
	externalTexture: GPUExternalTexture | null;
	/** Regular texture (Firefox fallback) or null if using external */
	texture: GPUTexture | null;
	/** Width of the imported frame */
	width: number;
	/** Height of the imported frame */
	height: number;
	/** Whether this import uses the fallback path */
	isFallback: boolean;
}

/**
 * Capabilities of the WebGPU video capture system
 */
export interface VideoCaptureCapabilities {
	/** Whether WebGPU is available */
	webgpu: boolean;
	/** Whether importExternalTexture is supported */
	importExternalTexture: boolean;
	/** Whether copyExternalImageToTexture is supported */
	copyExternalImage: boolean;
	/** Recommended import method */
	recommendedMethod: 'external' | 'copy' | 'none';
}

/**
 * WebGPUVideoCapture - Handles video frame import to WebGPU textures
 *
 * @example
 * ```typescript
 * const capture = new WebGPUVideoCapture(device);
 *
 * // Import video frame (zero-copy if supported)
 * const frame = capture.importFrame(videoElement);
 *
 * // Create bind group for shader access
 * const bindGroup = capture.createBindGroup(layout, frame);
 *
 * // Use in compute pass
 * pass.setBindGroup(0, bindGroup);
 * pass.dispatchWorkgroups(...);
 *
 * // Frame expires after queue.submit() - import again next frame
 * ```
 */
export class WebGPUVideoCapture {
	private readonly device: GPUDevice;
	private readonly sampler: GPUSampler;
	private fallbackTexture: GPUTexture | null = null;
	private fallbackTextureWidth = 0;
	private fallbackTextureHeight = 0;
	private readonly _capabilities: VideoCaptureCapabilities;

	/**
	 * Create a new WebGPUVideoCapture instance
	 *
	 * @param device - WebGPU device to use for texture operations
	 */
	constructor(device: GPUDevice) {
		this.device = device;

		// Create sampler for video texture sampling
		this.sampler = device.createSampler({
			label: 'video-capture-sampler',
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});

		// Detect capabilities
		this._capabilities = this.detectCapabilities();
	}

	/** Sampler for video texture access in shaders */
	get videoSampler(): GPUSampler {
		return this.sampler;
	}

	/** Detected capabilities */
	get capabilities(): VideoCaptureCapabilities {
		return this._capabilities;
	}

	/**
	 * Check if external texture import is supported
	 */
	static isExternalTextureSupported(): boolean {
		if (!browser) return false;

		// Check if the method exists on GPUDevice prototype
		return typeof GPUDevice !== 'undefined' && 'importExternalTexture' in GPUDevice.prototype;
	}

	/**
	 * Detect WebGPU video capture capabilities
	 */
	private detectCapabilities(): VideoCaptureCapabilities {
		const webgpu = browser && typeof navigator !== 'undefined' && 'gpu' in navigator;

		const importExternalTexture = WebGPUVideoCapture.isExternalTextureSupported();

		// copyExternalImageToTexture is widely supported
		const copyExternalImage = webgpu && typeof GPUQueue !== 'undefined' && 'copyExternalImageToTexture' in GPUQueue.prototype;

		let recommendedMethod: 'external' | 'copy' | 'none' = 'none';
		if (importExternalTexture) {
			recommendedMethod = 'external';
		} else if (copyExternalImage) {
			recommendedMethod = 'copy';
		}

		return {
			webgpu,
			importExternalTexture,
			copyExternalImage,
			recommendedMethod
		};
	}

	/**
	 * Import a video frame as a WebGPU texture
	 *
	 * Uses importExternalTexture for zero-copy access if available,
	 * falls back to copyExternalImageToTexture for Firefox.
	 *
	 * @param source - Video element or VideoFrame to import
	 * @param colorSpace - Color space for the import (default: 'srgb')
	 * @returns VideoFrameImport with texture resources
	 */
	importFrame(
		source: HTMLVideoElement | VideoFrame,
		colorSpace: PredefinedColorSpace = 'srgb'
	): VideoFrameImport {
		const width = source instanceof HTMLVideoElement ? source.videoWidth : source.displayWidth;
		const height = source instanceof HTMLVideoElement ? source.videoHeight : source.displayHeight;

		if (width === 0 || height === 0) {
			throw new Error('Video source has zero dimensions');
		}

		// Try zero-copy external texture first
		if (this._capabilities.importExternalTexture) {
			try {
				const externalTexture = this.device.importExternalTexture({
					source,
					colorSpace
				});

				return {
					externalTexture,
					texture: null,
					width,
					height,
					isFallback: false
				};
			} catch (err: unknown) {
				console.warn('[WebGPUVideoCapture] importExternalTexture failed, using fallback:', err);
				// Fall through to fallback
			}
		}

		// Fallback: copy to regular texture
		if (this._capabilities.copyExternalImage) {
			const texture = this.copyToTexture(source, width, height);
			return {
				externalTexture: null,
				texture,
				width,
				height,
				isFallback: true
			};
		}

		throw new Error('No video import method available');
	}

	/**
	 * Import a video frame directly to an external texture (zero-copy)
	 *
	 * @param source - Video element or VideoFrame
	 * @param colorSpace - Color space for the import
	 * @returns GPUExternalTexture (valid for single frame only)
	 * @throws Error if importExternalTexture is not supported
	 */
	importExternalTexture(
		source: HTMLVideoElement | VideoFrame,
		colorSpace: PredefinedColorSpace = 'srgb'
	): GPUExternalTexture {
		if (!this._capabilities.importExternalTexture) {
			throw new Error('importExternalTexture is not supported in this browser');
		}

		return this.device.importExternalTexture({
			source,
			colorSpace
		});
	}

	/**
	 * Copy video frame to a regular GPUTexture (fallback for Firefox)
	 *
	 * This involves a GPU copy operation but is widely supported.
	 *
	 * @param source - Video element or VideoFrame
	 * @param width - Target width
	 * @param height - Target height
	 * @returns GPUTexture with the video frame data
	 */
	copyToTexture(source: HTMLVideoElement | VideoFrame, width: number, height: number): GPUTexture {
		// Reuse or create fallback texture
		if (
			!this.fallbackTexture ||
			this.fallbackTextureWidth !== width ||
			this.fallbackTextureHeight !== height
		) {
			// Clean up old texture
			if (this.fallbackTexture) {
				this.fallbackTexture.destroy();
			}

			// Create new texture
			this.fallbackTexture = this.device.createTexture({
				label: 'video-capture-fallback',
				size: [width, height],
				format: 'rgba8unorm',
				usage:
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_DST |
					GPUTextureUsage.RENDER_ATTACHMENT
			});

			this.fallbackTextureWidth = width;
			this.fallbackTextureHeight = height;
		}

		// Copy video frame to texture
		this.device.queue.copyExternalImageToTexture(
			{ source, flipY: false },
			{ texture: this.fallbackTexture },
			[width, height]
		);

		return this.fallbackTexture;
	}

	/**
	 * Create a bind group for shader access to a video frame
	 *
	 * @param layout - Bind group layout
	 * @param frame - Imported video frame
	 * @param additionalEntries - Additional entries to include
	 * @returns GPUBindGroup configured for the frame
	 */
	createBindGroup(
		layout: GPUBindGroupLayout,
		frame: VideoFrameImport,
		additionalEntries: GPUBindGroupEntry[] = []
	): GPUBindGroup {
		const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: this.sampler }];

		if (frame.externalTexture) {
			// External texture binding
			entries.push({ binding: 1, resource: frame.externalTexture });
		} else if (frame.texture) {
			// Regular texture view binding
			entries.push({ binding: 1, resource: frame.texture.createView() });
		} else {
			throw new Error('VideoFrameImport has no texture');
		}

		// Add any additional entries
		entries.push(...additionalEntries);

		return this.device.createBindGroup({
			label: 'video-capture-bind-group',
			layout,
			entries
		});
	}

	/**
	 * Create a bind group for external texture specifically
	 *
	 * Must be called each frame as external textures expire.
	 */
	createExternalTextureBindGroup(
		layout: GPUBindGroupLayout,
		externalTexture: GPUExternalTexture,
		additionalEntries: GPUBindGroupEntry[] = []
	): GPUBindGroup {
		return this.device.createBindGroup({
			label: 'external-texture-bind-group',
			layout,
			entries: [
				{ binding: 0, resource: this.sampler },
				{ binding: 1, resource: externalTexture },
				...additionalEntries
			]
		});
	}

	/**
	 * Create a bind group layout for video texture access
	 *
	 * @param useExternalTexture - Whether to use external texture binding
	 * @param additionalEntries - Additional layout entries
	 */
	createBindGroupLayout(
		useExternalTexture: boolean = this._capabilities.importExternalTexture,
		additionalEntries: GPUBindGroupLayoutEntry[] = []
	): GPUBindGroupLayout {
		const entries: GPUBindGroupLayoutEntry[] = [
			{
				binding: 0,
				visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
				sampler: { type: 'filtering' }
			}
		];

		if (useExternalTexture) {
			entries.push({
				binding: 1,
				visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
				externalTexture: {}
			});
		} else {
			entries.push({
				binding: 1,
				visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
				texture: { sampleType: 'float' }
			});
		}

		entries.push(...additionalEntries);

		return this.device.createBindGroupLayout({
			label: 'video-capture-layout',
			entries
		});
	}

	/**
	 * Clean up resources
	 */
	destroy(): void {
		if (this.fallbackTexture) {
			this.fallbackTexture.destroy();
			this.fallbackTexture = null;
		}
	}
}

/**
 * Create a WebGPUVideoCapture instance
 *
 * @param device - WebGPU device
 */
export function createWebGPUVideoCapture(device: GPUDevice): WebGPUVideoCapture {
	return new WebGPUVideoCapture(device);
}

/**
 * Check if video capture to WebGPU is supported
 */
export function isVideoCaptureSupported(): boolean {
	if (!browser) return false;

	return (
		WebGPUVideoCapture.isExternalTextureSupported() ||
		(typeof GPUQueue !== 'undefined' && 'copyExternalImageToTexture' in GPUQueue.prototype)
	);
}
