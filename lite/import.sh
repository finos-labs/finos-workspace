#!/bin/bash
# Imports an exported account into this container:
#   docker exec -it <container> workspace-import /import/<archive>.zip
#
# The archive's credentials are sealed under the export key shown when it was made;
# the import asks for it on the terminal.
#
# The archive comes from `workspace-admin user export` on the deployment that the account
# lives on. Mount the folder holding it when starting the container, e.g.
# -v /path/to/exports:/import
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: docker exec -it workspace workspace-import <archive.zip> [--force] [--describe-scope]

  <archive.zip>      Path to the export, as seen from inside the container.
                     Mount it when starting the container:
                         docker run ... -v /path/to/exports:/import lite
                     then pass /import/<file>.zip here.

  --force            Replace a previously imported copy of this account.
  --describe-scope   Print exactly what is imported and what is reset, then exit.

The import asks for the export key that was shown when the archive was made, so run it
with -it, which gives it a terminal.

After importing, sign in as the administrator (`docker exec workspace credentials`
gives them a new one-time password if needed) and set a password for the imported
account.
EOF
  exit 1
}

if [[ $# -eq 0 ]]; then
  usage
fi

# --describe-scope takes no archive, so let it through untouched.
if [[ "$1" != "--describe-scope" ]]; then
  archive="$1"
  case "$archive" in
    -*) usage ;;
  esac
  if [[ ! -f "$archive" ]]; then
    echo "No such archive inside the container: $archive" >&2
    echo >&2
    echo "Did you mount the folder containing it? For example:" >&2
    echo "  docker run -d --name workspace -p 3000:3000 \\" >&2
    echo "      -v workspace-data:/data -v /path/to/exports:/import lite" >&2
    echo "then pass /import/<file>.zip" >&2
    exit 1
  fi
  if [[ ! -r "$archive" ]]; then
    echo "Archive is not readable inside the container: $archive" >&2
    exit 1
  fi
fi

# `docker exec` starts a fresh process that inherits only the image's ENV and the
# -e values, not the environment the entrypoint assembled for supervisord. The
# settings module requires JWT_SECRET and WORKSPACE_AES_KEY, and the AES key in
# particular has to be the *same* one the running app uses -- the import
# re-encrypts backend and copilot credentials with it, and a different key would
# store credentials the app cannot read back. So load the keys the volume keeps,
# as the entrypoint does, without overriding anything passed with -e.
# shellcheck source=secrets.sh
source /usr/local/lib/workspace/secrets.sh
if [[ -f "$SECRETS_FILE" ]]; then
  load_secrets
else
  echo "No $SECRETS_FILE -- the container has not finished first-time setup." >&2
  echo "Start it once, wait for it to come up, then retry." >&2
  exit 1
fi

# Run as appuser so the SQLite WAL/SHM sidecars this creates stay owned by the
# user the backend runs as -- root-owned sidecars would lock the app out of its
# own database. runuser without --login passes the exported environment through,
# which is how entrypoint.sh runs alembic and init_users.
exec runuser -u appuser -- bash -c \
  'cd /opt/code && exec python -m scripts.import_user_data "$@"' _ "$@"
