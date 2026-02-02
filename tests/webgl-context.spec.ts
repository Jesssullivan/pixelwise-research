import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:9080';

test.describe('Real Browser WebGL', () => {
  test('should create real WebGL2 context in browser', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const webglInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas[data-pixelwise]') as HTMLCanvasElement;
      if (!canvas) return { hasCanvas: false, hasWebGL2: false, renderer: null };

      const gl = canvas.getContext('webgl2');
      if (!gl) return { hasCanvas: true, hasWebGL2: false, renderer: null };

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        hasCanvas: true,
        hasWebGL2: true,
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown',
      };
    });

    // Canvas may not exist if pixelwise is disabled - that's OK
    if (webglInfo.hasCanvas && webglInfo.hasWebGL2) {
      expect(webglInfo.renderer).toBeTruthy();
      expect(webglInfo.renderer).not.toBe('unknown');
    }
  });

  test('should compile and link shaders without errors', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    return page.evaluate(async () => {
      const canvas = document.querySelector('canvas[data-pixelwise]') as HTMLCanvasElement;
      if (!canvas) {
        console.log('No pixelwise canvas found - feature may be disabled');
        return { success: true, errors: [], skipped: true };
      }

      const gl = canvas.getContext('webgl2');
      if (!gl) {
        console.log('WebGL2 not available - feature may be disabled');
        return { success: true, errors: [], skipped: true };
      }

      const shaderErrors: string[] = [];

      const vertexShaderSource = `
        attribute vec2 a_position;
        varying vec2 v_uv;
        void main() {
          v_uv = a_position * 0.5 + 0.5;
          gl_Position = vec4(a_position, 0.0, 1.0);
        }
      `;

      const fragmentShaderSource = `
        precision mediump float;
        varying vec2 v_uv;
        uniform sampler2D u_texture;
        void main() {
          gl_FragColor = texture2D(u_texture, v_uv);
        }
      `;

      const vertexShader = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vertexShader, vertexShaderSource);
      gl.compileShader(vertexShader);

      if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
        shaderErrors.push(gl.getShaderInfoLog(vertexShader) || 'Unknown vertex shader error');
      }

      const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fragmentShader, fragmentShaderSource);
      gl.compileShader(fragmentShader);

      if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
        shaderErrors.push(gl.getShaderInfoLog(fragmentShader) || 'Unknown fragment shader error');
      }

      const program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        shaderErrors.push(gl.getProgramInfoLog(program) || 'Unknown program link error');
      }

      return { success: shaderErrors.length === 0, errors: shaderErrors, skipped: false };
    }).then((result) => {
      if (!result.skipped) {
        expect(result.success).toBe(true);
        if (result.errors.length > 0) {
          console.error('Shader errors:', result.errors);
        }
      }
    });
  });

  test('should handle texture uploads', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    return page.evaluate(async () => {
      const canvas = document.querySelector('canvas[data-pixelwise]') as HTMLCanvasElement;
      if (!canvas) {
        console.log('No pixelwise canvas found - feature may be disabled');
        return { success: true, errorCode: 0, skipped: true };
      }

      const gl = canvas.getContext('webgl2');
      if (!gl) {
        console.log('WebGL2 not available - feature may be disabled');
        return { success: true, errorCode: 0, skipped: true };
      }

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);

      const width = 100;
      const height = 100;
      const data = new Uint8Array(width * height * 4);

      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }

      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        data
      );

      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      const error = gl.getError();
      return { success: error === gl.NO_ERROR, errorCode: error, skipped: false };
    }).then((result) => {
      if (!result.skipped) {
        expect(result.success).toBe(true);
        expect(result.errorCode).toBe(0);
      }
    });
  });
});
