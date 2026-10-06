#!/usr/bin/env bash
# Build the OpenBB image locally.
#
# The Dockerfile expects backend/ (from ../backend-api) and frontend/ assembled
# next to it. This script does that assembly the same way CI does, then runs a
# single-arch `docker build --load` so the image lands in your local daemon.
#
# Each source is picked independently: either cloned from the repo at a git ref
# (default) or copied from a checkout on disk (picks up uncommitted changes).
# Mix and match freely.
#
#   # Default: clone the repo at both git refs.
#   ./build-local.sh
#   ./build-local.sh --backend-branch refs/pull/42/head --workspace-branch my-feature-branch
#   ./build-local.sh --variant full
#   ./build-local.sh --variant full --platform linux/amd64
#
#   # Local workspace, remote backend branch:
#   ./build-local.sh --workspace-local
#
#   # Local backend, remote workspace branch:
#   ./build-local.sh --backend-local
#
#   # Both local:
#   ./build-local.sh --local
#
# Local dirs default to the paths below; override with BACKEND_DIR / WORKSPACE_DIR.
#
# Env overrides:
#   IMAGE   image tag to build           (default openbb/<variant>:dev)
#   BACKEND_REPO / WORKSPACE_REPO       git URLs (default openbq-org/workspace)
#   BACKEND_BRANCH / WORKSPACE_BRANCH   branches, tags, SHAs, or pull request refs
#   BACKEND_DIR / WORKSPACE_DIR         local source dirs for the --*-local flags
# Flags:
#   --variant lite|full                  (default lite)
#   --platform PLATFORM                  Docker target platform (default daemon platform)
set -euo pipefail

## ./build-local.sh --local - to build local stuff

IMAGE="${IMAGE:-}"
IMAGE_VARIANT="lite"
PLATFORM=""
BACKEND_REPO="${BACKEND_REPO:-https://github.com/openbq-org/workspace.git}"
WORKSPACE_REPO="${WORKSPACE_REPO:-https://github.com/openbq-org/workspace.git}"
BACKEND_BRANCH="${BACKEND_BRANCH:-develop}"
WORKSPACE_BRANCH="${WORKSPACE_BRANCH:-develop}"
# Per-repo source: "clone" (fetch the ref) or "local" (copy from disk).
BACKEND_SRC="clone"
WORKSPACE_SRC="clone"
# Defaults for local mode so you can omit the env vars.
BACKEND_DIR="${BACKEND_DIR:-../backend-api}"
WORKSPACE_DIR="${WORKSPACE_DIR:-../frontend}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
cd "$SCRIPT_DIR"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)            BACKEND_SRC="local"; WORKSPACE_SRC="local"; shift ;;
    --backend-local)    BACKEND_SRC="local"; shift ;;
    --workspace-local)  WORKSPACE_SRC="local"; shift ;;
    --backend-branch)   BACKEND_BRANCH="$2"; shift 2 ;;
    --workspace-branch) WORKSPACE_BRANCH="$2"; shift 2 ;;
    --variant)          IMAGE_VARIANT="$2"; shift 2 ;;
    --platform)         PLATFORM="$2"; shift 2 ;;
    -h|--help) sed -n '2,/^set -euo pipefail$/p' "$0" | sed '$d'; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

case "$IMAGE_VARIANT" in
  lite|full) ;;
  *) echo "Unknown variant: $IMAGE_VARIANT (expected lite or full)" >&2; exit 1 ;;
esac

if [[ -z "$IMAGE" ]]; then
  IMAGE="openbb/${IMAGE_VARIANT}:dev"
fi

cleanup() { rm -rf "$SCRIPT_DIR/_src"; }
trap cleanup EXIT

echo "[build-local] Assembling build context (variant: $IMAGE_VARIANT, backend: $BACKEND_SRC, workspace: $WORKSPACE_SRC)..."
rm -rf backend frontend _src

# Copy a checkout without the heavy/irrelevant dirs (build reinstalls deps anyway).
copy_src() { # <src> <dest>
  mkdir -p "$2"
  tar -C "$1" \
    --exclude=node_modules --exclude=.git --exclude=.venv \
    --exclude=venv --exclude=dist --exclude=__pycache__ \
    -cf - . | tar -C "$2" -xf -
}

# Fetch an arbitrary ref (branch, tag, SHA, or refs/pull/<N>/head) shallowly.
fetch_ref() { # <repo-url> <ref> <dest>
  git init -q "$3"
  git -C "$3" remote add origin "$1"
  git -C "$3" fetch -q --depth 1 origin "$2"
  git -C "$3" checkout -q FETCH_HEAD
}

# --- frontend ---
if [[ "$WORKSPACE_SRC" == "local" ]]; then
  [[ -d "$WORKSPACE_DIR" ]] || { echo "WORKSPACE_DIR not found: $WORKSPACE_DIR" >&2; exit 1; }
  echo "[build-local] Copying frontend from $WORKSPACE_DIR"
  copy_src "$WORKSPACE_DIR" ./frontend
else
  echo "[build-local] Fetching frontend @ $WORKSPACE_BRANCH"
  fetch_ref "$WORKSPACE_REPO" "$WORKSPACE_BRANCH" _src
  mv _src/frontend ./frontend
  rm -rf _src
fi

# --- backend-api (backend only) ---
if [[ "$BACKEND_SRC" == "local" ]]; then
  [[ -d "$BACKEND_DIR/backend" ]] || { echo "No backend/ under BACKEND_DIR=$BACKEND_DIR" >&2; exit 1; }
  echo "[build-local] Copying backend from $BACKEND_DIR/backend"
  copy_src "$BACKEND_DIR/backend" ./backend
else
  echo "[build-local] Fetching backend @ $BACKEND_BRANCH (backend only)"
  fetch_ref "$BACKEND_REPO" "$BACKEND_BRANCH" _src
  mv _src/backend-api/backend ./backend
  rm -rf _src
fi

echo "[build-local] Building $IMAGE ..."
PLATFORM_ARGS=()
if [[ -n "$PLATFORM" ]]; then
  PLATFORM_ARGS=(--platform "$PLATFORM")
fi
DOCKER_BUILDKIT=1 docker build --load \
  ${PLATFORM_ARGS[@]+"${PLATFORM_ARGS[@]}"} \
  --build-arg "OPENBB_IMAGE_VARIANT=$IMAGE_VARIANT" \
  -f Dockerfile \
  -t "$IMAGE" \
  .

cat <<EOF

[build-local] Built $IMAGE
Run it:
  docker run -d -p 3000:3000 -v openbb-data:/data --name openbb $IMAGE
  docker exec openbb credentials   # prints the admin login
EOF
