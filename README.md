# Pixelwise

ESDT-based WCAG contrast computation research implementation.

## Research Paper

**[pixelwise.pdf](tex_research/pixelwise/dist/pixelwise.pdf)** - Mathematical foundations with verification status.

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

## Pipeline

```
Pass 1: Grayscale → Sobel gradient computation
Pass 2: ESDT X-pass (horizontal propagation, O(w) per row)
Pass 3: ESDT Y-pass (vertical propagation, O(h) per column)
Pass 4: Glyph extraction (distance < threshold)
Pass 5: Background sampling (outward along ∇d)
Pass 6: WCAG contrast check + luminance adjustment
```

## Demos

### `/demo/compositor`

Full 6-pass ESDT pipeline with Screen Capture API input.

- **Input:** Screen capture via `getDisplayMedia()`
- **Processing:** Futhark WASM `compute_esdt_2d()` + contrast adjustment
- **Output:** WebGL2 overlay with adjusted pixels

### `/demo/contrast-analysis`

WCAG 2.1 contrast ratio computation.

- **Input:** Two RGB colors (foreground, background)
- **Output:** Contrast ratio, AA/AAA compliance status
- **Implementation:** TypeScript matching `futhark/wcag.fut`

### `/demo/gradient-direction`

ESDT offset vector visualization.

- **Input:** Rasterized text (canvas)
- **Processing:** `compute_esdt_2d()` from `futhark/esdt.fut`
- **Output:** Gradient arrows showing `(Δx, Δy)` vectors, distance heatmap

## Files

| Path | Contents |
|------|----------|
| `futhark/esdt.fut` | ESDT algorithm (Def 2.1, 2.3, Thm 2.4) |
| `futhark/wcag.fut` | WCAG formulas (Sec 3.1) |
| `futhark/pipeline.fut` | 6-pass pipeline composition |
| `tests/theorem-verification/` | PBT tests for formulas |
| `src/lib/futhark/` | WASM module exports |

## Build

```bash
nix develop          # Enter environment
pnpm install         # Install dependencies
just dev             # Start server (rebuilds PDF)
just test-quick      # Run vitest
just futhark-rebuild # Rebuild WASM
```

## Verification

Tests in `tests/theorem-verification/` verify:

- Linearization threshold `0.03928` (not `0.04045`)
- Gamma exponent `2.4` (not `2.5`)
- CR bounds `[1, 21]`
- Edge weight peak at `α = 0.5`

Run: `pnpm test tests/theorem-verification/`

## License

LGPL-3.0-or-later

## Author

Jess Sullivan <jess@sulliwood.org>
