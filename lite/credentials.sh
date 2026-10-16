#!/bin/bash
# Sets the administrator's password, typed twice without echo:
#   docker exec -it workspace credentials [<email>]
#
# Or from standard input, without -t: `docker exec -i workspace credentials < <file>`. The
# password is never printed, logged or kept in a file. Every session of the account ends.
# Without <email>, the administrator the container was started with.
set -euo pipefail

usage() {
  echo "Usage: docker exec -it workspace credentials [<administrator's email>]" >&2
  exit 1
}
case "${1:-}" in
  -*) usage ;;
esac

# shellcheck source=secrets.sh
source /usr/local/lib/workspace/secrets.sh

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "The container is still starting. Try again in a few seconds." >&2
  exit 1
fi
# `docker exec` starts with the image's environment and the -e values only, not with what
# the entrypoint resolved; the API's settings need the same keys.
load_secrets

email="${1:-${WORKSPACE_ADMIN_EMAIL:-}}"
[[ -n "$email" ]] || usage

echo " URL:      http://localhost:${PORT:-3000}"
echo " Admin:    ${email}"
# As appuser, like the API, so that SQLite's sidecar files stay its own ($1 expands in the
# inner shell)
# shellcheck disable=SC2016
exec runuser -u appuser -- bash -c \
  'cd /opt/code && exec python -m scripts.init_users --new-password "$1"' _ "$email"
