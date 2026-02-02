import * as fc from 'fast-check';

export const hexColorArbitrary = fc
	.tuple(
		fc.integer({ min: 0, max: 255 }),
		fc.integer({ min: 0, max: 255 }),
		fc.integer({ min: 0, max: 255 })
	)
	.map(([r, g, b]) => `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);

export const pulseIntensityArbitrary = fc.float({
  min: 0,
  max: 1,
  noNaN: true,
});

export const pulseSpeedArbitrary = fc.float({
  min: Math.fround(0.1),
  max: Math.fround(5.0),
  noNaN: true,
});

export const frameCountArbitrary = fc.integer({ min: 0, max: 10000 });

export const wcagLevelArbitrary = fc.constantFrom('AA', 'AAA');

export const pulseModeArbitrary = fc.constantFrom('SINE', 'SAWTOOTH', 'HEARTBEAT', 'RESONANT');

export const imageDataSizeArbitrary = fc.tuple(
  fc.integer({ min: 1, max: 1024 }),
  fc.integer({ min: 1, max: 1024 })
);

// Small size arbitrary for texture tests (avoid large allocations)
export const smallImageDataSizeArbitrary = fc.tuple(
  fc.integer({ min: 1, max: 64 }),
  fc.integer({ min: 1, max: 64 })
);

export const textureUploadArbitrary = smallImageDataSizeArbitrary.map(([width, height]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.floor(Math.random() * 256);
  }
  return new ImageData(data, width, height);
});

export const frameTimeArbitrary = fc.float({
  min: Math.fround(0.001),
  max: Math.fround(0.1),
  noNaN: true,
});

export const contrastRatioArbitrary = fc.float({
  min: 1,
  max: 21,
  noNaN: true,
});

export const backgroundColorArbitrary = hexColorArbitrary.filter((hex) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5 || luminance > 0.7;
});

export const textOnBackgroundArbitrary = fc.tuple(backgroundColorArbitrary, hexColorArbitrary);

export const pulsePhaseArbitrary = fc.float({
  min: 0,
  max: Math.fround(2 * Math.PI),
  noNaN: true,
});

export const multiColorArbitrary = fc.array(hexColorArbitrary, { minLength: 1, maxLength: 10 });

export function calculateContrastRatio(fg: string, bg: string): number {
  const luminance = (hex: string): number => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    const [aR, aG, aB] = [r, g, b].map((c) => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * aR + 0.7152 * aG + 0.0722 * aB;
  };

  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

export const complianceArbitrary = fc.record({
  contrastRatio: contrastRatioArbitrary,
  isAACompliant: fc.boolean(),
  isAAACompliant: fc.boolean(),
  violations: fc.array(
    fc.record({
      frame: frameCountArbitrary,
      contrastRatio: contrastRatioArbitrary,
      wcagLevel: wcagLevelArbitrary,
    })
  ),
});

// ============================================================================
// THEOREM VERIFICATION ARBITRARIES (pixelwise.tex)
// ============================================================================

/**
 * Coverage values [0,1] for edge weight testing
 * Reference: pixelwise.tex Section 4.1
 */
export const coverageArbitrary = fc.float({ min: 0, max: 1, noNaN: true });

/**
 * Grayscale levels for ESDT input
 * Reference: pixelwise.tex Definition 2.3
 */
export const grayscaleLevelArbitrary = fc.float({ min: 0, max: 1, noNaN: true });

/**
 * Offset vector for ESDT verification
 * Reference: pixelwise.tex Theorem 2.4
 */
export const offsetVectorArbitrary = fc.record({
  delta_x: fc.float({ min: -1000, max: 1000, noNaN: true }),
  delta_y: fc.float({ min: -1000, max: 1000, noNaN: true })
});

/**
 * Small grids for ESDT testing (flattened array)
 * Reference: pixelwise.tex Algorithms 1-2
 */
export const smallGridArbitrary = (w: number, h: number) =>
  fc.array(grayscaleLevelArbitrary, { minLength: w * h, maxLength: w * h });

/**
 * Binary grid (0 or 1) for EDT testing
 * Reference: pixelwise.tex Definition 2.1
 */
export const binaryGridArbitrary = (w: number, h: number) =>
  fc.array(fc.constantFrom(0, 1), { minLength: w * h, maxLength: w * h });

/**
 * RGB channel value [0, 255] for WCAG linearization
 * Reference: pixelwise.tex Section 3.1
 */
export const rgbChannelArbitrary = fc.integer({ min: 0, max: 255 });

/**
 * Relative luminance [0, 1] for contrast ratio testing
 * Reference: pixelwise.tex Section 3.1
 */
export const luminanceArbitrary = fc.float({ min: 0, max: 1, noNaN: true });

/**
 * ESDT pixel with offset and coverage
 * Reference: pixelwise.tex Types
 */
export const esdtPixelArbitrary = fc.record({
  deltaX: fc.float({ min: -100, max: 100, noNaN: true }),
  deltaY: fc.float({ min: -100, max: 100, noNaN: true }),
  coverage: coverageArbitrary,
  edgeWeight: fc.float({ min: 0, max: 1, noNaN: true })
});

/**
 * Distance arbitrary for ESDT results
 * Reference: pixelwise.tex Theorem 2.4
 */
export const distanceArbitrary = fc.float({ min: 0, max: 1000, noNaN: true });

/**
 * Angle arbitrary for gradient direction testing
 * Reference: pixelwise.tex Theorem 2.4
 * Note: fast-check requires 32-bit floats, so we use Math.fround()
 */
export const angleArbitrary = fc.float({ min: Math.fround(-Math.PI), max: Math.fround(Math.PI), noNaN: true });
