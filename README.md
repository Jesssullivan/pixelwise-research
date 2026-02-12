# Pixelwise

ESDT-based WCAG contrast computation research implementation in Futhark targeting WebGPU.

**[Research Paper (PDF)](tex_research/pixelwise/dist/pixelwise.pdf)** -- Mathematical foundations with verification status.

Pixelwise originally used precomputed WGSL shaders for GPU contrast computation with
Futhark WASM multicore as the reference implementation. I am now working toward
a unified Futhark WebGPU backend that generates both GPU (WebGPU/WGSL) and CPU
(WASM multicore) code from a single source.

**Foundation**: [Sebastian Paarmann's MSc Thesis (2024)](https://futhark-lang.org/student-projects/sebastian-msc-thesis.pdf)
introduced the Futhark WebGPU backend as part of his research at DIKU.

**Current Status**: Experimental fork at [jesssullivan/futhark](https://github.com/jesssullivan/futhark)
(branch `development-webgpu`) with Emscripten 4.x compatibility patches.

---

## Why Offset Vectors Matter

### The Problem with Scalar Distance Transforms

Classical distance transforms store `d^2` (squared distance to nearest edge) for each pixel.
This is efficient but loses information: you know *how far* but not *which direction*.

For WCAG contrast enhancement, we need to sample background colors *outward* from text.
With only `d^2`, you need a separate gradient computation pass (Sobel filter, finite differences).

### The ESDT Solution: Track Offset Vectors

Instead of storing `d^2 = dx^2 + dy^2`, ESDT stores the offset vector `(dx, dy)` directly.

**What you get for free:**
- **Distance**: `d = sqrt(dx^2 + dy^2)` -- same as before
- **Gradient direction**: `(dx, dy) / d` -- the direction to the nearest edge
- **Background sampling**: Follow the gradient outward to find background pixels

This eliminates one pipeline pass and provides mathematically correct gradients.

### Anti-Aliased Text: The Gray Pixel Trap

Anti-aliased fonts produce "gray pixels" at edges where opacity `L in (0, 1)` encodes
sub-pixel edge position. A common mistake is to add the gray offset as:

```
d^2 = x^2 + y^2 + (L - 0.5)^2    // WRONG: This is 3D distance!
```

This treats opacity as a third spatial dimension. Instead, ESDT applies the offset
*along* the 2D gradient direction during initialization:

```
offset = L - 0.5
(dx, dy) = (offset * gx, offset * gy)  // where (gx, gy) is normalized gradient
```

This maintains correct 2D geometry.

### Visual Intuition

```
Traditional EDT (scalar d^2):          ESDT (offset vectors):
+---------------------+               +---------------------------------+
| 9  4  1  0  1  4  9 |               | (-3,0) (-2,0) (-1,0) (0,0) ... |
| 4  1  0  0  0  1  4 |  Only         | (-2,0) (-1,0)  (0,0) (0,0) ... |  Distance
| 1  0  0  0  0  0  1 |  distances    | (-1,0)  (0,0)  (0,0) (0,0) ... |  AND direction
+---------------------+               +---------------------------------+
     v Need Sobel pass                      v Gradient = normalize(dx,dy)
     for gradient                           (no extra pass needed)
```

### Comparison

| Aspect | Scalar d^2 | Offset Vectors (dx, dy) |
|--------|-----------|-------------------------|
| Storage | 1 float | 2 floats |
| Distance | `sqrt(d^2)` | `sqrt(dx^2 + dy^2)` |
| Gradient | Requires Sobel/FD pass | `(dx, dy) / d` (free) |
| Gray pixels | Often incorrect (3D) | Correct 2D displacement |
| Pipeline passes | 7+ | 6 |

---

## Core Algorithm

### Exact Signed Distance Transform (ESDT)

ESDT computes offset vectors `(dx, dy)` to the nearest edge for each pixel.

**Distance:**
```
d = sqrt(dx^2 + dy^2)
```

**Gradient (direction to nearest edge):**
```
grad(d) = (dx, dy) / d    when d > epsilon
```

**Gray pixel initialization** (Definition 2.3 in paper):
```
offset = L - 0.5
```
Where `L in (0, 1)` is pixel opacity. The offset is applied in the Sobel gradient direction.

### WCAG 2.1 Formulas

**sRGB Linearization:**
```
C_lin = C / 12.92                        if C <= 0.03928
C_lin = ((C + 0.055) / 1.055)^2.4        otherwise
```

**Relative Luminance:**
```
L = 0.2126 * R_lin + 0.7152 * G_lin + 0.0722 * B_lin
```

**Contrast Ratio:**
```
CR = (L_lighter + 0.05) / (L_darker + 0.05)
```

Bounds: `CR in [1, 21]`. Black/white yields CR ~ 21.

### Edge Weight

```
w = 4 * alpha * (1 - alpha)
```

Where `alpha = clamp(1 - d/d_max, 0, 1)`. Peaks at `alpha = 0.5` (glyph boundaries).

---

## Architecture

### Backend Priority

```
1. Futhark WebGPU (GPU)   -> Fastest, requires GPU adapter + WebGPU browser
2. Futhark WASM (CPU)     -> Multicore, requires COOP/COEP headers
3. JavaScript Fallback    -> Single-threaded, always works
```

Both GPU and CPU backends are generated from a single Futhark source
(`futhark/pipeline.fut`), ensuring algorithmic equivalence.

### 6-Pass Pipeline

```
Pass 1: Grayscale -> Sobel gradient computation
Pass 2: ESDT X-pass (horizontal propagation, O(w) per row)
Pass 3: ESDT Y-pass (vertical propagation, O(h) per column)
Pass 4: Glyph extraction (distance < threshold)
Pass 5: Background sampling (outward along grad(d))
Pass 6: WCAG contrast check + luminance adjustment
```

### WebGPU Shader Pipeline

When WebGPU is available, a 6-pass GPU compute pipeline is used:

| Pass | Shader | Workgroup | Purpose |
|------|--------|-----------|---------|
| 0 | CPU | - | sRGB -> Linear, grayscale, Sobel |
| 1 | `esdt-x-pass.wgsl` | 256 | Horizontal distance propagation |
| 2 | `esdt-y-pass.wgsl` | 256 | Vertical distance propagation |
| 3 | `esdt-extract-pixels.wgsl` | 8x8 | Glyph pixel extraction |
| 4 | `esdt-background-sample.wgsl` | 256 | Background color sampling |
| 5 | `esdt-contrast-analysis.wgsl` | 256 | WCAG ratio computation |
| 6 | `esdt-color-adjust.wgsl` | 256 | Hue-preserving adjustment |

---

## Quick Start

```bash
nix develop          # Enter environment (includes Futhark, Emscripten, Node 22)
pnpm install         # Install dependencies
just dev             # Start server at localhost:5175 (with COOP/COEP headers)
```

## Commands

### Development

| Command | Description |
|---------|-------------|
| `just dev` | Start dev server (port 5175, rebuilds research PDF on start) |
| `just dev-bazel` | Start dev server via Bazel (full reproducible builds) |
| `just dev-container` | Start dev server in container with HMR |

### Testing

| Command | Description |
|---------|-------------|
| `just test-quick` | Run vitest directly (fast iteration) |
| `just test` | Run all tests via Bazel |
| `just test-unit` | Unit tests only (Bazel) |
| `just test-pbt` | Property-based tests (Bazel) |
| `just test-futhark` | Futhark algorithm tests (Bazel) |
| `just test-wgsl-quick` | WGSL shader tests (pnpm, fast) |
| `just test-e2e` | End-to-end Playwright tests |
| `just check` | TypeScript + Svelte type check |

### Build

| Command | Description |
|---------|-------------|
| `just build` | Build all targets via Bazel |
| `just build-prod` | Production build (release config) |
| `just build-futhark` | Build Futhark WASM modules (Bazel) |
| `just futhark-rebuild` | Rebuild Futhark WASM directly (bypasses Bazel, fast) |

### Futhark

| Command | Description |
|---------|-------------|
| `just futhark-check` | Type check all Futhark sources |
| `just futhark-test-all` | Run Futhark built-in tests (C backend) |
| `just futhark-bench` | Benchmark ESDT (C backend) |
| `just futhark-esdt` | Compile ESDT to WASM multicore |
| `just futhark-pipeline` | Compile pipeline to WASM multicore |
| `just futhark-watch` | Watch and rebuild on changes |

### Futhark WebGPU

| Command | Description |
|---------|-------------|
| `just futhark-webgpu-check` | Check if WebGPU compiler is available |
| `just futhark-webgpu-build` | Build Futhark from source with WebGPU backend |
| `just futhark-webgpu-compile` | Compile pipeline to WebGPU and install |
| `just test-futhark-webgpu` | Run WebGPU equivalence tests |
| `just bench-webgpu` | Benchmark WebGPU vs WASM backends |

### Research Paper

| Command | Description |
|---------|-------------|
| `just tex` | Compile research paper PDF (latexmk) |
| `just docs-watch` | Watch and rebuild paper on changes |
| `just docs-view` | Open the compiled PDF |

### Container & Cache

| Command | Description |
|---------|-------------|
| `just container-build` | Build all container tarballs (Bazel + nix2container) |
| `just container-push` | Push production container to registry |
| `just cache-push` | Push Nix build outputs to Attic cache |
| `just info` | Show build tool versions |

---

## Demos

| Route | Description |
|-------|-------------|
| `/demo/compositor` | Full 6-pass ESDT pipeline with Screen Capture API |
| `/demo/gradient-direction` | ESDT offset vector visualization |
| `/demo/contrast-analysis` | WCAG 2.1 contrast ratio computation |
| `/demo/performance` | Real-time pipeline benchmarks |
| `/demo/before-after` | Side-by-side contrast enhancement comparison |

---

## Key Files

| Path | Purpose |
|------|---------|
| `futhark/esdt.fut` | ESDT algorithm (Def 2.1, 2.3, Thm 2.4) |
| `futhark/wcag.fut` | WCAG formulas (Sec 3.1) |
| `futhark/pipeline.fut` | 6-pass pipeline composition |
| `futhark/Makefile` | WASM build targets |
| `src/lib/core/ComputeDispatcher.ts` | Backend selection + WebGPU pipeline |
| `src/lib/futhark/` | WASM module exports |
| `src/lib/futhark-webgpu/` | Futhark-generated WebGPU pipeline |
| `src/lib/pixelwise/shaders/` | WGSL compute shaders (6 passes) |
| `tests/theorem-verification/` | Property-based tests for formulas |
| `vite.config.ts` | Dev server config, COOP/COEP headers |

---

## Verification

Tests in `tests/theorem-verification/` verify:

- Linearization threshold `0.03928` (not `0.04045`)
- Gamma exponent `2.4` (not `2.5`)
- CR bounds `[1, 21]`
- Edge weight peak at `alpha = 0.5`
- Offset vector distance/gradient derivation

Run: `pnpm test tests/theorem-verification/`

---

## COOP/COEP Headers

Futhark's WASM multicore backend uses `SharedArrayBuffer` for parallel execution.
Browsers require Cross-Origin Isolation headers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

These are configured in `vite.config.ts` (dev), `src/hooks.server.ts` (production),
and nginx ingress annotations (Kubernetes).

---

## Paper

Mathematical foundations with verification status in tex source; not finalized.

Originally developed with Rust SIMD as a project to learn Rust SIMD; this project
received autonomous assistance with PBT constraining, fuzzing, verification and
function composition as well as some GPU integration work performed within **Tinyland**
with the xoxd.ai stack.

## License

zlib

## Author

Jess Sullivan <jess@sulliwood.org>

## Citations

```bibtex
@software{pixelwise2026,
  author = {Sullivan, Jess},
  title = {Pixelwise: ESDT-Based WCAG Contrast Enhancement},
  year = {2026},
  url = {https://github.com/Jesssullivan/pixelwise-research}
}
```

**References**:
- Danielsson, P.E. (1980). Euclidean Distance Mapping. CGIP 14(3):227-248.
- Meijster, A. et al. (2000). A General Algorithm for Computing Distance Transforms in Linear Time.
- Wittens, S. (2023). Subpixel Distance Transform. https://acko.net/blog/subpixel-distance-transform/
- Henriksen, T. et al. (2017). Futhark: Purely Functional GPU-Programming. PLDI '17.
- Paarmann, S. (2024). A WebGPU Backend for Futhark. MSc Thesis, DIKU.
