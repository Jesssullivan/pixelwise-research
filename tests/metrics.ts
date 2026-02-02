export interface PerformanceMetrics {
  frameTime: number;
  fps: number;
  memoryUsed: number;
  memoryTotal: number;
  textureUploadTime: number;
  renderTime: number;
}

export interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  standardDeviation: number;
}

export function createPerformanceMarker(name: string) {
  const startTime = performance.now();
  return {
    end: () => {
      const endTime = performance.now();
      return {
        name,
        duration: endTime - startTime,
        startTime,
        endTime,
      };
    },
  };
}

export async function measureAsyncOperation<T>(
  name: string,
  operation: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const marker = createPerformanceMarker(name);
  const result = await operation();
  const { duration } = marker.end();
  return { result, duration };
}

export function measureOperation<T>(
  name: string,
  operation: () => T
): { result: T; duration: number } {
  const marker = createPerformanceMarker(name);
  const result = operation();
  const { duration } = marker.end();
  return { result, duration };
}

export async function runBenchmark(
  name: string,
  iterations: number,
  operation: () => void | Promise<void>
): Promise<BenchmarkResult> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const startTime = performance.now();
    const result = operation();

    if (result instanceof Promise) {
      await result;
    }

    const endTime = performance.now();
    times.push(endTime - startTime);
  }

  const totalTime = times.reduce((a, b) => a + b, 0);
  const averageTime = totalTime / iterations;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  const variance = times.reduce((sum, time) => sum + Math.pow(time - averageTime, 2), 0) / iterations;
  const standardDeviation = Math.sqrt(variance);

  return {
    name,
    iterations,
    totalTime,
    averageTime,
    minTime,
    maxTime,
    standardDeviation,
  };
}

export function getMemoryUsage(): PerformanceMetrics['memoryUsed'] {
  const memory = (performance as any).memory;
  return memory ? memory.usedJSHeapSize : 0;
}

export function getFullMemoryInfo(): {
  used: number;
  total: number;
  limit: number;
} {
  const memory = (performance as any).memory;
  if (!memory) {
    return { used: 0, total: 0, limit: 0 };
  }

  return {
    used: memory.usedJSHeapSize,
    total: memory.totalJSHeapSize,
    limit: memory.jsHeapSizeLimit,
  };
}

export async function measureFrameRate(
  durationMs: number,
  callback: () => void
): Promise<{ frames: number; fps: number; averageFrameTime: number }> {
  let frames = 0;
  const startTime = performance.now();

  return new Promise((resolve) => {
    function countFrames() {
      frames++;
      callback();

      const elapsed = performance.now() - startTime;
      if (elapsed < durationMs) {
        requestAnimationFrame(countFrames);
      } else {
        const elapsedTime = performance.now() - startTime;
        const fps = (frames / elapsedTime) * 1000;
        const averageFrameTime = elapsedTime / frames;
        resolve({ frames, fps, averageFrameTime });
      }
    }

    countFrames();
  });
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

export function formatTime(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)} μs`;
  } else if (ms < 1000) {
    return `${ms.toFixed(2)} ms`;
  } else {
    return `${(ms / 1000).toFixed(2)} s`;
  }
}

export function assertPerformanceWithinThreshold(
  actual: number,
  expected: number,
  threshold: number,
  name: string
): void {
  const difference = Math.abs(actual - expected);
  const percentDifference = (difference / expected) * 100;

  if (percentDifference > threshold) {
    throw new Error(
      `${name}: Actual ${actual} exceeds expected ${expected} by ${percentDifference.toFixed(2)}% (threshold: ${threshold}%)`
    );
  }
}
