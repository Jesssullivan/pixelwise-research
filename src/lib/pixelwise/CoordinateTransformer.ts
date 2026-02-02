/**
 * CoordinateTransformer - Multi-space coordinate handling
 *
 * Implements the four-space coordinate model for precise glyph positioning:
 *
 * 1. DOM SPACE (CSS Pixels)
 *    Origin: Viewport top-left
 *    Units: CSS pixels (fractional allowed)
 *    Source: getBoundingClientRect(), Range.getClientRects()
 *
 * 2. PHYSICAL SPACE (Device Pixels)
 *    Origin: Viewport top-left
 *    Units: Physical pixels (integer or fractional)
 *    Transform: DOM × DPR
 *
 * 3. TEXEL SPACE (Integer Texture Coordinates)
 *    Origin: Top-left of capture texture
 *    Units: Integer texel coordinates
 *    Transform: floor(Physical)
 *
 * 4. NORMALIZED UV SPACE (Shader)
 *    Origin: Top-left
 *    Units: [0.0, 1.0]
 *    Transform: Texel / TextureDimensions
 *
 * @module pixelwise/CoordinateTransformer
 */

/**
 * DOM space coordinates (CSS pixels)
 */
export interface DOMCoord {
	x: number;
	y: number;
}

/**
 * Physical space coordinates (device pixels)
 */
export interface PhysicalCoord {
	x: number;
	y: number;
}

/**
 * Texel space coordinates with subpixel offset
 */
export interface TexelCoord {
	/** Integer texel X coordinate */
	x: number;
	/** Integer texel Y coordinate */
	y: number;
	/** Fractional X offset [0, 1) */
	fracX: number;
	/** Fractional Y offset [0, 1) */
	fracY: number;
}

/**
 * Normalized UV coordinates for shader sampling
 */
export interface UVCoord {
	u: number;
	v: number;
}

/**
 * Complete coordinate set across all spaces
 */
export interface MultiSpaceCoord {
	dom: DOMCoord;
	physical: PhysicalCoord;
	texel: TexelCoord;
	uv: UVCoord;
}

/**
 * Viewport bounds in DOM space
 */
export interface ViewportBounds {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * CoordinateTransformer - Transforms coordinates between DOM, Physical, Texel, and UV spaces
 *
 * @example
 * ```typescript
 * const transformer = new CoordinateTransformer(
 *   window.devicePixelRatio,
 *   1920,  // texture width
 *   1080   // texture height
 * );
 *
 * // Transform DOM coordinates through all spaces
 * const multi = transformer.transformAll({ x: 150.5, y: 32.25 });
 * console.log(multi.texel); // { x: 301, y: 64, fracX: 0.0, fracY: 0.5 }
 *
 * // Transform a DOMRect
 * const rect = element.getBoundingClientRect();
 * const texelBounds = transformer.rectToTexelBounds(rect);
 * ```
 */
export class CoordinateTransformer {
	private readonly _dpr: number;
	private readonly _textureWidth: number;
	private readonly _textureHeight: number;
	private readonly _viewportOffset: DOMCoord;

	/**
	 * Create a new CoordinateTransformer
	 *
	 * @param dpr - Device pixel ratio (window.devicePixelRatio)
	 * @param textureWidth - Width of the target texture in texels
	 * @param textureHeight - Height of the target texture in texels
	 * @param viewportOffset - Optional offset if texture doesn't start at viewport origin
	 */
	constructor(
		dpr: number,
		textureWidth: number,
		textureHeight: number,
		viewportOffset: DOMCoord = { x: 0, y: 0 }
	) {
		this._dpr = dpr;
		this._textureWidth = textureWidth;
		this._textureHeight = textureHeight;
		this._viewportOffset = viewportOffset;
	}

	/** Device pixel ratio */
	get dpr(): number {
		return this._dpr;
	}

	/** Texture width in texels */
	get textureWidth(): number {
		return this._textureWidth;
	}

	/** Texture height in texels */
	get textureHeight(): number {
		return this._textureHeight;
	}

	/**
	 * Transform DOM coordinates to Physical coordinates
	 *
	 * Physical = (DOM - viewportOffset) × DPR
	 */
	toPhysical(dom: DOMCoord): PhysicalCoord {
		return {
			x: (dom.x - this._viewportOffset.x) * this._dpr,
			y: (dom.y - this._viewportOffset.y) * this._dpr
		};
	}

	/**
	 * Transform Physical coordinates to Texel coordinates
	 *
	 * Preserves subpixel offset for accurate sampling
	 */
	toTexel(physical: PhysicalCoord): TexelCoord {
		const texelX = Math.floor(physical.x);
		const texelY = Math.floor(physical.y);

		return {
			x: texelX,
			y: texelY,
			fracX: physical.x - texelX,
			fracY: physical.y - texelY
		};
	}

	/**
	 * Transform Texel coordinates to UV coordinates
	 *
	 * Adds 0.5 texel offset to sample texel centers (standard GPU practice)
	 */
	toUV(texel: TexelCoord): UVCoord {
		return {
			u: (texel.x + 0.5) / this._textureWidth,
			v: (texel.y + 0.5) / this._textureHeight
		};
	}

	/**
	 * Transform Texel coordinates to UV with subpixel offset
	 *
	 * Includes fractional offset for precise sampling
	 */
	toUVPrecise(texel: TexelCoord): UVCoord {
		return {
			u: (texel.x + texel.fracX + 0.5) / this._textureWidth,
			v: (texel.y + texel.fracY + 0.5) / this._textureHeight
		};
	}

	/**
	 * Transform DOM coordinates through all spaces
	 */
	transformAll(dom: DOMCoord): MultiSpaceCoord {
		const physical = this.toPhysical(dom);
		const texel = this.toTexel(physical);
		const uv = this.toUV(texel);

		return { dom, physical, texel, uv };
	}

	/**
	 * Transform a DOMRect to texel bounds
	 *
	 * Returns integer bounds that fully contain the rect
	 */
	rectToTexelBounds(rect: DOMRect | DOMRectReadOnly): {
		x: number;
		y: number;
		width: number;
		height: number;
		fracStartX: number;
		fracStartY: number;
		fracEndX: number;
		fracEndY: number;
	} {
		const start = this.transformAll({ x: rect.left, y: rect.top });
		const end = this.transformAll({ x: rect.right, y: rect.bottom });

		// Expand to fully contain the rect
		const x = start.texel.x;
		const y = start.texel.y;
		const endX = end.texel.fracX > 0 ? end.texel.x + 1 : end.texel.x;
		const endY = end.texel.fracY > 0 ? end.texel.y + 1 : end.texel.y;

		return {
			x,
			y,
			width: endX - x,
			height: endY - y,
			fracStartX: start.texel.fracX,
			fracStartY: start.texel.fracY,
			fracEndX: end.texel.fracX,
			fracEndY: end.texel.fracY
		};
	}

	/**
	 * Check if a texel coordinate is within texture bounds
	 */
	isInBounds(texel: TexelCoord): boolean {
		return texel.x >= 0 && texel.x < this._textureWidth && texel.y >= 0 && texel.y < this._textureHeight;
	}

	/**
	 * Clamp texel coordinates to texture bounds
	 */
	clampTexel(texel: TexelCoord): TexelCoord {
		return {
			x: Math.max(0, Math.min(this._textureWidth - 1, texel.x)),
			y: Math.max(0, Math.min(this._textureHeight - 1, texel.y)),
			fracX: texel.fracX,
			fracY: texel.fracY
		};
	}

	/**
	 * Create a transformer for the current viewport
	 *
	 * @param textureWidth - Optional texture width (defaults to viewport width × DPR)
	 * @param textureHeight - Optional texture height (defaults to viewport height × DPR)
	 */
	static fromViewport(textureWidth?: number, textureHeight?: number): CoordinateTransformer {
		const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
		const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
		const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;

		return new CoordinateTransformer(dpr, textureWidth ?? Math.round(vw * dpr), textureHeight ?? Math.round(vh * dpr));
	}

	/**
	 * Create a transformer for a specific element's capture
	 *
	 * @param element - Element being captured
	 * @param textureWidth - Width of capture texture
	 * @param textureHeight - Height of capture texture
	 */
	static fromElement(element: Element, textureWidth: number, textureHeight: number): CoordinateTransformer {
		const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
		const rect = element.getBoundingClientRect();

		return new CoordinateTransformer(dpr, textureWidth, textureHeight, { x: rect.left, y: rect.top });
	}
}

/**
 * Batch transform multiple DOM coordinates to texel space
 *
 * Optimized for processing many coordinates at once
 *
 * @param coords - Array of DOM coordinates
 * @param dpr - Device pixel ratio
 * @param viewportOffset - Optional viewport offset
 * @returns Float32Array with [x0, y0, fracX0, fracY0, x1, y1, fracX1, fracY1, ...]
 */
export function batchDOMToTexel(
	coords: DOMCoord[],
	dpr: number,
	viewportOffset: DOMCoord = { x: 0, y: 0 }
): Float32Array {
	const result = new Float32Array(coords.length * 4);

	for (let i = 0; i < coords.length; i++) {
		const physX = (coords[i].x - viewportOffset.x) * dpr;
		const physY = (coords[i].y - viewportOffset.y) * dpr;
		const texelX = Math.floor(physX);
		const texelY = Math.floor(physY);

		const offset = i * 4;
		result[offset] = texelX;
		result[offset + 1] = texelY;
		result[offset + 2] = physX - texelX; // fracX
		result[offset + 3] = physY - texelY; // fracY
	}

	return result;
}

/**
 * Pack texel coordinates into GPU-friendly format
 *
 * @param texels - Array of texel coordinates
 * @returns Object with separate arrays for GPU buffers
 */
export function packTexelsForGPU(texels: TexelCoord[]): {
	positions: Uint32Array;
	subpixelOffsets: Float32Array;
} {
	const positions = new Uint32Array(texels.length * 2);
	const subpixelOffsets = new Float32Array(texels.length * 2);

	for (let i = 0; i < texels.length; i++) {
		const t = texels[i];
		positions[i * 2] = t.x;
		positions[i * 2 + 1] = t.y;
		subpixelOffsets[i * 2] = t.fracX;
		subpixelOffsets[i * 2 + 1] = t.fracY;
	}

	return { positions, subpixelOffsets };
}
