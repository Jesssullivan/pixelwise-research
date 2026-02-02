#!/usr/bin/env bash
# Push a container image to a registry using skopeo
# Usage: push_image.sh <tarball_path> <registry>

set -euo pipefail

TARBALL="$1"
REGISTRY="$2"

# Get the git commit SHA for tagging
GIT_SHA="${CI_COMMIT_SHORT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo "dev")}"
GIT_TAG="${CI_COMMIT_TAG:-}"

echo "Pushing image to $REGISTRY..."

# Push with commit SHA tag
skopeo copy \
    "docker-archive:$TARBALL" \
    "docker://$REGISTRY:$GIT_SHA"

echo "Pushed: $REGISTRY:$GIT_SHA"

# If on main branch, also tag as latest
if [ "${CI_COMMIT_BRANCH:-}" = "${CI_DEFAULT_BRANCH:-main}" ]; then
    skopeo copy \
        "docker://$REGISTRY:$GIT_SHA" \
        "docker://$REGISTRY:latest"
    echo "Pushed: $REGISTRY:latest"
fi

# If this is a git tag, push with that tag too
if [ -n "$GIT_TAG" ]; then
    skopeo copy \
        "docker://$REGISTRY:$GIT_SHA" \
        "docker://$REGISTRY:$GIT_TAG"
    echo "Pushed: $REGISTRY:$GIT_TAG"
fi

echo "Push complete!"
