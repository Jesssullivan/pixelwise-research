# Archived Shaders

These hand-written WGSL shaders have been replaced by the unified Futhark WebGPU backend (February 2026).

## Why Archived

The ESDT pipeline is now generated from Futhark source code (`futhark/esdt.fut`), which compiles to both:
- WebGPU (WGSL) via `futhark webgpu`
- WASM multicore via `futhark multicore`

This unification provides:
- Single source of truth for the algorithm
- Automatic optimization by Futhark compiler
- Guaranteed equivalence between GPU and CPU backends

## Archived Files

| File | Original Purpose |
|------|------------------|
| `esdt-x-pass.wgsl` | Horizontal distance transform pass |
| `esdt-y-pass.wgsl` | Vertical distance transform pass |
| `esdt-extract-pixels.wgsl` | Text pixel extraction from input |
| `esdt-background-sample.wgsl` | Background color sampling |
| `esdt-contrast-analysis.wgsl` | WCAG contrast ratio calculation |
| `esdt-color-adjust.wgsl` | Final color adjustment pass |
| `esdt-grayscale-gradient.wgsl` | Gradient visualization |
| `compositor.frag` | Fragment shader (orphaned since initial commit) |
| `compositor.vert` | Vertex shader (orphaned since initial commit) |

## Still Active

The following shaders remain in the parent directory:
- `video-capture-esdt.wgsl` - Required for GPUExternalTexture (video capture)
- `video-capture-esdt-fallback.wgsl` - Firefox fallback for video capture

## Reference

See `tex_research/pixelwise/pixelwise.tex` Section 5.2 for historical context on the hand-written shader pipeline.
