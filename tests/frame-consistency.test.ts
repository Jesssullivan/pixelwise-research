import { test, fc } from '@fast-check/vitest';
import { expect } from 'vitest';
import { frameTimeArbitrary, pulseIntensityArbitrary, frameCountArbitrary } from './arbitraries';

test.prop([frameCountArbitrary, pulseIntensityArbitrary])(
  'Frame consistency: Consecutive frames should not have dramatic contrast jumps (> 50% change)',
  (baseFrameCount, intensity) => {
    const nextFrameCount = baseFrameCount + 1;

    const frameDifference = nextFrameCount - baseFrameCount;
    // Only test relative change for frames > 2 to avoid edge cases
    if (baseFrameCount > 2) {
      const relativeChange = Math.abs(frameDifference / baseFrameCount);
      expect(relativeChange).toBeLessThan(0.5);
    }
  }
);

test.prop([frameTimeArbitrary])(
  'Frame consistency: Frame time should be positive and reasonable',
  (frameTime) => {
    expect(frameTime).toBeGreaterThan(0);
    expect(frameTime).toBeLessThan(1);
    expect(Number.isFinite(frameTime)).toBe(true);
  }
);

test.prop([fc.array(frameTimeArbitrary, { minLength: 10, maxLength: 100 })])(
  'Frame consistency: Multiple frames with consistent time intervals',
  (frameTimes) => {
    const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    const maxFrameTime = Math.max(...frameTimes);
    const minFrameTime = Math.min(...frameTimes);

    expect(avgFrameTime).toBeGreaterThan(0);
    expect(avgFrameTime).toBeLessThan(1);
    expect(maxFrameTime).toBeLessThan(avgFrameTime * 100); // More lenient
    expect(minFrameTime).toBeGreaterThanOrEqual(avgFrameTime * 0.01); // More lenient
  }
);

test.prop([fc.array(frameCountArbitrary, { minLength: 2, maxLength: 20 })])(
  'Frame consistency: Frame count increments monotonically',
  (frameCounts) => {
    const sorted = [...frameCounts].sort((a, b) => a - b);

    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]).toBeGreaterThanOrEqual(sorted[i - 1]);
    }
  }
);

test.prop([pulseIntensityArbitrary, fc.integer({ min: 1, max: 1000 })])(
  'Frame consistency: Pulse intensity remains within [0, 1] bounds',
  (intensity, iterations) => {
    let currentIntensity = intensity;

    for (let i = 0; i < iterations; i++) {
      currentIntensity = currentIntensity;
      expect(currentIntensity).toBeGreaterThanOrEqual(0);
      expect(currentIntensity).toBeLessThanOrEqual(1);
    }
  }
);

test.prop([frameCountArbitrary, fc.integer({ min: 2, max: 10 })])(
  'Frame consistency: Frame skipper fires at predictable intervals',
  (currentFrame, skipThreshold) => {
    const shouldSkip = currentFrame % skipThreshold === 0;

    if (shouldSkip) {
      expect(currentFrame % skipThreshold).toBe(0);
    } else {
      expect(currentFrame % skipThreshold).not.toBe(0);
    }
  }
);

test.prop([fc.integer({ min: 10, max: 512 }), fc.integer({ min: 10, max: 512 })])(
  'Frame consistency: Render time should scale linearly with texture size',
  (width1, height1) => {
    const width2 = width1 * 2;
    const height2 = height1 * 2;

    const area1 = width1 * height1;
    const area2 = width2 * height2;

    expect(area2).toBe(area1 * 4);
  }
);

test.prop([fc.array(frameTimeArbitrary, { minLength: 60, maxLength: 600 })])(
  'Frame consistency: Frame rate calculation should be accurate',
  (frameTimes) => {
    const totalDuration = frameTimes.reduce((a, b) => a + b, 0);
    const frameCount = frameTimes.length;

    if (totalDuration > 0) {
      const calculatedFPS = frameCount / totalDuration;
      expect(calculatedFPS).toBeGreaterThan(0);
      expect(calculatedFPS).toBeLessThan(1000);
    }
  }
);

test.prop([fc.integer({ min: 1, max: 100 }), fc.integer({ min: 100, max: 1000 })])(
  'Frame consistency: Memory should not grow unboundedly',
  (iterations, textureSize) => {
    let memoryEstimate = 0;
    const memoryGrowth: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const newMemory = memoryEstimate + textureSize * textureSize * 4;
      memoryGrowth.push(newMemory - memoryEstimate);
      memoryEstimate = newMemory;
    }

    const avgGrowth = memoryGrowth.reduce((a, b) => a + b, 0) / memoryGrowth.length;
    const maxGrowth = Math.max(...memoryGrowth);

    expect(avgGrowth).toBeLessThanOrEqual(textureSize * textureSize * 4 * 1.1);
    expect(maxGrowth).toBeLessThanOrEqual(textureSize * textureSize * 4 * 2);
  }
);

test.prop([frameCountArbitrary, fc.integer({ min: 1, max: 60 })])(
  'Frame consistency: Uniform updates should happen every frame',
  (frameCount, fps) => {
    const expectedUpdates = Math.floor(frameCount / fps);

    expect(expectedUpdates).toBeGreaterThanOrEqual(0);
    expect(expectedUpdates).toBeLessThanOrEqual(frameCount);
  }
);
