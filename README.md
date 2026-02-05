
ESDT-based WCAG contrast computation research implementation in Futhark targeting WebGPU.

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


Classical distance transforms store `d²` (squared distance to nearest edge) for each pixel.
This is efficient but loses information: you know *how far* but not *which direction*.

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

### Exact Signed Distance Transform (ESDT)

ESDT computes offset vectors `(Δx, Δy)` to the nearest edge for each pixel.

**Distance:**
```
d = √(Δx² + Δy²)
```

**Gradient (direction to nearest edge):**
```
∇d = (Δx, Δy) / d    when d > ε
```

**Gray pixel initialization** (Definition 2.3 in paper):
```
offset = L - 0.5
```
Where `L ∈ (0, 1)` is pixel opacity. The offset is applied in the Sobel gradient direction.

### WCAG 2.1 Formulas

**sRGB Linearization:**
```
C_lin = C / 12.92                        if C ≤ 0.03928
C_lin = ((C + 0.055) / 1.055)^2.4        otherwise
```

**Relative Luminance:**
```
L = 0.2126·R_lin + 0.7152·G_lin + 0.0722·B_lin
```

**Contrast Ratio:**
```
CR = (L_lighter + 0.05) / (L_darker + 0.05)
```

Bounds: `CR ∈ [1, 21]`. Black/white yields CR ≈ 21.

### Edge Weight

```
w = 4α(1 - α)
```

Where `α = clamp(1 - d/d_max, 0, 1)`. Peaks at `α = 0.5` (glyph boundaries).

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

---

## Build System

### When Builds Run

| Build Type | Trigger | Output |
|------------|---------|--------|
| Futhark WASM | `just futhark-rebuild` or `make -C futhark` | `esdt.wasm`, `esdt.mjs`, `esdt.class.js` |
| TypeScript | `pnpm build` or dev server | `dist/` bundle |
| Research Paper | `just tex` or automatically with `just dev` | `pixelwise.pdf` |
| Full CI | Push to main/master | GitHub Actions workflow |

### Futhark WASM Compilation

The Futhark compiler generates WASM with multicore support:

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
| `esdt.mjs` | Emscripten runtime (ES module, loads WASM + spawns workers) |
| `esdt.class.js` | FutharkContext wrapper (JavaScript API) |

### COOP/COEP Headers (Required for Futhark Multicore)

Futhark's WASM multicore backend uses `SharedArrayBuffer` for parallel execution.
Browsers require Cross-Origin Isolation headers to enable this:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

These are configured in `vite.config.ts` and applied automatically by `just dev`.

**Verification:**
```javascript
// In browser console
console.log(self.crossOriginIsolated);  // Should be true
```

**Without these headers:** Futhark falls back to single-threaded WASM (slower).

### Parallelism Model

Futhark's `wasm-multicore` backend does **NOT** use WASM SIMD (v128 instructions).
Instead, it achieves parallelism through:

1. **Emscripten pthreads** → Web Workers
2. **SharedArrayBuffer** → Zero-copy data sharing between workers
3. **Thread count** → `navigator.hardwareConcurrency`

---

## Development

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

### Feature Detection

The system detects capabilities at runtime (`src/lib/pixelwise/featureDetection.ts`):

| Capability | Detection | Required For |
|------------|-----------|--------------|
| `webgpu` | `navigator.gpu.requestAdapter()` | WebGPU backend |
| `sharedArrayBuffer` | `SharedArrayBuffer` constructor | Futhark multicore |
| `wasmSimd` | v128.const module compilation | Future SIMD optimization |

---

## Demos

### `/demo/compositor`

Full 6-pass ESDT pipeline with Screen Capture API input. **Requires WebGPU-enabled browser.**

- **Backend:** WebGPU → Futhark WASM → JS fallback
- **Input:** Screen capture via `getDisplayMedia()`
- **Processing:** Real ESDT + WCAG contrast adjustment
- **Output:** WebGL2 overlay with adjusted pixels

### `/demo/gradient-direction`

ESDT offset vector visualization.

- **Backend:** Futhark WASM (`compute_esdt_2d()`)
- **Input:** Rasterized text (Canvas 2D)
- **Output:** Gradient arrows showing `(Δx, Δy)` vectors, distance heatmap

### `/demo/contrast-analysis`

WCAG 2.1 contrast ratio computation.

- **Backend:** Web Worker (TypeScript, not Futhark)
- **Input:** Two RGB colors (foreground, background)
- **Output:** Contrast ratio, AA/AAA compliance status


**Active video capture shaders:**
- `video-capture-esdt.wgsl` — Required for GPUExternalTexture
- `video-capture-esdt-fallback.wgsl` — Firefox fallback

**Key data structures:**
- `DistanceData { delta_x, delta_y, distance }` — 12 bytes
- `GlyphPixel { x, y, coverage, edge_weight, gradient_x, gradient_y }` — 24 bytes

---

## Verification

Tests in `tests/theorem-verification/` verify:

- Linearization threshold `0.03928` (not `0.04045`)
- Gamma exponent `2.4` (not `2.5`)
- CR bounds `[1, 21]`
- Edge weight peak at `α = 0.5`
- Offset vector distance/gradient derivation

Run: `pnpm test tests/theorem-verification/`

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
