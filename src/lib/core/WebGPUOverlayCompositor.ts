/**
 * WebGPUOverlayCompositor - WebGPU render pipeline overlay
 *
 * Drop-in replacement for OverlayCompositor that uses a WebGPU render pipeline
 * instead of WebGL2. Shares the same GPUDevice as the Futhark WebGPU backend,
 * eliminating the two-context problem (WebGL2 + WebGPU compute).
 *
 * Features:
 * - Fixed-position overlay canvas matching viewport
 * - Full-screen triangle render (no vertex buffer needed)
 * - Alpha-blend with discard for click-through
 * - Accepts shared GPUDevice to avoid creating a second device
 * - updateTextureFromBuffer() for direct Uint8Array path (no Uint8ClampedArray copy)
 */

import { browser } from '$app/environment';
import overlayShaderSource from '$lib/pixelwise/shaders/overlay-blend.wgsl?raw';

export interface WebGPUOverlayConfig {
	/** Z-index for the overlay canvas */
	zIndex?: number;
	/** Enable debug outline */
	debug?: boolean;
}

const DEFAULT_CONFIG: WebGPUOverlayConfig = {
	zIndex: 99999,
	debug: false
};

interface WebGPUState {
	device: GPUDevice;
	context: GPUCanvasContext;
	pipeline: GPURenderPipeline;
	sampler: GPUSampler;
	texture: GPUTexture;
	bindGroup: GPUBindGroup;
	bindGroupLayout: GPUBindGroupLayout;
	format: GPUTextureFormat;
	textureWidth: number;
	textureHeight: number;
}

/**
 * Creates a WebGPU overlay compositor for rendering adjusted pixels.
 * Same public interface as createOverlayCompositor() (WebGL2 version).
 */
export function createWebGPUOverlayCompositor() {
	let canvas: HTMLCanvasElement | null = null;
	let gpuState: WebGPUState | null = null;
	let config: WebGPUOverlayConfig = { ...DEFAULT_CONFIG };
	let isVisible = false;

	/**
	 * Initialize the overlay canvas and WebGPU render pipeline.
	 *
	 * @param options - Overlay configuration
	 * @param device - Optional shared GPUDevice (avoids creating a second device)
	 */
	async function initialize(
		options: WebGPUOverlayConfig = {},
		device?: GPUDevice
	): Promise<boolean> {
		if (!browser) return false;

		config = { ...DEFAULT_CONFIG, ...options };

		try {
			// Get or create GPUDevice
			if (!device) {
				if (!navigator.gpu) {
					throw new Error('WebGPU not supported');
				}
				const adapter = await navigator.gpu.requestAdapter({
					powerPreference: 'high-performance'
				});
				if (!adapter) {
					throw new Error('No WebGPU adapter available');
				}
				device = await adapter.requestDevice();
			}

			// Create overlay canvas
			canvas = document.createElement('canvas');
			canvas.id = 'pixelwise-webgpu-overlay';
			canvas.style.cssText = `
				position: fixed;
				top: 0;
				left: 0;
				width: 100vw;
				height: 100vh;
				pointer-events: none;
				z-index: ${config.zIndex};
				${config.debug ? 'outline: 2px solid lime;' : ''}
			`;

			// Get WebGPU canvas context
			const context = canvas.getContext('webgpu');
			if (!context) {
				throw new Error('Failed to get WebGPU canvas context');
			}

			const format = navigator.gpu.getPreferredCanvasFormat();
			context.configure({
				device,
				format,
				alphaMode: 'premultiplied'
			});

			// Create shader module
			const shaderModule = device.createShaderModule({
				label: 'overlay-blend',
				code: overlayShaderSource
			});

			const info = await shaderModule.getCompilationInfo();
			for (const msg of info.messages) {
				if (msg.type === 'error') {
					throw new Error(`Overlay shader error: ${msg.message}`);
				}
			}

			// Create sampler
			const sampler = device.createSampler({
				label: 'overlay-sampler',
				magFilter: 'linear',
				minFilter: 'linear',
				addressModeU: 'clamp-to-edge',
				addressModeV: 'clamp-to-edge'
			});

			// Create initial 1x1 placeholder texture
			const texture = device.createTexture({
				label: 'overlay-texture',
				size: [1, 1],
				format: 'rgba8unorm',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
			});

			// Create bind group layout
			const bindGroupLayout = device.createBindGroupLayout({
				label: 'overlay-bind-group-layout',
				entries: [
					{
						binding: 0,
						visibility: GPUShaderStage.FRAGMENT,
						sampler: { type: 'filtering' }
					},
					{
						binding: 1,
						visibility: GPUShaderStage.FRAGMENT,
						texture: { sampleType: 'float' }
					}
				]
			});

			// Create bind group
			const bindGroup = device.createBindGroup({
				label: 'overlay-bind-group',
				layout: bindGroupLayout,
				entries: [
					{ binding: 0, resource: sampler },
					{ binding: 1, resource: texture.createView() }
				]
			});

			// Create render pipeline
			const pipeline = device.createRenderPipeline({
				label: 'overlay-render-pipeline',
				layout: device.createPipelineLayout({
					bindGroupLayouts: [bindGroupLayout]
				}),
				vertex: {
					module: shaderModule,
					entryPoint: 'vs_main'
				},
				fragment: {
					module: shaderModule,
					entryPoint: 'fs_main',
					targets: [
						{
							format,
							blend: {
								color: {
									srcFactor: 'src-alpha',
									dstFactor: 'one-minus-src-alpha',
									operation: 'add'
								},
								alpha: {
									srcFactor: 'one',
									dstFactor: 'one-minus-src-alpha',
									operation: 'add'
								}
							}
						}
					]
				},
				primitive: {
					topology: 'triangle-list'
				}
			});

			gpuState = {
				device,
				context,
				pipeline,
				sampler,
				texture,
				bindGroup,
				bindGroupLayout,
				format,
				textureWidth: 1,
				textureHeight: 1
			};

			// Add canvas to DOM
			document.body.appendChild(canvas);

			// Initial resize
			resize();

			// Listen for window resize
			window.addEventListener('resize', resize);

			return true;
		} catch (err: unknown) {
			console.error('WebGPUOverlayCompositor initialization failed:', err);
			destroy();
			return false;
		}
	}

	/**
	 * Resize canvas to match viewport
	 */
	function resize() {
		if (!canvas || !gpuState) return;

		const dpr = window.devicePixelRatio || 1;
		const width = window.innerWidth;
		const height = window.innerHeight;

		canvas.width = Math.floor(width * dpr);
		canvas.height = Math.floor(height * dpr);
		canvas.style.width = `${width}px`;
		canvas.style.height = `${height}px`;
	}

	/**
	 * Recreate texture and bind group when dimensions change
	 */
	function ensureTexture(width: number, height: number) {
		if (!gpuState) return;
		if (gpuState.textureWidth === width && gpuState.textureHeight === height) return;

		// Destroy old texture
		gpuState.texture.destroy();

		// Create new texture
		gpuState.texture = gpuState.device.createTexture({
			label: 'overlay-texture',
			size: [width, height],
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		});

		// Recreate bind group with new texture view
		gpuState.bindGroup = gpuState.device.createBindGroup({
			label: 'overlay-bind-group',
			layout: gpuState.bindGroupLayout,
			entries: [
				{ binding: 0, resource: gpuState.sampler },
				{ binding: 1, resource: gpuState.texture.createView() }
			]
		});

		gpuState.textureWidth = width;
		gpuState.textureHeight = height;
	}

	/**
	 * Update the overlay texture with new adjusted pixels (Uint8ClampedArray).
	 * Compatible with the WebGL2 OverlayCompositor interface.
	 */
	function updateTexture(pixels: Uint8ClampedArray, width: number, height: number) {
		if (!gpuState) return;

		ensureTexture(width, height);

		gpuState.device.queue.writeTexture(
			{ texture: gpuState.texture },
			pixels,
			{ bytesPerRow: width * 4, rowsPerImage: height },
			{ width, height }
		);
	}

	/**
	 * Update the overlay texture directly from a Uint8Array buffer.
	 * Avoids the Uint8ClampedArray copy when coming from Futhark WebGPU output.
	 */
	function updateTextureFromBuffer(data: Uint8Array, width: number, height: number) {
		if (!gpuState) return;

		ensureTexture(width, height);

		gpuState.device.queue.writeTexture(
			{ texture: gpuState.texture },
			data,
			{ bytesPerRow: width * 4, rowsPerImage: height },
			{ width, height }
		);
	}

	/**
	 * Render the overlay
	 */
	function render() {
		if (!gpuState || !canvas) return;

		const { device, context, pipeline, bindGroup } = gpuState;

		const textureView = context.getCurrentTexture().createView();

		const encoder = device.createCommandEncoder({ label: 'overlay-render' });
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: textureView,
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
					loadOp: 'clear',
					storeOp: 'store'
				}
			]
		});

		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(3); // Full-screen triangle (3 vertices, generated in shader)
		pass.end();

		device.queue.submit([encoder.finish()]);
	}

	/**
	 * Show the overlay
	 */
	function show() {
		if (canvas) {
			canvas.style.display = 'block';
			isVisible = true;
		}
	}

	/**
	 * Hide the overlay
	 */
	function hide() {
		if (canvas) {
			canvas.style.display = 'none';
			isVisible = false;
		}
	}

	/**
	 * Clear the overlay
	 */
	function clear() {
		if (!gpuState || !canvas) return;

		const { device, context } = gpuState;
		const textureView = context.getCurrentTexture().createView();

		const encoder = device.createCommandEncoder({ label: 'overlay-clear' });
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: textureView,
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
					loadOp: 'clear',
					storeOp: 'store'
				}
			]
		});
		pass.end();

		device.queue.submit([encoder.finish()]);
	}

	/**
	 * Cleanup resources
	 */
	function destroy() {
		window.removeEventListener('resize', resize);

		if (gpuState) {
			gpuState.texture.destroy();
			// Don't destroy the device if it was shared
		}

		if (canvas && canvas.parentNode) {
			canvas.parentNode.removeChild(canvas);
		}

		canvas = null;
		gpuState = null;
	}

	return {
		initialize,
		resize,
		updateTexture,
		updateTextureFromBuffer,
		render,
		show,
		hide,
		clear,
		destroy,
		get isVisible() {
			return isVisible;
		},
		get canvas() {
			return canvas;
		}
	};
}

export type WebGPUOverlayCompositor = ReturnType<typeof createWebGPUOverlayCompositor>;
