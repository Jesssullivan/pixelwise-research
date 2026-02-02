#!/usr/bin/env bash
# Run the development container with proper mounts and ports
# This loads the image and starts it with HMR support
#
# Usage: run_dev.sh [tarball_path]
# If tarball_path is provided, the image is loaded first.
# If running via bazel run, the tarball is in the runfiles.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find the project root (go up from containers/scripts to project root)
# When running via Bazel, we need to handle the runfiles structure
if [[ -n "${BUILD_WORKSPACE_DIRECTORY:-}" ]]; then
    PROJECT_ROOT="$BUILD_WORKSPACE_DIRECTORY"
else
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

# Detect container runtime
if command -v podman &>/dev/null; then
    RUNTIME="podman"
elif command -v docker &>/dev/null; then
    RUNTIME="docker"
else
    echo "Error: No container runtime found (podman or docker required)"
    exit 1
fi

CONTAINER_NAME="pixelwise-dev"
IMAGE_TAG="pixelwise-dev:latest"

# If a tarball was provided, load it
if [[ -n "${1:-}" ]] && [[ -f "$1" ]]; then
    echo "Loading image from $1..."
    $RUNTIME load < "$1"
fi

# Stop existing container if running
if $RUNTIME ps -q --filter "name=$CONTAINER_NAME" 2>/dev/null | grep -q .; then
    echo "Stopping existing container..."
    $RUNTIME stop "$CONTAINER_NAME" 2>/dev/null || true
fi

# Remove existing container if exists
if $RUNTIME ps -aq --filter "name=$CONTAINER_NAME" 2>/dev/null | grep -q .; then
    $RUNTIME rm "$CONTAINER_NAME" 2>/dev/null || true
fi

echo "Starting development container..."
echo "  Project root: $PROJECT_ROOT"
echo "  Ports: 5175 (Vite), 24679 (HMR)"

# Run the container with:
# - Source code mounted for HMR
# - Port 5175 for Vite dev server
# - Port 24679 for HMR WebSocket
# - Node modules mounted from container (not host)
$RUNTIME run \
    --name "$CONTAINER_NAME" \
    --rm \
    -it \
    -p 5175:5175 \
    -p 24679:24679 \
    -v "$PROJECT_ROOT/src:/app/src:ro" \
    -v "$PROJECT_ROOT/static:/app/static:ro" \
    -v "$PROJECT_ROOT/futhark:/app/futhark:ro" \
    -v "$PROJECT_ROOT/package.json:/app/package.json:ro" \
    -v "$PROJECT_ROOT/pnpm-lock.yaml:/app/pnpm-lock.yaml:ro" \
    -v "$PROJECT_ROOT/vite.config.ts:/app/vite.config.ts:ro" \
    -v "$PROJECT_ROOT/svelte.config.js:/app/svelte.config.js:ro" \
    -v "$PROJECT_ROOT/tsconfig.json:/app/tsconfig.json:ro" \
    -e "NODE_ENV=development" \
    -e "CONTAINER=1" \
    -e "HMR_PORT=24679" \
    -e "PORT=5175" \
    "$IMAGE_TAG"
