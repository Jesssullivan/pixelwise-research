import type { Page } from '@playwright/test';

export const BASE_URL = 'http://localhost:9080';

export async function getWebGLContext(page: Page) {
  return await page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-pixelwise]') as HTMLCanvasElement;
    if (!canvas) return null;

    const gl = canvas.getContext('webgl2');
    if (!gl) return null;

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      context: gl,
      renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown',
      vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown',
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    };
  });
}

export async function getFrameTime(page: Page) {
  return await page.evaluate(() => {
    return (window as any).__PIXELWISE_FRAME_TIME__ || 0;
  });
}

export async function getPulsingState(page: Page) {
  return await page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-pixelwise]') as HTMLCanvasElement;
    if (!canvas) return null;

    return {
      width: canvas.width,
      height: canvas.height,
      hasPixelwiseAttr: canvas.hasAttribute('data-pixelwise'),
    };
  });
}

export async function measureFPS(page: Page, durationMs: number = 1000) {
  return await page.evaluate(async (duration) => {
    let frames = 0;
    const startTime = performance.now();

    return new Promise<{ fps: number; frames: number }>((resolve) => {
      function countFrames() {
        frames++;
        const elapsed = performance.now() - startTime;

        if (elapsed < duration) {
          requestAnimationFrame(countFrames);
        } else {
          const fps = (frames / elapsed) * 1000;
          resolve({ fps, frames });
        }
      }

      requestAnimationFrame(countFrames);
    });
  }, durationMs);
}

export async function captureConsoleErrors(page: Page) {
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  return {
    getErrors: () => errors,
    clearErrors: () => errors.splice(0, errors.length),
  };
}

export async function getMemoryUsage(page: Page) {
  return await page.evaluate(() => {
    const memory = (performance as any).memory;
    if (!memory) return null;

    return {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
    };
  });
}

export async function waitForTextureUpload(page: Page, timeoutMs: number = 5000) {
  return await page.evaluate(
    (timeout) => {
      return new Promise<boolean>((resolve) => {
        const startTime = performance.now();

        function checkTexture() {
          const canvas = document.querySelector('canvas[data-pixelwise]') as HTMLCanvasElement;
          if (!canvas) return false;

          const gl = canvas.getContext('webgl2');
          if (!gl) return false;

          const elapsed = performance.now() - startTime;
          if (elapsed < timeout) {
            requestAnimationFrame(checkTexture);
          } else {
            resolve(false);
          }
        }

        requestAnimationFrame(checkTexture);
      });
    },
    timeoutMs
  );
}

export async function triggerTextureUpdate(page: Page) {
  return await page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-pixelwise]') as HTMLCanvasElement;
    if (!canvas) return false;

    const event = new CustomEvent('pixelwise-texture-update', {
      detail: { timestamp: Date.now() },
    });
    canvas.dispatchEvent(event);

    return true;
  });
}
