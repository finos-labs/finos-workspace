#!/usr/bin/env bash
# Build the image locally.
#
# The Dockerfile expects backend/ and frontend/ assembled next to it. This
# script copies them from this repository (picking up uncommitted changes), then
# runs a single-arch `docker build --load` so the image lands in your local daemon.
#
#   ./build-local.sh
#   ./build-local.sh --platform linux/amd64
#
# Env overrides:
#   IMAGE                        image tag to build (default lite:dev)
#   BACKEND_DIR / FRONTEND_DIR  source dirs (default ../backend-api and ../frontend)
# Flags:
#   --platform PLATFORM                  Docker target platform (default daemon platform)
set -euo pipefail

IMAGE="${IMAGE:-}"
PLATFORM=""
BACKEND_DIR="${BACKEND_DIR:-../backend-api}"
FRONTEND_DIR="${FRONTEND_DIR:-../frontend}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
cd "$SCRIPT_DIR"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)         PLATFORM="$2"; shift 2 ;;
    -h|--help) sed -n '2,/^set -euo pipefail$/p' "$0" | sed '$d'; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$IMAGE" ]]; then
  IMAGE="lite:dev"
fi

echo "[build-local] Assembling build context..."
rm -rf backend frontend

# Copy a checkout without the heavy/irrelevant dirs (build reinstalls deps anyway).
copy_src() { # <src> <dest>
  mkdir -p "$2"
  tar -C "$1" \
    --exclude=node_modules --exclude=.git --exclude=.venv \
    --exclude=venv --exclude=dist --exclude=__pycache__ \
    -cf - . | tar -C "$2" -xf -
}

# --- frontend ---
[[ -d "$FRONTEND_DIR" ]] || { echo "FRONTEND_DIR not found: $FRONTEND_DIR" >&2; exit 1; }
echo "[build-local] Copying frontend from $FRONTEND_DIR"
copy_src "$FRONTEND_DIR" ./frontend

# --- backend-api (backend only) ---
[[ -d "$BACKEND_DIR/backend" ]] || { echo "No backend/ under BACKEND_DIR=$BACKEND_DIR" >&2; exit 1; }
echo "[build-local] Copying backend from $BACKEND_DIR/backend"
copy_src "$BACKEND_DIR/backend" ./backend

echo "[build-local] Building $IMAGE ..."
PLATFORM_ARGS=()
if [[ -n "$PLATFORM" ]]; then
  PLATFORM_ARGS=(--platform "$PLATFORM")
fi
DOCKER_BUILDKIT=1 docker build --load \
  ${PLATFORM_ARGS[@]+"${PLATFORM_ARGS[@]}"} \
  -f Dockerfile \
  -t "$IMAGE" \
  .

cat <<EOF

[build-local] Built $IMAGE
Run it:
  docker run -d -p 3000:3000 -p 8000:8000 -v workspace-data:/data -e WORKSPACE_ADMIN_EMAIL=<your-email> --name workspace $IMAGE
  docker exec -it workspace credentials   # set the administrator's password
EOF
