#!/usr/bin/env bash
# Bazel development server wrapper
# This script starts the Vite dev server with proper environment

set -euo pipefail

cd "$(dirname "$0")/.."

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    pnpm install
fi

# Start development server
exec pnpm run dev
