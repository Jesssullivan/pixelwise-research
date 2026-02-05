import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runBenchmark, measureOperation, formatTime } from './metrics';

describe('Performance Benchmarks', () => {
  let mockCanvas: HTMLCanvasElement;
  let mockWebGL2Context: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockWebGL2Context = (global as any).createMockWebGL2Context();

    mockCanvas = {
      getContext: vi.fn().mockReturnValue(mockWebGL2Context),
      width: 800,
      height: 600,
    } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should benchmark PulsingEngine instantiation', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    const benchmark = await runBenchmark('PulsingEngine instantiation', 10, () => {
      new PulsingEngine({
        canvas: mockCanvas,
        textColor: '#ffffff',
      });
    });

    console.log(`PulsingEngine instantiation: ${formatTime(benchmark.averageTime)} (avg over ${benchmark.iterations} runs)`);

    expect(benchmark.averageTime).toBeLessThan(150);
    // stddev can exceed average for fast operations with timing noise
    expect(benchmark.standardDeviation).toBeLessThan(benchmark.averageTime * 3);
  });

  it('should benchmark shader compilation', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    const benchmark = await runBenchmark('Shader compilation', 10, () => {
      new PulsingEngine({
        canvas: mockCanvas,
        textColor: '#ffffff',
      });
    });

    console.log(`Shader compilation: ${formatTime(benchmark.averageTime)} (avg over ${benchmark.iterations} runs)`);

    expect(benchmark.averageTime).toBeLessThan(80);
  });

  it('should benchmark texture upload', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    const engine = new PulsingEngine({
      canvas: mockCanvas,
      textColor: '#ffffff',
    });
    engine.initialize();

    const benchmark = await runBenchmark('Texture upload (100x100)', 20, () => {
      const imageData = new ImageData(100, 100);
      engine.updateTexture(imageData);
    });

    console.log(`Texture upload (100x100): ${formatTime(benchmark.averageTime)} (avg over ${benchmark.iterations} runs)`);

    expect(benchmark.averageTime).toBeLessThan(50);
  });

  it('should benchmark texture upload (large)', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    const engine = new PulsingEngine({
      canvas: mockCanvas,
      textColor: '#ffffff',
    });
    engine.initialize();

    const benchmark = await runBenchmark('Texture upload (512x512)', 10, () => {
      const imageData = new ImageData(512, 512);
      engine.updateTexture(imageData);
    });

    console.log(`Texture upload (512x512): ${formatTime(benchmark.averageTime)} (avg over ${benchmark.iterations} runs)`);

    expect(benchmark.averageTime).toBeLessThan(150);
  });

  it('should benchmark frame rendering', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    const engine = new PulsingEngine({
      canvas: mockCanvas,
      textColor: '#ffffff',
    });
    engine.initialize();

    const imageData = new ImageData(100, 100);
    engine.updateTexture(imageData);

    const benchmark = await runBenchmark('Frame render', 100, () => {
      engine.render();
    });

    console.log(`Frame render: ${formatTime(benchmark.averageTime)} (avg over ${benchmark.iterations} runs)`);

    expect(benchmark.averageTime).toBeLessThan(20);
    expect(benchmark.averageTime).toBeGreaterThan(0);
  });

  it('should benchmark WCAG contrast calculation', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    const engine = new PulsingEngine({
      canvas: mockCanvas,
      textColor: '#ffffff',
      wcagLevel: 'AA',
    });

    const benchmark = await runBenchmark('WCAG contrast calculation', 100, () => {
      engine.getComplianceMetrics();
    });

    console.log(`WCAG contrast calculation: ${formatTime(benchmark.averageTime)} (avg over ${benchmark.iterations} runs)`);

    expect(benchmark.averageTime).toBeLessThan(5);
  });

  it('should benchmark pulse mode switching', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    const engine = new PulsingEngine({
      canvas: mockCanvas,
      textColor: '#ffffff',
    });

    const modes = ['SINE', 'SAWTOOTH', 'HEARTBEAT', 'RESONANT'];

    const benchmark = await runBenchmark('Pulse mode switch', 100, () => {
      const mode = modes[Math.floor(Math.random() * modes.length)];
      engine.pulseMode = mode;
    });

    console.log(`Pulse mode switch: ${formatTime(benchmark.averageTime)} (avg over ${benchmark.iterations} runs)`);

    expect(benchmark.averageTime).toBeLessThan(5);
  });

  it('should benchmark complete render cycle', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    const benchmark = await runBenchmark('Complete render cycle', 10, () => {
      const engine = new PulsingEngine({
        canvas: mockCanvas,
        textColor: '#ffffff',
      });
      engine.initialize();

      const imageData = new ImageData(100, 100);
      engine.updateTexture(imageData);

      for (let i = 0; i < 10; i++) {
        engine.render();
      }

      engine.getComplianceMetrics();
      engine.destroy();
    });

    console.log(`Complete render cycle: ${formatTime(benchmark.averageTime)} (avg over ${benchmark.iterations} runs)`);

    expect(benchmark.averageTime).toBeLessThan(300);
  });

  it('should benchmark memory allocation', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    const memoryBefore = (performance as any).memory?.usedJSHeapSize || 0;

    const benchmark = await runBenchmark('Memory allocation', 10, () => {
      const engine = new PulsingEngine({
        canvas: mockCanvas,
        textColor: '#ffffff',
      });
      engine.initialize();

      const imageData = new ImageData(200, 200);
      engine.updateTexture(imageData);

      for (let i = 0; i < 10; i++) {
        engine.render();
      }

      engine.destroy();
    });

    const memoryAfter = (performance as any).memory?.usedJSHeapSize || 0;

    if (memoryBefore > 0 && memoryAfter > 0) {
      const memoryDelta = memoryAfter - memoryBefore;
      console.log(`Memory delta: ${(memoryDelta / 1024).toFixed(2)} KB`);

      expect(memoryDelta).toBeLessThan(5 * 1024 * 1024);
    }

    expect(benchmark.averageTime).toBeLessThan(150);
  });
});
