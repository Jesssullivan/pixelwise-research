
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

---

## Approach

ESDT (Exact Signed Distance Transform) stores offset vectors `(Δx, Δy)` instead of
scalar distances. This provides gradient direction for free, eliminating one pipeline
pass. See the [research paper](tex_research/pixelwise/dist/pixelwise.pdf) for details
(Theorem 2.4, WCAG 2.1 contrast formulas).

## Architecture

### Backend Priority

```
1. Futhark WebGPU (GPU)   → Fastest, requires GPU adapter + WebGPU browser
2. Futhark WASM (CPU)     → Multicore, requires COOP/COEP headers
3. JavaScript Fallback    → Single-threaded, always works
```

Both GPU and CPU backends are generated from a single Futhark source
(`futhark/pipeline.fut`), ensuring algorithmic equivalence.

### 6-Pass Pipeline

```
Pass 1: Grayscale → Sobel gradient computation
Pass 2: ESDT X-pass (horizontal propagation, O(w) per row)
Pass 3: ESDT Y-pass (vertical propagation, O(h) per column)
Pass 4: Glyph extraction (distance < threshold)
Pass 5: Background sampling (outward along ∇d)
Pass 6: WCAG contrast check + luminance adjustment
```

## Quick Start

```bash
nix develop          # Enter environment (includes Futhark, Emscripten, Node 22)
pnpm install         # Install dependencies
just dev             # Start server at localhost:5175 (with COOP/COEP headers)
```

| Command | Description |
|---------|-------------|
| `just dev` | Start dev server (port 5175, rebuilds PDF on start) |
| `just test-quick` | Run vitest directly (fast iteration) |
| `just test` | Run all tests via Bazel |
| `just futhark-rebuild` | Rebuild Futhark WASM modules |
| `just tex` | Compile research paper PDF |
| `just build` | Full Bazel build |

## Demos

| Route | Description |
|-------|-------------|
| `/demo/compositor` | Full 6-pass ESDT pipeline with Screen Capture API |
| `/demo/gradient-direction` | ESDT offset vector visualization |
| `/demo/contrast-analysis` | WCAG 2.1 contrast ratio computation |
| `/demo/performance` | Real-time pipeline benchmarks |
| `/demo/before-after` | Side-by-side contrast enhancement comparison |

## Testing

```bash
pnpm test                              # All tests
pnpm test tests/theorem-verification/  # WCAG + ESDT property tests
pnpm test tests/compute-dispatcher     # Backend selection + fallback chain
```

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/core/ComputeDispatcher.ts` | Backend selection (WebGPU → WASM → JS) |
| `src/lib/pixelwise/featureDetection.ts` | Capability detection |
| `src/lib/futhark/` | Futhark WASM module wrapper |
| `src/lib/futhark-webgpu/` | Futhark-generated WebGPU pipeline |
| `futhark/*.fut` | Futhark source (ESDT, WCAG algorithms) |
| `vite.config.ts` | Dev server config, COOP/COEP headers |

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

**References**:
- Danielsson, P.E. (1980). Euclidean Distance Mapping. CGIP 14(3):227-248.
- Meijster, A. et al. (2000). A General Algorithm for Computing Distance Transforms in Linear Time.
- Wittens, S. (2023). Subpixel Distance Transform. https://acko.net/blog/subpixel-distance-transform/
- Henriksen, T. et al. (2017). Futhark: Purely Functional GPU-Programming. PLDI '17.
- Paarmann, S. (2024). A WebGPU Backend for Futhark. MSc Thesis, DIKU.
