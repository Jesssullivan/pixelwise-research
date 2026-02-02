/**
 * BackgroundCapture - Captures background content for compositor
 *
 * Supports multiple background types:
 * - CSS backgrounds (via Canvas 2D fillStyle - handles all CSS colors natively)
 * - Canvas elements (direct texture binding)
 * - Video elements (direct texture binding)
 * - WebGL framebuffers (render-to-texture)
 * - SVG elements (rasterize to canvas)
 */
export class BackgroundCapture {
	private captureCanvas: HTMLCanvasElement;
	private captureCtx: CanvasRenderingContext2D;
	private width: number = 0;
	private height: number = 0;
	private dpr: number = 1;
	private lastCaptureTime: number = 0;
	private captureThrottleMs: number = 32; // ~30fps capture rate

	constructor(throttleMs: number = 32) {
		this.captureCanvas = document.createElement('canvas');
		this.captureCtx = this.captureCanvas.getContext('2d', {
			willReadFrequently: true
		})!;
		this.captureThrottleMs = throttleMs;
	}

	/**
	 * Resize capture canvas
	 * @param width - Width in physical pixels (CSS width * DPR)
	 * @param height - Height in physical pixels (CSS height * DPR)
	 */
	resize(width: number, height: number): void {
		const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

		if (this.width !== width || this.height !== height || this.dpr !== dpr) {
			this.width = width;
			this.height = height;
			this.dpr = dpr;
			this.captureCanvas.width = width;
			this.captureCanvas.height = height;

			// Scale context to account for DPR
			// This way we can draw with CSS coordinates and they scale correctly
			this.captureCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
	}

	/**
	 * Capture from any TexImageSource directly
	 * This is the zero-copy path for Canvas, Video, ImageBitmap
	 *
	 * @param source - Canvas, Video, Image, or ImageBitmap
	 * @returns The source itself (for direct WebGL texture binding)
	 */
	captureFromSource(source: TexImageSource): TexImageSource {
		return source; // Direct pass-through for zero-copy
	}

	/**
	 * Capture background from DOM element (CSS backgrounds, etc.)
	 * This requires rasterization to canvas.
	 *
	 * Uses canvas fillStyle for color parsing which handles ALL CSS color formats:
	 * - rgb(), rgba(), hex, hsl(), oklch(), lab(), lch(), color(), etc.
	 * The browser converts any color to sRGB when rendering to canvas.
	 *
	 * @param element - DOM element to capture background from
	 * @returns Canvas with captured background
	 */
	async captureFromDOM(element: HTMLElement): Promise<HTMLCanvasElement> {
		const now = performance.now();

		// Throttle captures
		if (now - this.lastCaptureTime < this.captureThrottleMs) {
			return this.captureCanvas; // Return cached
		}

		// Get CSS dimensions (context is already scaled by DPR)
		const cssWidth = this.width / this.dpr;
		const cssHeight = this.height / this.dpr;

		// Clear canvas (using CSS coordinates since context is scaled)
		this.captureCtx.clearRect(0, 0, cssWidth, cssHeight);

		// Capture CSS background
		const style = window.getComputedStyle(element);
		const bgColor = style.backgroundColor;

		// Fill with background color (using CSS coordinates)
		// Canvas fillStyle handles OKLCH and other modern color formats natively!
		// The browser converts to sRGB when rendering.
		if (bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)') {
			// Set fillStyle directly - canvas context handles color conversion
			this.captureCtx.fillStyle = bgColor;
			this.captureCtx.fillRect(0, 0, cssWidth, cssHeight);
		}

		// TODO: Handle background-image if needed
		// This would require parsing bgImage and drawing it

		this.lastCaptureTime = now;
		return this.captureCanvas;
	}

	/**
	 * Capture from SVG element by serializing and rasterizing
	 *
	 * @param svg - SVG element to capture
	 * @returns Canvas with rasterized SVG
	 */
	async captureFromSVG(svg: SVGSVGElement): Promise<HTMLCanvasElement> {
		const now = performance.now();

		if (now - this.lastCaptureTime < this.captureThrottleMs) {
			return this.captureCanvas;
		}

		// Serialize SVG
		const svgData = new XMLSerializer().serializeToString(svg);
		const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
		const url = URL.createObjectURL(svgBlob);

		try {
			// Load as image
			const img = new Image();
			await new Promise<void>((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = reject;
				img.src = url;
			});

			// Draw to canvas
			this.captureCtx.clearRect(0, 0, this.width, this.height);
			this.captureCtx.drawImage(img, 0, 0, this.width, this.height);

			this.lastCaptureTime = now;
		} finally {
			URL.revokeObjectURL(url);
		}

		return this.captureCanvas;
	}

	/**
	 * Capture from video element
	 *
	 * @param video - Video element
	 * @returns The video element itself (direct texture binding)
	 */
	captureFromVideo(video: HTMLVideoElement): HTMLVideoElement {
		// Videos can be used directly as texture source
		return video;
	}

	/**
	 * Composite multiple background layers
	 * Draws them in order from back to front
	 *
	 * @param layers - Array of background sources in back-to-front order
	 * @returns Canvas with composited background
	 */
	async compositeBackgrounds(
		layers: Array<{
			source: TexImageSource | HTMLElement | SVGSVGElement;
			type: 'direct' | 'dom' | 'svg';
		}>
	): Promise<HTMLCanvasElement> {
		this.captureCtx.clearRect(0, 0, this.width, this.height);

		for (const layer of layers) {
			let canvas: HTMLCanvasElement | TexImageSource;

			switch (layer.type) {
				case 'direct':
					canvas = layer.source as TexImageSource;
					this.captureCtx.drawImage(canvas as CanvasImageSource, 0, 0, this.width, this.height);
					break;
				case 'dom':
					canvas = await this.captureFromDOM(layer.source as HTMLElement);
					this.captureCtx.drawImage(canvas, 0, 0);
					break;
				case 'svg':
					canvas = await this.captureFromSVG(layer.source as SVGSVGElement);
					this.captureCtx.drawImage(canvas, 0, 0);
					break;
			}
		}

		return this.captureCanvas;
	}

	/**
	 * Get the capture canvas for WebGL texture binding
	 */
	getCanvas(): HTMLCanvasElement {
		return this.captureCanvas;
	}

	/**
	 * Set capture throttle rate
	 */
	setThrottleMs(ms: number): void {
		this.captureThrottleMs = ms;
	}

	/**
	 * Dispose resources
	 */
	dispose(): void {
		this.captureCanvas.width = 0;
		this.captureCanvas.height = 0;
	}
}

export default BackgroundCapture;
