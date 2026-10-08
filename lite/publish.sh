#!/usr/bin/env bash
# Build the Lite image for amd64 + arm64 and push to a registry (GHCR by default).
#
# For most publishing, prefer the GitHub Actions workflow (.github/workflows/
# build.yml). This script is the local equivalent: it assembles the build
# context from this repository (backend-api/backend and frontend/) and pushes
# a multi-arch image.
#
# Usage:
#   ORG=<namespace> ./publish.sh          # uses ./VERSION
#   ORG=<namespace> ./publish.sh 0.2.0    # explicit version
#
# Auth (pick one):
#   - Set CR_PAT (GitHub PAT with write:packages) + GHCR_USER before running.
#   - Or run `docker login <registry>` manually beforehand.
#
# Target via env (ORG is required):
#   REGISTRY=ghcr.io  ORG=<namespace>  IMAGE=lite
#   PLATFORMS=linux/amd64,linux/arm64
#
# Re-running is safe — buildx caches layers and QEMU binfmt registration is
# idempotent.
set -euo pipefail

REGISTRY="${REGISTRY:-ghcr.io}"
ORG="${ORG:?Set ORG to the registry namespace to publish under (e.g. your GitHub organization)}"
IMAGE="${IMAGE:-lite}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
BUILDER="${BUILDER:-workspace-builder}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$SCRIPT_DIR"
SOURCE_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
DOCKERFILE="Dockerfile"
VERSION_FILE="$SCRIPT_DIR/VERSION"

# --- resolve version ---------------------------------------------------------
VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  if [[ -f "$VERSION_FILE" ]]; then
    VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
  else
    echo "ERROR: no version given and $VERSION_FILE is missing." >&2
    echo "  Pass one explicitly:  ./publish.sh 0.1.0" >&2
    echo "  Or create the file:   echo 0.1.0 > VERSION" >&2
    exit 1
  fi
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+a-zA-Z0-9.]+)?$ ]]; then
  echo "ERROR: '$VERSION' doesn't look like a semver version." >&2
  exit 1
fi

IMAGE_BASE="$REGISTRY/$ORG/$IMAGE"

echo ""
echo "==============================================================="
echo "  Publishing $IMAGE_BASE"
echo "    version:   $VERSION"
echo "    platforms: $PLATFORMS"
echo "    context:   $REPO_ROOT"
echo "==============================================================="
echo ""

# --- auth (optional non-interactive login) -----------------------------------
if [[ -n "${CR_PAT:-}" ]]; then
  : "${GHCR_USER:?GHCR_USER must be set when CR_PAT is set (your GitHub username).}"
  echo "[publish] Logging into $REGISTRY as $GHCR_USER..."
  echo "$CR_PAT" | docker login "$REGISTRY" -u "$GHCR_USER" --password-stdin
fi

# --- buildx builder ----------------------------------------------------------
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  echo "[publish] Creating buildx builder '$BUILDER'..."
  docker buildx create --name "$BUILDER" --driver docker-container --use >/dev/null
else
  echo "[publish] Using existing buildx builder '$BUILDER'."
  docker buildx use "$BUILDER" >/dev/null
fi

# --- QEMU emulators (no-op if already installed) -----------------------------
echo "[publish] Registering QEMU binfmt handlers..."
docker run --rm --privileged tonistiigi/binfmt --install all >/dev/null

# --- assemble build context --------------------------------------------------
cd "$REPO_ROOT"

# Copy a source directory without the heavy/irrelevant dirs (the build reinstalls deps).
copy_src() { # <src> <dest>
  mkdir -p "$2"
  tar -C "$1" \
    --exclude=node_modules --exclude=.git --exclude=.venv \
    --exclude=venv --exclude=dist --exclude=__pycache__ \
    -cf - . | tar -C "$2" -xf -
}

echo "[publish] Assembling context from $SOURCE_ROOT..."
rm -rf backend frontend
copy_src "$SOURCE_ROOT/backend-api/backend" ./backend
copy_src "$SOURCE_ROOT/frontend" ./frontend

# --- build + push ------------------------------------------------------------
echo "[publish] Building and pushing $IMAGE_BASE:{$VERSION,latest}..."
docker buildx build \
  --platform "$PLATFORMS" \
  -f "$DOCKERFILE" \
  -t "$IMAGE_BASE:$VERSION" \
  -t "$IMAGE_BASE:latest" \
  --push \
  .

echo ""
echo "==============================================================="
echo "  Published $IMAGE_BASE:$VERSION"
echo "  Updated   $IMAGE_BASE:latest"
echo "==============================================================="
echo ""
echo "Inspect: docker buildx imagetools inspect $IMAGE_BASE:$VERSION"
echo "Pull:    docker pull $IMAGE_BASE:latest"
