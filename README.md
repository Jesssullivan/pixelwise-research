
ESDT-based WCAG contrast computation research implementation in Futhark targeting WebGPU.

Pixelwise originally used precomputed WGSL shaders for GPU contrast computation with
Futhark WASM multicore as the reference implementation. I am now working toward
a unified Futhark WebGPU backend that generates both GPU (WebGPU/WGSL) and CPU
(WASM multicore) code from a single source.

**Foundation**: [Sebastian Paarmann's MSc Thesis (2024)](https://futhark-lang.org/student-projects/sebastian-msc-thesis.pdf)
introduced the Futhark WebGPU backend as part of his research at DIKU.

**Current Status**: Experimental fork at [jesssullivan/futhark](https://github.com/jesssullivan/futhark)
(branch `development-webgpu`) with Emscripten 4.x compatibility patches.

**Open Questions for Futhark Upstream**:

1. **Mainlining**: PR #2140 is substantial (~9,800 insertions). Options include:
   - Mainline into diku-dk/futhark (requires review bandwidth)
   - Maintain as external fork (faster iteration, fragmentation risk)
   - Hybrid: core backend upstream, JS/TS tooling external

2. **Emscripten API**: Emscripten 4.x replaced `-sUSE_WEBGPU` with `--use-port=emdawnwebgpu`,
   requiring ~20 Dawn C API signature updates in the RTS.

3. **TypeScript Transpiler**: TypeScript source improves DX but adds:
   - Build toolchain complexity (`tsc` integrated into Haskell build)
   - npm ecosystem dependency for type definitions
   - Distribution questions for generated JS

See [RFC: WebGPU Backend Distribution Strategy](https://github.com/jesssullivan/futhark/issues/1).


## Todos

- [ ] publish pixelwise.ephemera.xoxd.ai live demo
- [ ] publish screenshots
- [ ] update readme and docs with entrypoints and more useful info for playing with the compositor
- [ ] Improve upon transparency handling and floatingUI integration
  - Current approach buffers absolute XYZ values; consider 3 dimensional scanning instead of frame buffer
- [ ] Improve memory management; add greedy viewport offloading
- [ ] Maybe lace up with outbot harness when continuing research
- [ ] Add multiarch gpu demos


---


See the [research paper](tex_research/pixelwise/dist/pixelwise.pdf) for mathematical foundations
(Theorem 2.4 - offset vectors) and WCAG 2.1 contrast formulas.

For WCAG contrast enhancement, we need to sample background colors *outward* from text.
With only `d²`, you need a separate gradient computation pass (Sobel filter, finite differences).

### The ESDT Solution: Track Offset Vectors

Instead of storing `d² = Δx² + Δy²`, ESDT stores the offset vector `(Δx, Δy)` directly.

**What you get for free:**
- **Distance**: `d = sqrt(Δx² + Δy²)` — same as before
- **Gradient direction**: `(Δx, Δy) / d` — the direction to the nearest edge
- **Background sampling**: Follow the gradient outward to find background pixels

This eliminates one pipeline pass and provides mathematically correct gradients.

Anti-aliased fonts produce "gray pixels" at edges where opacity `L ∈ (0, 1)` encodes
sub-pixel edge position. A common mistake is to add the gray offset as:

```
d² = x² + y² + (L - 0.5)²    // WRONG: This is 3D distance!
```

This treats opacity as a third spatial dimension. Instead, ESDT applies the offset
*along* the 2D gradient direction during initialization:

```
offset = L - 0.5
(Δx, Δy) = (offset × gx, offset × gy)  // where (gx, gy) is normalized gradient
```


### References

- **Danielsson (1980)** - Original vector distance transform concept
- **Meijster et al. (2000)** - Linear-time separable algorithm
- **Wittens (2023)** - Subpixel extension for anti-aliased fonts

---

## Core Algorithm

Pixelwise implements the **Exact Signed Distance Transform (ESDT)** with offset vectors,
computing `(Δx, Δy)` to the nearest edge for each pixel. This provides both distance
(`√(Δx² + Δy²)`) and gradient direction (`(Δx, Δy)/d`) without a separate Sobel pass.

See the [research paper](tex_research/pixelwise/dist/pixelwise.pdf) for mathematical
foundations (Theorem 2.4) and WCAG 2.1 contrast formulas.

---

## Architecture

### Backend Priority

The system uses a unified Futhark backend with automatic fallback:

```
1. Futhark WebGPU (GPU)   → Fastest, requires GPU adapter + WebGPU browser
2. Futhark WASM (CPU)     → Multicore, requires COOP/COEP headers
3. JavaScript Fallback    → Single-threaded, always works
```

**Unified Backend:** The ESDT pipeline is generated from a single Futhark source
(`futhark/pipeline.fut`) that compiles to both WebGPU (WGSL) and WASM multicore backends.
This ensures algorithmic equivalence between GPU and CPU paths.

### 6-Pass Pipeline

```
Pass 1: Grayscale → Sobel gradient computation
Pass 2: ESDT X-pass (horizontal propagation, O(w) per row)
Pass 3: ESDT Y-pass (vertical propagation, O(h) per column)
Pass 4: Glyph extraction (distance < threshold)
Pass 5: Background sampling (outward along ∇d)
Pass 6: WCAG contrast check + luminance adjustment
```


## Build System

### Quick Start

```bash
nix develop          # Enter environment (includes Futhark, Emscripten, Node 22)
pnpm install         # Install dependencies
just dev             # Start server at localhost:5175 (with COOP/COEP headers)
```

### Commands

| Command | Description |
|---------|-------------|
| `just dev` | Start dev server (port 5175, rebuilds PDF on start) |
| `just test-quick` | Run vitest directly (fast iteration) |
| `just test` | Run all tests via Bazel |
| `just futhark-rebuild` | Rebuild Futhark WASM modules |
| `just tex` | Compile research paper PDF |
| `just build` | Full Bazel build |

### Futhark WASM Compilation

```bash
# Direct compilation
futhark wasm-multicore --library futhark/esdt.fut -o futhark/esdt

# Via make (recommended)
make -C futhark esdt

# Via just (rebuilds all)
just futhark-rebuild
```

**Generated artifacts:**

| File | Purpose |
|------|---------|
| `esdt.wasm` | Compiled WebAssembly binary (~130KB) |
| `esdt.mjs` | Emscripten runtime (ES module) |
| `esdt.class.js` | FutharkContext wrapper (JavaScript API) |

**Note:** Futhark WASM multicore requires COOP/COEP headers for `SharedArrayBuffer`.
These are configured in `vite.config.ts` and applied automatically by `just dev`.

---

## Demos

### `/demo/compositor`

Full 6-pass ESDT pipeline with Screen Capture API input. **Requires WebGPU-enabled browser.**

- **Backend:** WebGPU → Futhark WASM → JS fallback
- **Input:** Screen capture via `getDisplayMedia()`
- **Output:** WebGL2 overlay with adjusted pixels

### `/demo/gradient-direction`

ESDT offset vector visualization.

- **Backend:** Futhark WASM (`compute_esdt_2d()`)
- **Output:** Gradient arrows showing `(Δx, Δy)` vectors, distance heatmap

### `/demo/contrast-analysis`

WCAG 2.1 contrast ratio computation.

- **Backend:** Web Worker (TypeScript)
- **Output:** Contrast ratio, AA/AAA compliance status


**Active video capture shaders:**
- `video-capture-esdt.wgsl` — Required for GPUExternalTexture
- `video-capture-esdt-fallback.wgsl` — Firefox fallback

**Key data structures:**
- `DistanceData { delta_x, delta_y, distance }` — 12 bytes
- `GlyphPixel { x, y, coverage, edge_weight, gradient_x, gradient_y }` — 24 bytes

---

## Testing

Tests in `tests/theorem-verification/` verify WCAG formulas and ESDT properties.

```bash
pnpm test tests/theorem-verification/
```

---

## Research Paper

**[pixelwise.pdf](tex_research/pixelwise/dist/pixelwise.pdf)** - Mathematical foundations with verification status.

- Originally developed with Rust SIMD as a project to learn Rust SIMD, maybe @brightbloom could lend a hand with that next time :eyes:
- This project received autonomous assistance with PBT constraining, fuzzing, verification and function composition as well as some GPU integration work performed within **Tinyland** with the xoxd.ai stack as a bit of a dogfooding experiment, which will be coming out of stealth Q3 2026.
- xoxd.ai is hiring.

---

## License

zlib

## Author

Jess Sullivan <jess@sulliwood.org>

Key references:
- Danielsson, P.E. (1980). Euclidean Distance Mapping. CGIP 14(3):227-248.
- Meijster, A. et al. (2000). A General Algorithm for Computing Distance Transforms in Linear Time.
- Wittens, S. (2023). Subpixel Distance Transform. https://acko.net/blog/subpixel-distance-transform/
- Henriksen, T. et al. (2017). Futhark: Purely Functional GPU-Programming. PLDI '17.
- Paarmann, S. (2024). A WebGPU Backend for Futhark. MSc Thesis, DIKU.
