# Pixelwise Build System
# Developer-friendly commands that delegate to Bazel
#
# Usage: just <recipe>
# List recipes: just --list

set shell := ["bash", "-euo", "pipefail", "-c"]
set dotenv-load := true

# Project root (absolute)
project_root := justfile_directory()

# Futhark source directory
futhark_dir := project_root / "futhark"

# Custom Futhark with WebGPU backend
# Build with: just futhark-webgpu-build
# Or: cabal install --installdir=$HOME/.local/futhark-webgpu/bin
futhark_webgpu := env("FUTHARK_WEBGPU", env("HOME", "/tmp") / ".local/futhark-webgpu/bin/futhark")

# Standard Futhark compiler (from nix shell / PATH)
futhark := "futhark"

# WebGPU output directory (installed into app source tree)
webgpu_output_dir := project_root / "src/lib/futhark-webgpu"

# Futhark source files
futhark_sources := "esdt.fut wcag.fut pipeline.fut"

# Default recipe - show available commands
default:
    @just --list

# === Development ===

# Start development server (direct pnpm - recommended for quick iteration)
# Includes COOP/COEP headers for SharedArrayBuffer (Futhark WASM multicore)
# Regenerates research paper PDF on startup
dev: tex
    pnpm run dev

# Start development server (via Bazel - for full reproducible builds)
dev-bazel:
    bazel run //:dev

# Start development server in container with HMR + COOP/COEP headers
dev-container:
    bazel run //containers:dev

# Run tests (vitest directly - fast iteration)
test-quick:
    pnpm test

# === Build ===

# Build all targets
build:
    bazel build //...

# Build Futhark WASM modules
build-futhark:
    bazel build //futhark:all

# Build SvelteKit application
build-app:
    bazel build //src:app

# Build for production
build-prod:
    bazel build --config=release //...

# === Test ===

# Run all tests
test:
    bazel test //...

# Run unit tests (vitest)
test-unit:
    bazel test //tests:vitest

# Run property-based tests
test-pbt:
    bazel test //tests:vitest_pbt

# Run end-to-end tests (playwright)
test-e2e:
    bazel test //tests:playwright

# Run accessibility tests
test-a11y:
    bazel test //tests:playwright_a11y

# Run Futhark tests
test-futhark:
    bazel test //futhark:tests

# Run fast test suite only (unit + Futhark)
test-fast:
    bazel test //tests:fast //futhark:tests

# Run WGSL shader unit tests
test-wgsl:
    bazel test //tests:vitest_wgsl

# Run WGSL shader tests with pnpm (for quick iteration)
test-wgsl-quick:
    pnpm vitest run tests/wgsl-shader-unit.test.ts

# === Cache (Attic) ===

# Push build outputs to Attic cache
cache-push:
    nix build .#all --json | jq -r '.[].outputs.out' | xargs -r attic push main

# Pull from Attic cache
cache-pull:
    attic use main

# Check Attic cache status
cache-status:
    attic cache info main

# Login to Attic (requires ATTIC_TOKEN env var)
cache-login:
    attic login production https://nix-cache.fuzzy-dev.tinyland.dev "$ATTIC_TOKEN"

# === Container ===

# Build all container tarballs (via Bazel -> nix2container)
container-build:
    bazel build //containers:all

# Load development container into local runtime (podman/docker)
container-load-dev:
    bazel run //containers:load_dev

# Load production container into local runtime
container-load-prod:
    bazel run //containers:load_prod

# Load Caddy sidecar container
container-load-caddy:
    bazel run //containers:load_caddy

# Export dev container tarball (for manual inspection/transfer)
container-export-dev:
    bazel build //containers:pixelwise_dev_tar && \
    echo "Tarball: bazel-bin/external/nix2container_dev/image.tar"

# Export prod container tarball
container-export-prod:
    bazel build //containers:pixelwise_prod_tar && \
    echo "Tarball: bazel-bin/external/nix2container_prod/image.tar"

# Push production container to registry
container-push:
    bazel run //containers:push_prod

# === Nix ===

# Enter Nix development shell
nix-shell:
    nix develop

# Build all Nix outputs
nix-build:
    nix build .#all

# Build Nix container image
nix-container:
    nix build .#container

# Check flake
nix-check:
    nix flake check

# Update flake inputs
nix-update:
    nix flake update

# === Clean ===

# Clean Bazel build artifacts
clean:
    bazel clean

# Deep clean (expunge Bazel cache)
clean-all:
    bazel clean --expunge

# Clean everything (Bazel + node_modules)
clean-deep: clean-all
    rm -rf node_modules .svelte-kit

# === Utilities ===

# Install pnpm dependencies
install:
    pnpm install

# Type check
check:
    pnpm run check

# Format code
fmt:
    pnpm exec prettier --write .

# Lint code
lint:
    pnpm exec eslint .

# Show Bazel dependency graph
graph:
    bazel query 'deps(//...)' --output graph | dot -Tpng > /tmp/deps.png && xdg-open /tmp/deps.png

# Show build info
info:
    @echo "Pixelwise Build System"
    @echo "======================"
    @echo ""
    @bazel version 2>/dev/null || echo "Bazel: not installed"
    @echo "Nix: $(nix --version 2>/dev/null || echo 'not installed')"
    @echo "Node: $(node --version 2>/dev/null || echo 'not installed')"
    @echo "pnpm: $(pnpm --version 2>/dev/null || echo 'not installed')"
    @echo "Futhark: $(futhark --version 2>&1 | head -n1 || echo 'not installed')"
    @echo "Emscripten: $(emcc --version 2>&1 | head -n1 || echo 'not installed')"
    @echo "LaTeX: $(latexmk --version 2>&1 | head -n1 || echo 'not installed')"
    @echo ""
    @echo "Futhark WebGPU: $({{ futhark_webgpu }} --version 2>&1 | head -n1 || echo 'not installed')"

# === Futhark (standard backends) ===

# Build all Futhark WASM modules (via Bazel)
futhark-build:
    bazel build //futhark:all

# Run Futhark algorithm tests
futhark-test:
    bazel test //futhark:esdt_test //futhark:wcag_test //futhark:pipeline_test

# Serve Futhark demo page (for manual testing)
futhark-demo:
    cd {{ futhark_dir }} && python3 -m http.server 8080

# Watch and rebuild Futhark on changes
futhark-watch:
    watchexec -w {{ futhark_dir }} -e fut -- just futhark-build

# Rebuild Futhark WASM directly (bypasses Bazel, useful for quick iteration)
futhark-rebuild:
    cd {{ futhark_dir }} && make all

# Type check all Futhark sources
futhark-check:
    cd {{ futhark_dir }} && {{ futhark }} check esdt.fut && {{ futhark }} check wcag.fut && {{ futhark }} check pipeline.fut

# Run built-in Futhark tests for all source files (C backend)
futhark-test-all:
    cd {{ futhark_dir }} && {{ futhark }} test esdt.fut --backend=c && {{ futhark }} test wcag.fut --backend=c && {{ futhark }} test pipeline.fut --backend=c

# Compile ESDT to C (for native testing/benchmarking)
futhark-c:
    cd {{ futhark_dir }} && {{ futhark }} c esdt.fut -o esdt_c

# Compile ESDT to WASM (uses Nix-provided emscripten)
futhark-esdt:
    cd {{ futhark_dir }} && {{ futhark }} wasm-multicore --library esdt.fut -o esdt

# Compile full pipeline to WASM (PRIMARY TARGET)
futhark-pipeline:
    cd {{ futhark_dir }} && {{ futhark }} wasm-multicore --library pipeline.fut -o pipeline

# Serve Futhark ESDT test page locally
futhark-serve:
    @echo "Serving at http://localhost:8080/test.html"
    cd {{ futhark_dir }} && python3 -m http.server 8080

# Serve pipeline demo
futhark-serve-pipeline:
    @echo "Serving at http://localhost:8080/pipeline-demo.html"
    cd {{ futhark_dir }} && python3 -m http.server 8080

# Benchmark Futhark ESDT (C backend)
futhark-bench:
    cd {{ futhark_dir }} && {{ futhark }} bench esdt.fut --backend=c

# Generate Futhark documentation
futhark-docs:
    cd {{ futhark_dir }} && {{ futhark }} doc esdt.fut -o docs && {{ futhark }} doc wcag.fut -o docs && {{ futhark }} doc pipeline.fut -o docs

# Clean Futhark generated files (WASM + C artifacts)
futhark-clean:
    cd {{ futhark_dir }} && rm -f esdt esdt_c esdt.c esdt.h esdt.wasm esdt.class.js
    cd {{ futhark_dir }} && rm -f pipeline pipeline.c pipeline.h pipeline.wasm pipeline.class.js
    cd {{ futhark_dir }} && rm -rf docs/

# Watch Futhark sources and rebuild on changes
futhark-watch-rebuild:
    @echo "Watching for changes in {{ futhark_dir }}..."
    watchexec -w {{ futhark_dir }} -e fut -- just futhark-esdt futhark-pipeline

# Serve all demos from project root
futhark-serve-all:
    @echo "Serving at http://localhost:8080/"
    @echo "  Demo index: http://localhost:8080/static/"
    @echo "  Futhark demos: http://localhost:8080/futhark/"
    cd {{ project_root }} && python3 -m http.server 8080

# === Futhark WebGPU ===

# Check if custom Futhark WebGPU is available
futhark-webgpu-check:
    #!/usr/bin/env bash
    set -euo pipefail
    FUTHARK="{{ futhark_webgpu }}"
    FUTHARK_SRC="${FUTHARK_SRC:-}"

    echo "Futhark WebGPU Status"
    echo "====================="
    echo ""

    if [ -n "$FUTHARK_SRC" ]; then
        echo "Source location: $FUTHARK_SRC"
        echo ""
    fi

    if [ -x "$FUTHARK" ]; then
        echo "Futhark WebGPU installed: $FUTHARK"
        echo "  Version: $($FUTHARK --version 2>&1 | head -n1)"
        echo ""
        echo "Available backends:"
        $FUTHARK --help 2>&1 | grep -E "^\s+(c|cuda|opencl|multicore|wasm|wasm-multicore|webgpu)" || true
    else
        echo "Futhark WebGPU not found at $FUTHARK"
        echo ""
        echo "To install:"
        echo "  1. Enter nix shell: nix develop .#futhark-webgpu"
        echo "  2. Build Futhark: just futhark-webgpu-build"
    fi

    echo ""
    echo "Generated WebGPU files:"
    if [ -d "{{ webgpu_output_dir }}" ]; then
        ls -la {{ webgpu_output_dir }}/ 2>/dev/null || echo "  (empty)"
    else
        echo "  (directory not created yet)"
    fi

# Build custom Futhark from source with WebGPU backend
# Uses FUTHARK_SRC env var (set by nix shell) or defaults to ../futhark
futhark-webgpu-build:
    #!/usr/bin/env bash
    set -euo pipefail

    # Use FUTHARK_SRC from nix shell, or local fork at ../futhark, or ~/git/futhark
    FUTHARK_SRC="${FUTHARK_SRC:-}"
    if [ -z "$FUTHARK_SRC" ]; then
        if [ -d "$(realpath ../futhark 2>/dev/null || echo '')" ]; then
            FUTHARK_SRC="$(realpath ../futhark)"
        else
            FUTHARK_SRC="$HOME/git/futhark"
        fi
    fi
    INSTALL_DIR="$(dirname '{{ futhark_webgpu }}')"

    if [ ! -d "$FUTHARK_SRC" ]; then
        echo "ERROR: Futhark source not found at $FUTHARK_SRC"
        echo ""
        echo "Options:"
        echo "  1. Clone upstream: git clone https://github.com/diku-dk/futhark.git $FUTHARK_SRC"
        echo "  2. Use nix shell: nix develop .#futhark-webgpu (fetches from GitHub)"
        echo "  3. Override input: nix develop .#futhark-webgpu --override-input futhark-webgpu-src path:../futhark"
        exit 1
    fi

    cd "$FUTHARK_SRC"

    # Ensure we're on the webgpu branch (for local repos)
    # Nix-fetched sources are already on the correct branch
    if git rev-parse --git-dir &>/dev/null 2>&1; then
        CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "detached")
        if [ "$CURRENT_BRANCH" != "webgpu" ] && [ "$CURRENT_BRANCH" != "development-webgpu" ] && [ "$CURRENT_BRANCH" != "detached" ]; then
            echo "[futhark-webgpu] Switching to webgpu branch..."
            git checkout webgpu || git checkout development-webgpu
        fi
        echo "[futhark-webgpu] Building from $FUTHARK_SRC (branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'nix-fetched'))"
    else
        echo "[futhark-webgpu] Building from $FUTHARK_SRC (nix-fetched source)"
    fi

    echo "[futhark-webgpu] Building Futhark..."
    cabal build

    echo "[futhark-webgpu] Installing to $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"
    cabal install --installdir="$INSTALL_DIR" --overwrite-policy=always

    echo "[futhark-webgpu] Done!"
    echo "Futhark WebGPU: $($INSTALL_DIR/futhark --version)"
    echo ""
    echo "Verify WebGPU backend:"
    echo "  $INSTALL_DIR/futhark webgpu --help"

# Compile ESDT to WebGPU (generates .js + .wasm with embedded WGSL)
futhark-webgpu-esdt: _require-futhark-webgpu
    cd {{ futhark_dir }} && {{ futhark_webgpu }} webgpu --library esdt.fut -o esdt-webgpu

# Compile full pipeline to WebGPU (PRIMARY TARGET)
futhark-webgpu-pipeline: _require-futhark-webgpu
    cd {{ futhark_dir }} && {{ futhark_webgpu }} webgpu --library pipeline.fut -o pipeline-webgpu
    @echo "Generated: pipeline-webgpu.js pipeline-webgpu.wasm"
    @echo "Run 'just futhark-webgpu-install' to copy to src/lib/futhark-webgpu/"

# Compile pipeline to WebGPU and install into the app source tree
futhark-webgpu-compile: _require-futhark-webgpu
    #!/usr/bin/env bash
    set -euo pipefail

    FUTHARK="{{ futhark_webgpu }}"
    OUTPUT_DIR="{{ webgpu_output_dir }}"

    echo "[futhark-webgpu] Using: $($FUTHARK --version | head -n1)"
    echo "[futhark-webgpu] Compiling pipeline to WebGPU..."
    cd {{ futhark_dir }}
    $FUTHARK webgpu --library pipeline.fut -o pipeline-webgpu

    echo "[futhark-webgpu] Installing to $OUTPUT_DIR..."
    mkdir -p "$OUTPUT_DIR"
    cp pipeline-webgpu.wasm "$OUTPUT_DIR/"

    # Create ESM-compatible version of the Emscripten module
    # The generated file uses CommonJS exports which don't work in browser ESM context
    # We append an ESM export at the end
    cat pipeline-webgpu.js > "$OUTPUT_DIR/pipeline-webgpu.js"
    echo "" >> "$OUTPUT_DIR/pipeline-webgpu.js"
    echo "// ESM export (added by just futhark-webgpu-compile)" >> "$OUTPUT_DIR/pipeline-webgpu.js"
    echo "export default Module;" >> "$OUTPUT_DIR/pipeline-webgpu.js"

    # Also add ESM export to wrapper
    cat pipeline-webgpu.wrapper.js > "$OUTPUT_DIR/pipeline-webgpu.wrapper.js"
    echo "" >> "$OUTPUT_DIR/pipeline-webgpu.wrapper.js"
    echo "// ESM export (added by just futhark-webgpu-compile)" >> "$OUTPUT_DIR/pipeline-webgpu.wrapper.js"
    echo "export { FutharkModule, FutharkArray };" >> "$OUTPUT_DIR/pipeline-webgpu.wrapper.js"

    # Also copy WASM to static for absolute path access
    mkdir -p {{ project_root }}/static/wasm
    cp pipeline-webgpu.wasm {{ project_root }}/static/wasm/

    echo "[futhark-webgpu] Done!"
    echo "Generated files:"
    ls -la "$OUTPUT_DIR/"

# Install WebGPU build outputs into app source tree (from pre-built artifacts in futhark/)
futhark-webgpu-install: futhark-webgpu-pipeline
    #!/usr/bin/env bash
    set -euo pipefail

    OUTPUT_DIR="{{ webgpu_output_dir }}"
    mkdir -p "$OUTPUT_DIR"

    cd {{ futhark_dir }}
    cp pipeline-webgpu.js "$OUTPUT_DIR/"
    cp pipeline-webgpu.wasm "$OUTPUT_DIR/"
    cp pipeline-webgpu.json "$OUTPUT_DIR/"
    cp pipeline-webgpu.wrapper.js "$OUTPUT_DIR/"

    # Add ESM export to wrapper.js (generated code uses plain globals)
    echo '' >> "$OUTPUT_DIR/pipeline-webgpu.wrapper.js"
    echo 'export { FutharkModule, FutharkArray };' >> "$OUTPUT_DIR/pipeline-webgpu.wrapper.js"

    echo "Installed to $OUTPUT_DIR/"

# Run Futhark WebGPU correctness tests
test-futhark-webgpu:
    pnpm vitest run tests/futhark-webgpu-equivalence.test.ts

# Run Futhark WebGPU tests (native futhark test runner, WebGPU backend)
test-futhark-webgpu-native: _require-futhark-webgpu
    cd {{ futhark_dir }} && {{ futhark_webgpu }} test esdt.fut --backend=webgpu

# Run performance benchmarks comparing backends
bench-webgpu:
    pnpm vitest run tests/futhark-webgpu-benchmark.test.ts --reporter=verbose

# Benchmark Futhark WebGPU (native futhark bench runner)
bench-futhark-webgpu: _require-futhark-webgpu
    cd {{ futhark_dir }} && {{ futhark_webgpu }} bench esdt.fut --backend=webgpu

# Clean Futhark WebGPU generated files
futhark-webgpu-clean:
    rm -rf {{ webgpu_output_dir }}/pipeline-webgpu.*
    rm -f {{ futhark_dir }}/pipeline-webgpu*
    rm -f {{ futhark_dir }}/esdt-webgpu*
    echo "Cleaned Futhark WebGPU generated files"

# === Research Documentation ===

# Build research PDF directly (latexmk handles multiple passes automatically)
tex:
    #!/usr/bin/env bash
    set -euo pipefail

    TEX_DIR="{{ project_root }}/tex_research/pixelwise"
    TEX_FILE="pixelwise.tex"
    BUILD_DIR="${TEX_DIR}/build"
    DIST_DIR="${TEX_DIR}/dist"

    # Check for LaTeX tools
    if ! command -v latexmk &> /dev/null; then
        echo "[tex] latexmk not found. Skipping tex compilation."
        echo "[tex] Install via: nix develop, or texlive-full"
        exit 0
    fi

    echo "[tex] Compiling research paper..."

    # Create build and dist directories
    mkdir -p "${BUILD_DIR}" "${DIST_DIR}"

    # Compile with latexmk (handles multiple passes, bibliography, etc.)
    # -pdf: generate PDF
    # -xelatex: use xelatex for better font support
    # -interaction=nonstopmode: don't stop on errors
    # -output-directory: put build artifacts in build/
    # -shell-escape: required for minted package
    cd "${TEX_DIR}" && latexmk -pdf -xelatex \
        -interaction=nonstopmode \
        -output-directory="${BUILD_DIR}" \
        -shell-escape \
        "${TEX_FILE}" 2>&1 | tail -20 || {
            echo "[tex] Warning: LaTeX compilation had issues (check ${BUILD_DIR}/pixelwise.log)"
            # Don't fail the build - dev server should still start
        }

    # Copy PDF to dist if successful
    if [ -f "${BUILD_DIR}/pixelwise.pdf" ]; then
        cp "${BUILD_DIR}/pixelwise.pdf" "${DIST_DIR}/"
        echo "[tex] PDF generated: ${DIST_DIR}/pixelwise.pdf"
    else
        echo "[tex] Warning: PDF not generated"
    fi

# Build research PDF (alias for tex)
docs-build: tex

# Watch and rebuild docs on changes
docs-watch:
    watchexec -w tex_research/pixelwise -e tex -- just tex

# Clean LaTeX build artifacts
docs-clean:
    rm -rf tex_research/pixelwise/build tex_research/pixelwise/dist
    echo "[tex] Build artifacts cleaned"

# View the research PDF
docs-view: tex
    #!/usr/bin/env bash
    PDF_PATH="{{ project_root }}/tex_research/pixelwise/dist/pixelwise.pdf"
    if [ -f "${PDF_PATH}" ]; then
        if command -v xdg-open &> /dev/null; then
            xdg-open "${PDF_PATH}"
        elif command -v open &> /dev/null; then
            open "${PDF_PATH}"
        else
            echo "PDF available at: ${PDF_PATH}"
        fi
    else
        echo "PDF not found. Run 'just tex' first."
    fi

# === Internal helpers ===

# Ensure Futhark WebGPU binary is available (used as dependency)
[private]
_require-futhark-webgpu:
    #!/usr/bin/env bash
    if [ ! -x "{{ futhark_webgpu }}" ]; then
        echo "ERROR: Futhark WebGPU not found at {{ futhark_webgpu }}"
        echo ""
        echo "To build Futhark with WebGPU support:"
        echo "  1. Enter nix shell: nix develop .#futhark-webgpu"
        echo "  2. Build: just futhark-webgpu-build"
        echo ""
        echo "Or set FUTHARK_WEBGPU to the path of your futhark binary."
        exit 1
    fi
    echo "[futhark-webgpu] Using: $({{ futhark_webgpu }} --version 2>&1 | head -n1)"
