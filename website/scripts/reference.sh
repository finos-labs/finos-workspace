#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

(
  cd "$root"
  docker compose build init
  env_flags=()
  while IFS= read -r setting; do env_flags+=(-e "$setting"); done < <(sed -n 's/^    \([A-Z_]*=.*\)$/\1/p' backend-api/backend/pytest.ini)
  docker run --rm --platform "${PLATFORM:-linux/amd64}" --user "$(id -u):$(id -g)" -e "USER=$(id -un)" "${env_flags[@]}" \
    -v "$root/backend-api/backend:/opt/code" workspace-api:local python -m scripts.export_reference_data
)

(
  cd "$root/agent"
  npm ci --ignore-scripts
  npm run reference
)

(
  cd "$root/frontend"
  npm ci --ignore-scripts
  npm run reference
)
