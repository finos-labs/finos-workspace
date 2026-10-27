#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

(
  cd "$root/backend-api/backend"
  while IFS= read -r setting; do declare -x "$setting"; done < <(sed -n 's/^    \([A-Z_]*=.*\)$/\1/p' pytest.ini)
  python -m scripts.export_reference_data
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
