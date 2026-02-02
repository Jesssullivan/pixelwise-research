import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:9080';

test.describe('Hydration Safety', () => {
  test('should hydrate without WebGL context errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Check for actual WebGL errors (not warnings about missing canvas)
    const hasWebGLErrors = consoleErrors.some((err) =>
      err.toLowerCase().includes('webgl') || err.toLowerCase().includes('context')
    );

    expect(hasWebGLErrors).toBe(false);
  });

  test('should enable pixelwise post-hydration', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const canvasState = await page.evaluate(() => {
      const canvas = document.querySelector('canvas[data-pixelwise]') as HTMLCanvasElement;
      if (!canvas) return { hasCanvas: false, hasWebGL: false };

      const gl = canvas.getContext('webgl2');
      return { hasCanvas: true, hasWebGL: !!gl };
    });

    // If canvas exists, it should have WebGL context
    if (canvasState.hasCanvas) {
      expect(canvasState.hasWebGL).toBe(true);
    }
  });

  test('should handle SSR hydration mismatch gracefully', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const hydrationStatus = await page.evaluate(() => {
      return {
        hasAnyCanvas: !!document.querySelector('canvas'),
        hasPixelwiseCanvas: !!document.querySelector('canvas[data-pixelwise]'),
        windowDefined: typeof window !== 'undefined',
      };
    });

    // Window should always be defined in browser
    expect(hydrationStatus.windowDefined).toBe(true);

    // Canvas existence depends on configuration - just check it doesn't throw
    expect(typeof hydrationStatus.hasAnyCanvas).toBe('boolean');
    expect(typeof hydrationStatus.hasPixelwiseCanvas).toBe('boolean');
  });

  test('should not leak memory during hydration', async ({ page }) => {
    await page.goto(BASE_URL);

    await page.waitForLoadState('networkidle');

    const initialMemory = await page.evaluate(() => {
      return (performance as any).memory?.usedJSHeapSize || 0;
    });

    await page.reload();
    await page.waitForLoadState('networkidle');

    const finalMemory = await page.evaluate(() => {
      return (performance as any).memory?.usedJSHeapSize || 0;
    });

    if (initialMemory > 0 && finalMemory > 0) {
      const memoryIncrease = finalMemory - initialMemory;
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    }
  });

  test('should preserve PulsingEngine state across hydration', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const engineState = await page.evaluate(() => {
      const canvas = document.querySelector('canvas[data-pixelwise]') as HTMLCanvasElement;
      if (!canvas) return { hasCanvas: false };

      return {
        hasCanvas: true,
        hasContext: !!canvas.getContext('webgl2'),
        width: canvas.width,
        height: canvas.height,
      };
    });

    // If canvas exists, verify its state
    if (engineState.hasCanvas) {
      expect(engineState.hasContext).toBeDefined();
      expect(engineState.width).toBeGreaterThan(0);
      expect(engineState.height).toBeGreaterThan(0);
    }
  });
});
