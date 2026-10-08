#!/bin/bash
# Imports the backend's main module with a throwaway SQLite setup, to see that a purge left it importable.
# Needs VENV, the path of the backend's virtualenv (for example the one Poetry created).
set -euo pipefail
cd "$(dirname "$0")/../../../backend-api/backend"
DATABASE_TYPE=sqlite DB_PATH="$(mktemp -d)/x.db" JWT_SECRET=x WORKSPACE_AES_KEY="$(LC_ALL=C tr -dc a-z0-9 </dev/urandom | head -c 16)" \
  FRONTENDURL=http://x SELFURL=http://x APPURL=http://x MODE=test REDIS_HOST=r \
  "$VENV/bin/python" -c "import main; print('main imports ok')" 2>&1 | tail -6
