/**
 * OverlayCompositor - WebGL2/WebGPU final blend layer
 *
 * Renders the adjusted glyph pixels as an overlay on top of the original DOM.
 * Uses WebGL2 for maximum browser compatibility, with WebGPU as an optional upgrade.
 *
 * Features:
 * - Fixed-position overlay canvas matching viewport
 * - Efficient texture upload and blend
 * - Pointer-events: none for click-through
 * - Automatic resize handling
 */

import { browser } from '$app/environment';

export interface OverlayConfig {
	/** Z-index for the overlay canvas */
	zIndex?: number;
	/** Blend mode for overlay */
	blendMode?: 'normal' | 'multiply' | 'screen';
	/** Enable debug outline */
	debug?: boolean;
}

const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
	zIndex: 99999,
	blendMode: 'normal',
	debug: false
};

interface WebGLState {
	gl: WebGL2RenderingContext;
	program: WebGLProgram;
	positionBuffer: WebGLBuffer;
	texCoordBuffer: WebGLBuffer;
	texture: WebGLTexture;
	positionLocation: number;
	texCoordLocation: number;
	textureLocation: WebGLUniformLocation;
}

/**
 * Creates an overlay compositor for rendering adjusted pixels
 */
export function createOverlayCompositor() {
	let canvas: HTMLCanvasElement | null = null;
	let glState: WebGLState | null = null;
	let config: OverlayConfig = { ...DEFAULT_OVERLAY_CONFIG };
	let isVisible = false;

	const vertexShaderSource = `#version 300 es
    in vec2 a_position;
    in vec2 a_texCoord;
    out vec2 v_texCoord;

    void main() {
      // Flip Y for correct orientation
      gl_Position = vec4(a_position * 2.0 - 1.0, 0.0, 1.0);
      gl_Position.y = -gl_Position.y;
      v_texCoord = a_texCoord;
    }
  `;

	const fragmentShaderSource = `#version 300 es
    precision highp float;

    in vec2 v_texCoord;
    out vec4 fragColor;

    uniform sampler2D u_texture;

    void main() {
      vec4 color = texture(u_texture, v_texCoord);
      // Only render pixels with non-zero alpha (adjusted pixels)
      if (color.a < 0.01) {
        discard;
      }
      fragColor = color;
    }
  `;

	/**
	 * Create and compile a shader
	 */
	function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
		const shader = gl.createShader(type);
		if (!shader) throw new Error('Failed to create shader');

		gl.shaderSource(shader, source);
		gl.compileShader(shader);

		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			const info = gl.getShaderInfoLog(shader);
			gl.deleteShader(shader);
			throw new Error(`Shader compilation failed: ${info}`);
		}

		return shader;
	}

	/**
	 * Create shader program
	 */
	function createProgram(
		gl: WebGL2RenderingContext,
		vertexShader: WebGLShader,
		fragmentShader: WebGLShader
	): WebGLProgram {
		const program = gl.createProgram();
		if (!program) throw new Error('Failed to create program');

		gl.attachShader(program, vertexShader);
		gl.attachShader(program, fragmentShader);
		gl.linkProgram(program);

		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			const info = gl.getProgramInfoLog(program);
			gl.deleteProgram(program);
			throw new Error(`Program linking failed: ${info}`);
		}

		return program;
	}

	/**
	 * Initialize the overlay canvas and WebGL context
	 */
	function initialize(options: OverlayConfig = {}): boolean {
		if (!browser) return false;

		config = { ...DEFAULT_OVERLAY_CONFIG, ...options };

		try {
			// Create overlay canvas
			canvas = document.createElement('canvas');
			canvas.id = 'pixelwise-overlay';
			canvas.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: ${config.zIndex};
        ${config.debug ? 'outline: 2px solid red;' : ''}
      `;

			// Get WebGL2 context
			const gl = canvas.getContext('webgl2', {
				alpha: true,
				premultipliedAlpha: false,
				antialias: false,
				preserveDrawingBuffer: false
			});

			if (!gl) {
				throw new Error('WebGL2 not supported');
			}

			// Create shaders
			const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
			const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
			const program = createProgram(gl, vertexShader, fragmentShader);

			// Clean up shaders (they're now part of the program)
			gl.deleteShader(vertexShader);
			gl.deleteShader(fragmentShader);

			// Get attribute and uniform locations
			const positionLocation = gl.getAttribLocation(program, 'a_position');
			const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
			const textureLocation = gl.getUniformLocation(program, 'u_texture');

			if (textureLocation === null) {
				throw new Error('Failed to get uniform location');
			}

			// Create position buffer (full-screen quad)
			const positionBuffer = gl.createBuffer();
			if (!positionBuffer) throw new Error('Failed to create position buffer');
			gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
			gl.bufferData(
				gl.ARRAY_BUFFER,
				new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
				gl.STATIC_DRAW
			);

			// Create texture coordinate buffer
			const texCoordBuffer = gl.createBuffer();
			if (!texCoordBuffer) throw new Error('Failed to create texCoord buffer');
			gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
			gl.bufferData(
				gl.ARRAY_BUFFER,
				new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
				gl.STATIC_DRAW
			);

			// Create texture
			const texture = gl.createTexture();
			if (!texture) throw new Error('Failed to create texture');

			glState = {
				gl,
				program,
				positionBuffer,
				texCoordBuffer,
				texture,
				positionLocation,
				texCoordLocation,
				textureLocation
			};

			// Add canvas to DOM
			document.body.appendChild(canvas);

			// Initial resize
			resize();

			// Listen for window resize
			window.addEventListener('resize', resize);

			return true;
		} catch (err) {
			console.error('OverlayCompositor initialization failed:', err);
			destroy();
			return false;
		}
	}

	/**
	 * Resize canvas to match viewport
	 */
	function resize() {
		if (!canvas || !glState) return;

		const dpr = window.devicePixelRatio || 1;
		const width = window.innerWidth;
		const height = window.innerHeight;

		canvas.width = width * dpr;
		canvas.height = height * dpr;
		canvas.style.width = `${width}px`;
		canvas.style.height = `${height}px`;

		glState.gl.viewport(0, 0, canvas.width, canvas.height);
	}

	/**
	 * Update the overlay texture with new adjusted pixels
	 */
	function updateTexture(pixels: Uint8ClampedArray, width: number, height: number) {
		if (!glState) return;

		const { gl, texture } = glState;

		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

		// Set texture parameters
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	}

	/**
	 * Render the overlay
	 */
	function render() {
		if (!glState || !canvas) return;

		const { gl, program, positionBuffer, texCoordBuffer, texture, positionLocation, texCoordLocation, textureLocation } = glState;

		// Clear
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		// Enable blending
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

		// Use program
		gl.useProgram(program);

		// Bind position attribute
		gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
		gl.enableVertexAttribArray(positionLocation);
		gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

		// Bind texCoord attribute
		gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
		gl.enableVertexAttribArray(texCoordLocation);
		gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

		// Bind texture
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.uniform1i(textureLocation, 0);

		// Draw
		gl.drawArrays(gl.TRIANGLES, 0, 6);
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
		if (!glState) return;

		const { gl } = glState;
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
	}

	/**
	 * Cleanup resources
	 */
	function destroy() {
		window.removeEventListener('resize', resize);

		if (glState) {
			const { gl, program, positionBuffer, texCoordBuffer, texture } = glState;
			gl.deleteBuffer(positionBuffer);
			gl.deleteBuffer(texCoordBuffer);
			gl.deleteTexture(texture);
			gl.deleteProgram(program);
		}

		if (canvas && canvas.parentNode) {
			canvas.parentNode.removeChild(canvas);
		}

		canvas = null;
		glState = null;
	}

	return {
		initialize,
		resize,
		updateTexture,
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

export type OverlayCompositor = ReturnType<typeof createOverlayCompositor>;
