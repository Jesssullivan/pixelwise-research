# Pixelwise Build System
# Developer-friendly commands that delegate to Bazel
#
# Usage: just <recipe>
# List recipes: just --list

set shell := ["bash", "-euo", "pipefail", "-c"]
set dotenv-load := true

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

# Build all container tarballs (via Bazel → nix2container)
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

# === Futhark ===

# Build all Futhark WASM modules (via Bazel)
futhark-build:
    bazel build //futhark:all

# Run Futhark algorithm tests
futhark-test:
    bazel test //futhark:esdt_test //futhark:wcag_test //futhark:pipeline_test

# Serve Futhark demo page (for manual testing)
futhark-demo:
    cd futhark && python3 -m http.server 8080

# Watch and rebuild Futhark on changes
futhark-watch:
    watchexec -w futhark -e fut -- just futhark-build

# Rebuild Futhark WASM directly (bypasses Bazel, useful for quick iteration)
futhark-rebuild:
    cd futhark && make all

# === Research Documentation ===

# Build research PDF directly (latexmk handles multiple passes automatically)
tex:
    #!/usr/bin/env bash
    set -euo pipefail

    TEX_DIR="/home/jsullivan2/git/pixelwise/tex_research/pixelwise"
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
    PDF_PATH="/home/jsullivan2/git/pixelwise/tex_research/pixelwise/dist/pixelwise.pdf"
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

# === Futhark WebGPU ===

# Build custom Futhark from PR #2140 with WebGPU backend
futhark-webgpu-build:
    #!/usr/bin/env bash
    set -euo pipefail

    FUTHARK_DIR="$HOME/git/futhark-webgpu"
    INSTALL_DIR="$HOME/.local/futhark-webgpu/bin"

    if [ ! -d "$FUTHARK_DIR" ]; then
        echo "[futhark-webgpu] Cloning Futhark repository..."
        git clone https://github.com/diku-dk/futhark.git "$FUTHARK_DIR"
    fi

    cd "$FUTHARK_DIR"

    # Ensure we're on the WebGPU branch
    if ! git rev-parse --verify webgpu-pr2140 &>/dev/null; then
        echo "[futhark-webgpu] Fetching PR #2140..."
        git fetch origin pull/2140/head:webgpu-pr2140
    fi

    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [ "$CURRENT_BRANCH" != "webgpu-pr2140" ]; then
        echo "[futhark-webgpu] Checking out webgpu-pr2140..."
        git checkout webgpu-pr2140
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

# Compile Futhark pipeline to WebGPU
futhark-webgpu-compile:
    #!/usr/bin/env bash
    set -euo pipefail

    FUTHARK_WEBGPU="$HOME/.local/futhark-webgpu/bin/futhark"
    OUTPUT_DIR="/home/jsullivan2/git/pixelwise/src/lib/futhark-webgpu"

    if [ ! -x "$FUTHARK_WEBGPU" ]; then
        echo "ERROR: Futhark WebGPU not found at $FUTHARK_WEBGPU"
        echo "Run 'just futhark-webgpu-build' first."
        exit 1
    fi

    echo "[futhark-webgpu] Compiling pipeline to WebGPU..."
    cd /home/jsullivan2/git/pixelwise/futhark
    $FUTHARK_WEBGPU webgpu --library pipeline.fut -o pipeline-webgpu

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
    mkdir -p /home/jsullivan2/git/pixelwise/static/wasm
    cp pipeline-webgpu.wasm /home/jsullivan2/git/pixelwise/static/wasm/


    echo "[futhark-webgpu] Done!"
    echo "Generated files:"
    ls -la "$OUTPUT_DIR/"

# Run Futhark WebGPU correctness tests
test-futhark-webgpu:
    pnpm vitest run tests/futhark-webgpu-equivalence.test.ts

# Run performance benchmarks comparing backends
bench-webgpu:
    pnpm vitest run tests/futhark-webgpu-benchmark.test.ts --reporter=verbose

# Check Futhark WebGPU installation status
futhark-webgpu-check:
    #!/usr/bin/env bash
    FUTHARK_WEBGPU="$HOME/.local/futhark-webgpu/bin/futhark"

    echo "Futhark WebGPU Status"
    echo "====================="
    echo ""

    if [ -x "$FUTHARK_WEBGPU" ]; then
        echo "✓ Futhark WebGPU installed: $FUTHARK_WEBGPU"
        echo "  Version: $($FUTHARK_WEBGPU --version 2>&1 | head -n1)"
        echo ""
        echo "Available backends:"
        $FUTHARK_WEBGPU --help 2>&1 | grep -E "^\s+(c|cuda|opencl|multicore|wasm|wasm-multicore|webgpu)" || true
    else
        echo "✗ Futhark WebGPU not found"
        echo ""
        echo "To install:"
        echo "  just futhark-webgpu-build"
    fi

    echo ""
    echo "Generated WebGPU files:"
    if [ -d "/home/jsullivan2/git/pixelwise/src/lib/futhark-webgpu" ]; then
        ls -la /home/jsullivan2/git/pixelwise/src/lib/futhark-webgpu/ 2>/dev/null || echo "  (empty)"
    else
        echo "  (directory not created yet)"
    fi

# Clean Futhark WebGPU generated files
futhark-webgpu-clean:
    rm -rf /home/jsullivan2/git/pixelwise/src/lib/futhark-webgpu/pipeline-webgpu.*
    rm -f /home/jsullivan2/git/pixelwise/futhark/pipeline-webgpu*
    rm -f /home/jsullivan2/git/pixelwise/futhark/esdt-webgpu*
    echo "Cleaned Futhark WebGPU generated files"
