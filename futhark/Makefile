# Futhark ESDT Build Makefile
# Requires: nix develop (provides futhark + emscripten)

FUTHARK := futhark
SOURCES := esdt.fut wcag.fut pipeline.fut

.PHONY: all clean test test-all wasm esdt pipeline c check serve bench docs watch

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
