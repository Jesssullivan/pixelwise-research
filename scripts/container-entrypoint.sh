#!/bin/sh
# Container Entrypoint for Pixelwise
# Fixes permissions for bind mounts and initializes development environment

set -e

echo "[Entrypoint] Starting with UID=$(id -u) GID=$(id -g)"

# Container-writable directories
echo "[Entrypoint] Setting container-writable permissions..."

# Source directory
if [ -d "/app/src" ]; then
  chmod -R 777 /app/src 2>/dev/null || true
  echo "   - src/ writable"
fi

# Futhark source and build artifacts
if [ -d "/app/futhark" ]; then
  chmod -R 777 /app/futhark 2>/dev/null || true
  echo "   - futhark/ writable"
fi

# Static files
if [ -d "/app/static" ]; then
  chmod -R 777 /app/static 2>/dev/null || true
  echo "   - static/ writable"
fi

# Ensure .svelte-kit cache directory exists and is writable
if [ ! -d "/app/.svelte-kit" ]; then
  mkdir -p /app/.svelte-kit
fi
chmod -R 777 /app/.svelte-kit 2>/dev/null || true
echo "   - .svelte-kit/ writable"

# Ensure node_modules/.vite cache directory is writable
if [ -d "/app/node_modules/.vite" ]; then
  chmod -R 777 /app/node_modules/.vite 2>/dev/null || true
  echo "   - node_modules/.vite/ writable"
fi

# Ensure build directory exists and is writable
if [ ! -d "/app/build" ]; then
  mkdir -p /app/build
fi
chmod -R 777 /app/build 2>/dev/null || true
echo "   - build/ writable"

# Ensure Futhark lib directory exists
if [ ! -d "/app/src/lib/futhark" ]; then
  mkdir -p /app/src/lib/futhark
fi
chmod -R 777 /app/src/lib/futhark 2>/dev/null || true
echo "   - src/lib/futhark/ writable"

echo "[Entrypoint] Permission setup complete"

# Check if Futhark WASM files exist
if [ ! -f "/app/futhark/esdt.wasm" ]; then
  echo "[Entrypoint] Futhark WASM files missing"
  echo "   Run 'make' in /app/futhark to build"
else
  echo "[Entrypoint] Futhark WASM files present"
fi

echo "[Entrypoint] Executing: $@"

# Execute the main command
exec "$@"
