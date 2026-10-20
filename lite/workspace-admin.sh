#!/bin/bash
# The admin CLI, inside the container: `docker exec workspace workspace-admin <resource> <action>`
# (`--help` lists them). It works on the database itself and sends no request to the API.
set -euo pipefail

# shellcheck source=secrets.sh
source /usr/local/lib/workspace/secrets.sh

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "The container is still starting. Try again in a few seconds." >&2
  exit 1
fi
# `docker exec` starts with the image's environment and the -e values only, not with what
# the entrypoint resolved; the API's settings need the same keys.
load_secrets

# As appuser, like the API, so that SQLite's sidecar files stay its own
# shellcheck disable=SC2016
exec runuser -u appuser -- bash -c 'cd /opt/code && exec python -m scripts.workspace_admin "$@"' _ "$@"
