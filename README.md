# Pixelwise Research

ESDT-based WCAG contrast enhancement - a research implementation.

This is **NOT a product**. It's a body of research with algorithm-verifiable, mathematically grounded code.

## Research Paper

**[Download PDF](tex_research/pixelwise/dist/pixelwise.pdf)** - Full mathematical foundations including:

- Section 2: ESDT for anti-aliased glyph detection
- Section 3: WCAG contrast formulas
- Section 4: Edge weight function derivation
- Algorithms 1-2: X/Y pass pseudocode

## Quick Start

**Requires Nix with flakes enabled.**

```bash
# Enter reproducible environment
nix develop

# Install dependencies
pnpm install

# Start dev server (builds PDF, enables SharedArrayBuffer)
just dev

# Or build and serve Futhark demo directly
just futhark-rebuild
just futhark-demo
# Open http://localhost:8080/pipeline-demo.html
```

## Justfile Commands

| Command | Description |
|---------|-------------|
| `just dev` | Start dev server (rebuilds PDF, COOP/COEP headers) |
| `just test-quick` | Run vitest directly |
| `just test` | Run all tests via Bazel |
| `just tex` | Build research paper PDF |
| `just futhark-rebuild` | Rebuild Futhark WASM (fast) |
| `just futhark-demo` | Serve Futhark demo page |
| `just build` | Build all targets via Bazel |
| `just info` | Show installed tool versions |

Full list: `just --list`

## Algorithm Verification

| Theorem (pixelwise.tex) | Implementation | Test |
|-------------------------|----------------|------|
| **Def 2.1** (EDT) | `esdt.fut:25` squared_distance | `tests/theorem-verification/edt.test.ts` |
| **Def 2.3** (Gray Offset) | `esdt.fut:76` offset = L - 0.5 | `tests/theorem-verification/gray-offset.test.ts` |
| **Thm 2.4** (Offset Vectors) | `esdt.fut:33` gradient | `tests/theorem-verification/offset-vectors.test.ts` |
| **Sec 4.1** (Edge Weight) | `esdt.fut:224` 4*alpha*(1-alpha) | `tests/theorem-verification/edge-weight.test.ts` |
| **Alg 1-2** (ESDT Passes) | `esdt.fut:82-130` X/Y passes | `tests/theorem-verification/esdt-passes.test.ts` |
| **Sec 3.1** (WCAG) | `wcag.fut:23-48` linearization + CR | `tests/theorem-verification/wcag-linearization.test.ts` |

Run verification tests:
```bash
pnpm test tests/theorem-verification/
```

## 6-Pass Pipeline

```
RGBA Input
    |
    v
Pass 1: Grayscale + Sobel gradient
    |
    v
Pass 2: ESDT X-pass (horizontal distance propagation)
    |
    v
Pass 3: ESDT Y-pass (vertical distance propagation)
    |
    v
Pass 4: Glyph extraction (distance < threshold -> glyph pixel)
    |
    v
Pass 5: Background sampling (outward along gradient direction)
    |
    v
Pass 6: WCAG contrast check + color adjustment
    |
    v
Enhanced RGBA Output
```

## Key Formulas

### Gray Offset (Definition 2.3)
```
offset = L - 0.5
```
Where L is pixel opacity in (0, 1). Edge at L=0.5.

### Edge Weight (Section 4.1)
```
w = 4 * alpha * (1 - alpha)
```
Peaks at alpha=0.5 (glyph boundaries). Inverse kernel density.

### WCAG Contrast Ratio (Section 3.1)
```
CR = (L1 + 0.05) / (L2 + 0.05)
```
Where L1 >= L2 are relative luminances with sRGB gamma correction (threshold 0.03928, gamma 2.4).

## Project Structure

```
pixelwise/
|-- justfile              # Developer commands (just --list)
|-- flake.nix             # Nix environment (futhark + emscripten)
|
|-- futhark/
|   |-- esdt.fut          # ESDT algorithm (Def 2.1, 2.3)
|   |-- wcag.fut          # WCAG calculations (Sec 3.1)
|   |-- pipeline.fut      # Complete 6-pass pipeline
|   |-- test.html         # ESDT-only demo
|   |-- pipeline-demo.html # Full pipeline demo
|   +-- Makefile          # Build targets: esdt, pipeline
|
|-- src/lib/
|   |-- capture/          # Screen Capture API integration
|   |-- core/             # TypeScript core modules
|   |-- composables/      # Svelte 5 composables
|   |-- futhark/          # Futhark WASM re-exports
|   +-- pixelwise/
|       +-- shaders/      # WGSL compute shaders
|
|-- tests/
|   +-- theorem-verification/
|       |-- edt.test.ts
|       |-- gray-offset.test.ts
|       |-- offset-vectors.test.ts
|       |-- edge-weight.test.ts
|       |-- esdt-passes.test.ts
|       +-- wcag-linearization.test.ts
|
+-- tex_research/pixelwise/
    |-- pixelwise.tex     # LaTeX source
    +-- dist/pixelwise.pdf # Built PDF
```

## Browser Requirements

- **WebGPU** (preferred) - Native GPU acceleration via WGSL shaders
- **WebAssembly** with SharedArrayBuffer (fallback for Futhark multicore)
- **Cross-Origin Isolation** (COOP/COEP headers - enabled in `just dev`)

Modern Chrome/Firefox/Safari. WebGPU available in Chrome 113+, Firefox 121+, Safari 18+.

## License

LGPL-3.0-or-later

## Author

Jess Sullivan <jess@sulliwood.org>
