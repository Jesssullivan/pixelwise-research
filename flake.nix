{
  description = "Pixelwise - Research implementation of Exact Signed Distance Transform for WCAG-compliant text rendering";

  # Attic binary cache configuration
  nixConfig = {
    extra-substituters = [
      "https://nix-cache.fuzzy-dev.tinyland.dev/main"
    ];
    extra-trusted-public-keys = [
      "main:PBDvqG8OP3W2XF4QzuqWwZD/RhLRsE7ONxwM09kqTtw="
    ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    nix2container = {
      url = "github:nlewo/nix2container";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, nix2container }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
        n2c = nix2container.packages.${system}.nix2container;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            # Build system
            bazel_7
            just  # Developer-friendly entrypoint

            # Nix binary cache
            attic-client

            # Futhark compiler (GPU/WASM parallel functional language)
            futhark

            # Emscripten for Futhark WASM compilation
            # CRITICAL: enables `futhark wasm-multicore`
            emscripten

            # Node.js ecosystem (Node 22 for Vite 8 compatibility)
            nodejs_22
            nodePackages.pnpm

            # LaTeX for research documentation
            texlive.combined.scheme-full

            # Development utilities
            watchexec  # File watcher for development
            skopeo     # Container image management
          ];

          shellHook = ''
            echo "Pixelwise Research Environment"
            echo "==============================="
            echo ""
            echo "Tools available:"
            echo "  just      - $(just --version 2>&1 | head -n1)"
            echo "  bazel     - $(bazel --version 2>&1 | head -n1)"
            echo "  futhark   - $(futhark --version 2>&1 | head -n1)"
            echo "  emcc      - $(emcc --version 2>&1 | head -n1 || echo 'checking...')"
            echo "  node      - $(node --version)"
            echo "  pnpm      - $(pnpm --version)"
            echo ""
            echo "Build commands:"
            echo "  just --list                         - List all available commands"
            echo "  just dev                            - Start development server"
            echo "  just build                          - Build all targets"
            echo "  just test                           - Run all tests"
            echo ""

            # Emscripten cache directory (within project)
            export EM_CACHE=$PWD/.emscripten_cache
          '';
        };

        # Development shell with custom Futhark WebGPU backend (PR #2140)
        # Build instructions:
        #   1. Clone: git clone https://github.com/diku-dk/futhark.git ~/git/futhark-webgpu
        #   2. Checkout PR: cd ~/git/futhark-webgpu && git fetch origin pull/2140/head:webgpu-pr2140 && git checkout webgpu-pr2140
        #   3. Build: cabal build && cabal install --installdir=$HOME/.local/futhark-webgpu/bin
        devShells.futhark-webgpu = pkgs.mkShell {
          packages = with pkgs; [
            # Build system
            bazel_7
            just

            # Nix binary cache
            attic-client

            # Emscripten for Futhark WASM compilation
            emscripten

            # Node.js ecosystem
            nodejs_22
            nodePackages.pnpm

            # LaTeX for research documentation
            texlive.combined.scheme-full

            # Development utilities
            watchexec
            skopeo

            # Haskell toolchain for building Futhark from source
            ghc
            cabal-install

            # C libraries needed by Haskell zlib/compression packages
            # (GHC RTS links against these; hsc2hs needs them at runtime)
            zlib
            zstd
            xz
            bzip2
            libffi
            elfutils
            pkg-config
          ];

          shellHook = ''
            echo "Pixelwise Research Environment (Futhark WebGPU)"
            echo "================================================"
            echo ""

            # Check for custom Futhark WebGPU binary
            FUTHARK_WEBGPU="$HOME/.local/futhark-webgpu/bin/futhark"
            if [ -x "$FUTHARK_WEBGPU" ]; then
              export PATH="$HOME/.local/futhark-webgpu/bin:$PATH"
              echo "Using custom Futhark WebGPU: $($FUTHARK_WEBGPU --version 2>&1 | head -n1)"
              echo ""
              echo "WebGPU backend available: $FUTHARK_WEBGPU webgpu --help"
            else
              echo "WARNING: Custom Futhark WebGPU not found at $FUTHARK_WEBGPU"
              echo ""
              echo "To build Futhark with WebGPU support:"
              echo "  1. cd ~/git/futhark-webgpu"
              echo "  2. git fetch origin pull/2140/head:webgpu-pr2140"
              echo "  3. git checkout webgpu-pr2140"
              echo "  4. cabal build"
              echo "  5. cabal install --installdir=$HOME/.local/futhark-webgpu/bin"
              echo ""
            fi

            echo "Tools available:"
            echo "  just      - $(just --version 2>&1 | head -n1)"
            echo "  bazel     - $(bazel --version 2>&1 | head -n1)"
            echo "  emcc      - $(emcc --version 2>&1 | head -n1 || echo 'checking...')"
            echo "  node      - $(node --version)"
            echo "  pnpm      - $(pnpm --version)"
            echo "  ghc       - $(ghc --version 2>&1 | head -n1)"
            echo "  cabal     - $(cabal --version 2>&1 | head -n1)"
            echo ""
            echo "Futhark WebGPU commands:"
            echo "  just futhark-webgpu-build     - Build custom Futhark"
            echo "  just futhark-webgpu-compile   - Compile pipeline to WebGPU"
            echo "  just test-webgpu-equivalence  - Run equivalence tests"
            echo ""

            # Emscripten cache directory (within project)
            export EM_CACHE=$PWD/.emscripten_cache
          '';
        };

        # Package for CI/reproducible builds
        packages.default = pkgs.stdenv.mkDerivation {
          pname = "pixelwise";
          version = "0.1.0";
          src = ./.;

          nativeBuildInputs = with pkgs; [
            nodejs_22
            nodePackages.pnpm
            futhark
            emscripten
          ];

          buildPhase = ''
            export HOME=$TMPDIR
            export EM_CACHE=$TMPDIR/.emscripten_cache
            pnpm install --frozen-lockfile
            cd futhark && make pipeline && cd ..
            pnpm build
          '';

          installPhase = ''
            mkdir -p $out
            cp -r build/* $out/
          '';
        };

        # ================================================================
        # OCI Container Images via nix2container
        # ================================================================

        # Development container with HMR support
        packages.container-dev = n2c.buildImage {
          name = "pixelwise-dev";
          tag = "latest";

          # Layered for optimal caching
          layers = [
            # Layer 1: Runtime (changes rarely)
            (n2c.buildLayer {
              deps = with pkgs; [ nodejs_22 cacert bashInteractive coreutils ];
            })
            # Layer 2: Package manager (changes occasionally)
            (n2c.buildLayer {
              deps = [ pkgs.nodePackages.pnpm ];
            })
          ];

          copyToRoot = pkgs.buildEnv {
            name = "dev-root";
            paths = with pkgs; [
              nodejs_22
              nodePackages.pnpm
              cacert
              bashInteractive
              coreutils
            ];
            pathsToLink = [ "/bin" "/etc" "/lib" ];
          };

          config = {
            Env = [
              "NODE_ENV=development"
              "CONTAINER=1"
              "HMR_PORT=24679"
              "PORT=5175"
              "PATH=/bin:/usr/bin"
            ];
            ExposedPorts = {
              "5175/tcp" = {};
              "24679/tcp" = {};
            };
            WorkingDir = "/app";
            Cmd = [ "${pkgs.nodePackages.pnpm}/bin/pnpm" "run" "dev:container" ];
          };
        };

        # Production container (minimal)
        packages.container-prod = n2c.buildImage {
          name = "pixelwise";
          tag = self.rev or "dev";

          layers = [
            # Layer 1: Minimal Node.js runtime
            (n2c.buildLayer {
              deps = with pkgs; [ nodejs_22 dumb-init cacert ];
            })
            # Layer 2: Application (changes frequently)
            (n2c.buildLayer {
              deps = [ self.packages.${system}.default ];
            })
          ];

          copyToRoot = pkgs.buildEnv {
            name = "prod-root";
            paths = with pkgs; [
              nodejs_22
              dumb-init
              cacert
            ];
            pathsToLink = [ "/bin" "/etc" ];
          };

          config = {
            Env = [
              "NODE_ENV=production"
              "PATH=/bin"
            ];
            ExposedPorts = {
              "3000/tcp" = {};
            };
            WorkingDir = "/app";
            Entrypoint = [ "${pkgs.dumb-init}/bin/dumb-init" "--" ];
            Cmd = [ "${pkgs.nodejs_22}/bin/node" "build/index.js" ];
            User = "1001:1001";
          };
        };

        # Caddy reverse proxy sidecar
        packages.container-caddy = n2c.buildImage {
          name = "pixelwise-caddy";
          tag = "latest";

          copyToRoot = pkgs.buildEnv {
            name = "caddy-root";
            paths = with pkgs; [ caddy cacert ];
            pathsToLink = [ "/bin" "/etc" ];
          };

          config = {
            Env = [
              "SVELTEKIT_HOST=pw-app"
              "SVELTEKIT_PORT=5175"
              "HMR_PORT=24679"
            ];
            ExposedPorts = {
              "8080/tcp" = {};
            };
            Cmd = [ "${pkgs.caddy}/bin/caddy" "run" "--config" "/etc/caddy/Caddyfile" ];
          };
        };

        # Legacy container (backward compatibility)
        packages.container = n2c.buildImage {
          name = "pixelwise-research";
          tag = "latest";
          config = {
            Cmd = [ "${pkgs.nodejs_22}/bin/node" "build" ];
            WorkingDir = "/app";
          };
          copyToRoot = pkgs.buildEnv {
            name = "pixelwise-root";
            paths = [ self.packages.${system}.default ];
            pathsToLink = [ "/" ];
          };
        };

        # All outputs (for cache push)
        packages.all = pkgs.symlinkJoin {
          name = "pixelwise-all";
          paths = [
            self.packages.${system}.default
            self.packages.${system}.container-dev
            self.packages.${system}.container-prod
            self.packages.${system}.container-caddy
          ];
        };
      }
    );
}
