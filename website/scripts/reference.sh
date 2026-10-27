#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

(
  cd "$root/backend-api/backend"
  env $(sed -n 's/^    \([A-Z_]*=.*\)$/\1/p' pytest.ini | xargs) python -m scripts.export_reference_data
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
