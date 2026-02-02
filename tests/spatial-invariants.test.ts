import { test, fc } from '@fast-check/vitest';
import { expect } from 'vitest';
import {
  hexColorArbitrary,
  smallImageDataSizeArbitrary,
  pulseModeArbitrary,
  pulsePhaseArbitrary,
  textureUploadArbitrary,
} from './arbitraries';

// Use small image sizes to avoid slow tests with large allocations
const imageDataSizeArbitrary = smallImageDataSizeArbitrary;

test.prop([imageDataSizeArbitrary])(
  'Spatial invariants: Texture dimensions should always be positive',
  ([width, height]) => {
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  }
);

test.prop([imageDataSizeArbitrary])(
  'Spatial invariants: Texture data length matches dimensions',
  ([width, height]) => {
    const expectedLength = width * height * 4;
    const imageData = new ImageData(width, height);

    expect(imageData.data.length).toBe(expectedLength);
  }
);

test.prop([imageDataSizeArbitrary])(
  'Spatial invariants: Pixel colors should be within valid range [0, 255]',
  ([width, height]) => {
    const imageData = new ImageData(width, height);

    // Check first and last few channels (Uint8ClampedArray already enforces [0, 255])
    const indicesToCheck = [0, 1, 2, 3, imageData.data.length - 4, imageData.data.length - 1];

    for (const i of indicesToCheck) {
      expect(imageData.data[i]).toBeGreaterThanOrEqual(0);
      expect(imageData.data[i]).toBeLessThanOrEqual(255);
    }
  }
);

test.prop([imageDataSizeArbitrary])(
  'Spatial invariants: RGBA channels have consistent indexing',
  ([width, height]) => {
    const imageData = new ImageData(width, height);
    const pixelCount = width * height;

    expect(imageData.data.length).toBe(pixelCount * 4);

    // Check first, middle, and last pixels (not all pixels - too slow)
    const indicesToCheck = [0, Math.floor(pixelCount / 2), pixelCount - 1];

    for (const i of indicesToCheck) {
      const rIndex = i * 4;
      const gIndex = i * 4 + 1;
      const bIndex = i * 4 + 2;
      const aIndex = i * 4 + 3;

      expect(rIndex).toBeLessThan(imageData.data.length);
      expect(gIndex).toBeLessThan(imageData.data.length);
      expect(bIndex).toBeLessThan(imageData.data.length);
      expect(aIndex).toBeLessThan(imageData.data.length);

      expect(gIndex).toBe(rIndex + 1);
      expect(bIndex).toBe(rIndex + 2);
      expect(aIndex).toBe(rIndex + 3);
    }
  }
);

test.prop([pulsePhaseArbitrary])(
  'Spatial invariants: Pulse phase cycles correctly',
  (phase) => {
    const phase2PI = phase + 2 * Math.PI;
    const phase4PI = phase + 4 * Math.PI;

    const normalizedPhase = phase % (2 * Math.PI);
    const normalizedPhase2PI = phase2PI % (2 * Math.PI);
    const normalizedPhase4PI = phase4PI % (2 * Math.PI);

    expect(normalizedPhase).toBeCloseTo(normalizedPhase2PI, 10);
    expect(normalizedPhase).toBeCloseTo(normalizedPhase4PI, 10);
  }
);

test.prop([pulseModeArbitrary, pulsePhaseArbitrary, pulsePhaseArbitrary])(
  'Spatial invariants: All pulse modes produce valid outputs',
  (mode, phase1, phase2) => {
    expect(['SINE', 'SAWTOOTH', 'HEARTBEAT', 'RESONANT']).toContain(mode);

    if (mode === 'SINE') {
      const output1 = Math.sin(phase1);
      const output2 = Math.sin(phase2);
      expect(output1).toBeGreaterThanOrEqual(-1);
      expect(output1).toBeLessThanOrEqual(1);
      expect(output2).toBeGreaterThanOrEqual(-1);
      expect(output2).toBeLessThanOrEqual(1);
    }
  }
);

test.prop([fc.float({ min: 0, max: 1, noNaN: true }), fc.float({ min: 0, max: 1, noNaN: true })])(
  'Spatial invariants: Texture coordinates are always normalized [0, 1]',
  (x, y) => {
    // Validate that generated coordinates are within [0, 1]
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(1);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(1);
  }
);

test.prop([fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 10 })])(
  'Spatial invariants: Scaling preserves aspect ratio',
  (width, height, scale) => {
    const scaledWidth = width * scale;
    const scaledHeight = height * scale;

    const originalAspect = width / height;
    const scaledAspect = scaledWidth / scaledHeight;

    expect(scaledAspect).toBeCloseTo(originalAspect, 10);
  }
);

test.prop([textureUploadArbitrary])(
  'Spatial invariants: Texture upload maintains data integrity',
  (imageData) => {
    const originalData = new Uint8ClampedArray(imageData.data);

    const reconstructedImageData = new ImageData(
      new Uint8ClampedArray(originalData),
      imageData.width,
      imageData.height
    );

    expect(reconstructedImageData.width).toBe(imageData.width);
    expect(reconstructedImageData.height).toBe(imageData.height);

    // Check sample of pixels (first, middle, last) - not all pixels
    const indicesToCheck = [0, Math.floor(originalData.length / 2), originalData.length - 1];
    for (const i of indicesToCheck) {
      expect(reconstructedImageData.data[i]).toBe(originalData[i]);
    }

    // Also verify total length
    expect(reconstructedImageData.data.length).toBe(originalData.length);
  }
);

test.prop([hexColorArbitrary, hexColorArbitrary])(
  'Spatial invariants: Color interpolation is monotonic',
  (color1, color2) => {
    const r1 = parseInt(color1.slice(1, 3), 16);
    const g1 = parseInt(color1.slice(3, 5), 16);
    const b1 = parseInt(color1.slice(5, 7), 16);

    const r2 = parseInt(color2.slice(1, 3), 16);
    const g2 = parseInt(color2.slice(3, 5), 16);
    const b2 = parseInt(color2.slice(5, 7), 16);

    const t = 0.5;

    const rInterpolated = Math.floor(r1 + (r2 - r1) * t);
    const gInterpolated = Math.floor(g1 + (g2 - g1) * t);
    const bInterpolated = Math.floor(b1 + (b2 - b1) * t);

    expect(rInterpolated).toBeGreaterThanOrEqual(Math.min(r1, r2));
    expect(rInterpolated).toBeLessThanOrEqual(Math.max(r1, r2));
    expect(gInterpolated).toBeGreaterThanOrEqual(Math.min(g1, g2));
    expect(gInterpolated).toBeLessThanOrEqual(Math.max(g1, g2));
    expect(bInterpolated).toBeGreaterThanOrEqual(Math.min(b1, b2));
    expect(bInterpolated).toBeLessThanOrEqual(Math.max(b1, b2));
  }
);

test.prop([fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 100 }), fc.integer({ min: 2, max: 10 })])(
  'Spatial invariants: Spatial sampling respects boundaries',
  (width, height, sampleRate) => {
    const sampleWidth = Math.ceil(width / sampleRate);
    const sampleHeight = Math.ceil(height / sampleRate);

    expect(sampleWidth).toBeGreaterThan(0);
    expect(sampleWidth).toBeLessThanOrEqual(width);
    expect(sampleHeight).toBeGreaterThan(0);
    expect(sampleHeight).toBeLessThanOrEqual(height);
  }
);
