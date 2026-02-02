#!/usr/bin/env bash
# Load a container image tarball into the local container runtime
# Usage: load_image.sh <tarball_path> <image_tag>

set -euo pipefail

TARBALL="$1"
IMAGE_TAG="${2:-pixelwise:latest}"

# Detect container runtime
if command -v podman &>/dev/null; then
    RUNTIME="podman"
elif command -v docker &>/dev/null; then
    RUNTIME="docker"
else
    echo "Error: No container runtime found (podman or docker required)"
    exit 1
fi

echo "Loading image from $TARBALL as $IMAGE_TAG using $RUNTIME..."

# Load the tarball
$RUNTIME load < "$TARBALL"

echo "Image loaded successfully: $IMAGE_TAG"
