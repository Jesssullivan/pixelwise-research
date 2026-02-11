# Futhark ESDT Build Makefile
# Kept for Nix CI builds (flake.nix buildPhase uses `make pipeline`)
# For interactive development, use: just --list (all targets mirrored)
# Requires: nix develop (provides futhark + emscripten)

FUTHARK := futhark
# Custom Futhark with WebGPU backend (from PR #2140)
# Build with: cabal install --installdir=$HOME/.local/futhark-webgpu/bin
FUTHARK_WEBGPU := $(HOME)/.local/futhark-webgpu/bin/futhark
SOURCES := esdt.fut wcag.fut pipeline.fut

.PHONY: all clean test test-all wasm esdt pipeline c check serve bench docs watch webgpu webgpu-pipeline clean-webgpu

# Default: build all WASM targets
all: esdt pipeline

# Type check all sources
check:
	$(FUTHARK) check esdt.fut
	$(FUTHARK) check wcag.fut
	$(FUTHARK) check pipeline.fut

# Run built-in tests for all Futhark files
test-all:
	$(FUTHARK) test esdt.fut --backend=c
	$(FUTHARK) test wcag.fut --backend=c
	$(FUTHARK) test pipeline.fut --backend=c

# Run ESDT tests only (backward compat)
test: esdt.fut
	$(FUTHARK) test esdt.fut --backend=c

# Compile ESDT to C (for native testing/benchmarking)
c: esdt.fut
	$(FUTHARK) c esdt.fut -o esdt_c

# Compile ESDT to WASM (uses Nix-provided emscripten)
# --library flag generates ES module-compatible output (no Module.onRuntimeInitialized)
esdt: esdt.fut
	$(FUTHARK) wasm-multicore --library esdt.fut -o esdt

# Compile full pipeline to WASM (PRIMARY TARGET)
# --library flag generates ES module-compatible output
pipeline: pipeline.fut esdt.fut wcag.fut
	$(FUTHARK) wasm-multicore --library pipeline.fut -o pipeline

# Serve test page locally
serve: esdt
	@echo "Serving at http://localhost:8080/test.html"
	python3 -m http.server 8080

# Serve pipeline demo
serve-pipeline: pipeline
	@echo "Serving at http://localhost:8080/pipeline-demo.html"
	python3 -m http.server 8080

# Benchmark
bench: esdt.fut
	$(FUTHARK) bench esdt.fut --backend=c

# Generate documentation
docs:
	$(FUTHARK) doc esdt.fut -o docs
	$(FUTHARK) doc wcag.fut -o docs
	$(FUTHARK) doc pipeline.fut -o docs

# Clean generated files
clean:
	rm -f esdt esdt_c esdt.c esdt.h esdt.wasm esdt.class.js
	rm -f pipeline pipeline.c pipeline.h pipeline.wasm pipeline.class.js
	rm -rf docs/

# Development: watch and rebuild
watch:
	@echo "Watching for changes..."
	@while true; do \
		inotifywait -q -e modify esdt.fut wcag.fut pipeline.fut && \
		echo "Rebuilding..." && \
		make all; \
	done

# Serve all demos from project root
serve-all:
	@echo "Serving at http://localhost:8080/"
	@echo "  Demo index: http://localhost:8080/static/"
	@echo "  Futhark demos: http://localhost:8080/futhark/"
	cd .. && python3 -m http.server 8080

# ============================================================
# WebGPU Backend (Experimental - Futhark PR #2140)
# ============================================================

# Check if custom Futhark WebGPU is available
check-webgpu:
	@if [ ! -x "$(FUTHARK_WEBGPU)" ]; then \
		echo "ERROR: Futhark WebGPU not found at $(FUTHARK_WEBGPU)"; \
		echo ""; \
		echo "To build Futhark with WebGPU support:"; \
		echo "  1. git clone https://github.com/diku-dk/futhark.git ~/git/futhark-webgpu"; \
		echo "  2. cd ~/git/futhark-webgpu"; \
		echo "  3. git fetch origin pull/2140/head:webgpu-pr2140"; \
		echo "  4. git checkout webgpu-pr2140"; \
		echo "  5. cabal build"; \
		echo "  6. cabal install --installdir=\$$HOME/.local/futhark-webgpu/bin"; \
		exit 1; \
	fi
	@echo "Futhark WebGPU: $(shell $(FUTHARK_WEBGPU) --version 2>&1 | head -n1)"

# Compile ESDT to WebGPU (generates .js + .wasm with embedded WGSL)
webgpu: check-webgpu esdt.fut
	$(FUTHARK_WEBGPU) webgpu --library esdt.fut -o esdt-webgpu

# Compile full pipeline to WebGPU (PRIMARY TARGET)
# --library flag generates ES module-compatible output
webgpu-pipeline: check-webgpu pipeline.fut esdt.fut wcag.fut
	$(FUTHARK_WEBGPU) webgpu --library pipeline.fut -o pipeline-webgpu
	@echo "Generated: pipeline-webgpu.js pipeline-webgpu.wasm"
	@echo "Copy to src/lib/futhark-webgpu/ for integration"

# Copy WebGPU outputs to src/lib/futhark-webgpu/
install-webgpu: webgpu-pipeline
	mkdir -p ../src/lib/futhark-webgpu
	cp pipeline-webgpu.js ../src/lib/futhark-webgpu/
	cp pipeline-webgpu.wasm ../src/lib/futhark-webgpu/
	cp pipeline-webgpu.json ../src/lib/futhark-webgpu/
	cp pipeline-webgpu.wrapper.js ../src/lib/futhark-webgpu/
	@# Add ESM export to wrapper.js (generated code uses plain globals)
	@echo '' >> ../src/lib/futhark-webgpu/pipeline-webgpu.wrapper.js
	@echo 'export { FutharkModule, FutharkArray };' >> ../src/lib/futhark-webgpu/pipeline-webgpu.wrapper.js
	@echo "Installed to src/lib/futhark-webgpu/"

# Clean WebGPU generated files
clean-webgpu:
	rm -f esdt-webgpu esdt-webgpu.js esdt-webgpu.wasm
	rm -f pipeline-webgpu pipeline-webgpu.js pipeline-webgpu.wasm

# Run Futhark WebGPU tests (when available)
test-webgpu: check-webgpu esdt.fut
	$(FUTHARK_WEBGPU) test esdt.fut --backend=webgpu

# Benchmark Futhark WebGPU (when available)
bench-webgpu: check-webgpu esdt.fut
	$(FUTHARK_WEBGPU) bench esdt.fut --backend=webgpu
