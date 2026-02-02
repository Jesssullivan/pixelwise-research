import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('TinywebVectors Integration', () => {
  let mockCanvas: HTMLCanvasElement;
  let mockWebGL2Context: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockWebGL2Context = {
      canvas: { width: 800, height: 600 },
      createShader: vi.fn().mockReturnValue({}),
      createProgram: vi.fn().mockReturnValue({}),
      attachShader: vi.fn(),
      shaderSource: vi.fn(),
      compileShader: vi.fn().mockReturnValue(true),
      getShaderParameter: vi.fn().mockReturnValue(true),
      getProgramParameter: vi.fn().mockReturnValue(true),
      linkProgram: vi.fn().mockReturnValue(true),
      getProgramInfoLog: vi.fn().mockReturnValue(''),
      LINK_STATUS: true,
      deleteShader: vi.fn(),
      deleteProgram: vi.fn(),
      deleteTexture: vi.fn(),
      deleteBuffer: vi.fn(),
      createTexture: vi.fn().mockReturnValue({}),
      bindTexture: vi.fn(),
      texImage2D: vi.fn(),
      texParameteri: vi.fn(),
      uniform2f: vi.fn(),
      uniform1f: vi.fn(),
      uniform1i: vi.fn(),
      uniform4f: vi.fn(),
      getUniformLocation: vi.fn().mockReturnValue({}),
      vertexAttribPointer: vi.fn(),
      enableVertexAttribArray: vi.fn(),
      createBuffer: vi.fn().mockReturnValue({}),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      getAttribLocation: vi.fn().mockReturnValue(0),
      useProgram: vi.fn(),
      drawArrays: vi.fn(),
      getError: vi.fn().mockReturnValue(0),
      viewport: vi.fn(),
      clearColor: vi.fn(),
      clear: vi.fn(),
      createVertexArray: vi.fn().mockReturnValue({}),
      bindVertexArray: vi.fn(),
      ARRAY_BUFFER: 0x8892,
      STATIC_DRAW: 0x88E4,
      getAttribLocation: vi.fn().mockReturnValue(0),
      useProgram: vi.fn(),
      drawArrays: vi.fn(),
      getError: vi.fn().mockReturnValue(0),
      viewport: vi.fn(),
      COMPILE_STATUS: 0x8B81,
      VERTEX_SHADER: 0x8B31,
      FRAGMENT_SHADER: 0x8B30,
      ARRAY_BUFFER: 0x8892,
      STATIC_DRAW: 0x88E4,
      TEXTURE_2D: 0x0DE1,
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      LINEAR: 0x2601,
      CLAMP_TO_EDGE: 0x812F,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      TRIANGLES: 0x0004,
    };

    mockCanvas = {
      getContext: vi.fn().mockReturnValue(mockWebGL2Context),
      width: 800,
      height: 600,
      querySelector: vi.fn().mockReturnValue(null),
    } as any;

    global.document = {
      createElement: vi.fn().mockReturnValue(mockCanvas),
      querySelector: vi.fn().mockReturnValue(mockCanvas),
    } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should instantiate PulsingEngine', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    const engine = new PulsingEngine({
      canvas: mockCanvas,
      textColor: '#ffffff',
    });

    expect(engine).toBeDefined();
    expect(engine.gl).toBeNull(); // gl is null until initialize() is called
  });

  it('should not throw when instantiating PulsingEngine', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    expect(() => {
      new PulsingEngine({
        canvas: mockCanvas,
        textColor: '#ffffff',
      });
    }).not.toThrow();
  });

  it('should destroy PulsingEngine on cleanup', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    const engine = new PulsingEngine({
      canvas: mockCanvas,
      textColor: '#ffffff',
    });
    engine.initialize();
    engine.destroy();

    expect(mockWebGL2Context.deleteProgram).toHaveBeenCalled();
    expect(engine.gl).not.toBeNull(); // gl reference is kept, isInitialized is false
  });

  it('should update engine state', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    const engine = new PulsingEngine({
      canvas: mockCanvas,
      textColor: '#ffffff',
    });

    const state = {
      time: performance.now(),
      blobVelocity: 0,
      blobColors: [],
      blobPositions: [],
    };

    expect(() => {
      engine.updateState(state);
    }).not.toThrow();
  });

  it('should maintain WCAG compliance metrics', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    const engine = new PulsingEngine({
      canvas: mockCanvas,
      textColor: '#ffffff',
      wcagLevel: 'AA',
    });

    const metrics = engine.getComplianceMetrics();

    expect(metrics).toHaveProperty('wcagLevel', 'AA');
    expect(metrics).toHaveProperty('isCompliant', true);
    expect(metrics).toHaveProperty('pulseMode', 'SINE');
    expect(metrics).toHaveProperty('minContrast', 4.5);
  });

  it('should start and stop animation loop', async () => {
    const { PulsingEngine } = await import('virtual:pixelwise-pulsing');

    const engine = new PulsingEngine({
      canvas: mockCanvas,
      textColor: '#ffffff',
    });

    // Test that we can start and stop animation
    expect(() => {
      engine.start();
      engine.stop();
    }).not.toThrow();
  });
});
