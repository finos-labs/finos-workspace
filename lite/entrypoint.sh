#!/bin/bash
# One-box entrypoint.
#
# Goal: `docker run -d -p 3000:3000 -p 8000:8000 -e WORKSPACE_ADMIN_EMAIL=<your-email> <image>` is all it
# takes. A key passed with -e is used as given and is not written to the volume; any other
# key is generated once per /data volume and kept in /data/secrets.env (secrets.sh), so it
# stays the same across restarts. The administrator's password is never printed or kept
# in a file: `docker exec -it <container> credentials` sets it.
set -euo pipefail

DATA_DIR="${DATA_DIR:-/data}"
STATE_DIR="${DATA_DIR}/state"
STATE_INITIALISED="${STATE_DIR}/initialised"

mkdir -p "$DATA_DIR" "$DATA_DIR/storage" "$DATA_DIR/redis" "$STATE_DIR"
chown -R appuser:appuser "$DATA_DIR"

###############################################
# 1. Keys and the administrator's address.
###############################################
# The rest of the entrypoint, and supervisord's children, see the resolved environment.
# shellcheck source=secrets.sh
source /usr/local/lib/workspace/secrets.sh
resolve_secrets

# The administrator's address has no default: it is the account you sign in with.
if [[ -z "${WORKSPACE_ADMIN_EMAIL:-}" ]]; then
  echo "[entrypoint] WORKSPACE_ADMIN_EMAIL is not set. Start the container with" >&2
  echo "[entrypoint]   -e WORKSPACE_ADMIN_EMAIL=<the address of the first administrator>" >&2
  exit 1
fi

write_secrets

# WORKSPACE_AUTH_TOKEN must be a JWT signed with JWT_SECRET (HS256). The same secret always
# mints the same token, so it is minted at every start rather than kept. PyJWT lives in the
# backend venv.
if [[ -z "${WORKSPACE_AUTH_TOKEN:-}" ]]; then
  WORKSPACE_AUTH_TOKEN="$(python -c "
import jwt, os
print(jwt.encode({'sub': 'workspace'}, os.environ['JWT_SECRET'], algorithm='HS256'))
")"
fi
export WORKSPACE_AUTH_TOKEN

###############################################
# 2. Render frontend runtime config + nginx conf.
###############################################
/usr/local/bin/render-frontend-config

# nginx template substitution (only ${PORT} for now). Run manually instead of
# relying on the official nginx image's docker-entrypoint because we are on
# python:slim, not nginx:stable.
envsubst '${PORT}' < /etc/nginx/templates/default.conf.template \
    > /etc/nginx/sites-available/default
ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-enabled/default.dpkg-dist 2>/dev/null || true

###############################################
# 3. Database init + migrations + bootstrap admin user.
###############################################
cd /opt/code

# Delete any stale user_create.json so init_users doesn't read its own
# previous output (see DEVELOPMENT_SETUP.md "circular contamination" note).
rm -f user_create.json

mkdir -p /opt/code/scripts/cfgs

if [[ "${DATABASE_TYPE}" != "sqlite" ]]; then
  echo "[entrypoint] DATABASE_TYPE=${DATABASE_TYPE} — running init-db.py"
  runuser -u appuser -- python /opt/code/init-db.py || true
fi

# Re-render the seed config.toml with the organization and the administrator's address so
# init_users picks them up. init_users is idempotent (select-before-insert), so we run it on
# every start. It creates the administrator without a password that anyone knows.
(cd /opt/code && python -c "
import os
from scripts.create_local_env import seed_config
print(seed_config(os.environ['WORKSPACE_ENTITY_NAME'], os.environ['WORKSPACE_ADMIN_EMAIL']), end='')
") > /opt/code/scripts/cfgs/config.toml
chown -R appuser:appuser /opt/code/scripts/cfgs

echo "[entrypoint] Running alembic migrations…"
runuser -u appuser -- bash -c "cd /opt/code && python -m alembic upgrade head"

if [[ ! -f "$STATE_INITIALISED" ]]; then
  echo "[entrypoint] First boot — bootstrapping entity + admin user…"
fi

# A failure here shouldn't block startup — the API still comes up and the
# admin can re-bootstrap manually.
if ! runuser -u appuser -- bash -c "cd /opt/code && python -m scripts.init_users"; then
  echo "[entrypoint] WARNING: init_users failed — continuing anyway." >&2
fi

touch "$STATE_INITIALISED"
chown appuser:appuser "$STATE_INITIALISED"

###############################################
# 4. Print a friendly summary.
###############################################
print_summary() {
  cat <<EOF
================================================================
 The Workspace is ${1} on port ${PORT}.
   URL:      http://localhost:${PORT}   (the API: http://localhost:8000)
   Admin:    ${WORKSPACE_ADMIN_EMAIL}
   Password: set it with  docker exec -it workspace credentials
================================================================
EOF
}

print_summary "starting"

# Re-print once the app answers on ${PORT} so the summary lands at the END of
# the startup logs (`docker logs --tail 15` / bottom of the Docker Desktop
# Logs tab) instead of being buried under supervisord/nginx/uvicorn output.
# Runs in the background so it survives the exec below; falls through after
# 120s so it prints even if startup is slow.
(
  for _ in $(seq 1 120); do
    (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null && break
    sleep 1
  done
  sleep 2
  print_summary "ready"
) &

###############################################
# 5. Plugin backends (docs/widget-plugins/SERVER-SIDE.md 5.4, recipe B): the runner starts
#    when its configuration is mounted. It gives the API its settings; what the deployer set
#    with -e wins.
###############################################
PLUGIN_RUNNER_CONFIG=/etc/workspace/plugin-runner.toml
PLUGIN_RUNNER=false
if [[ -f "$PLUGIN_RUNNER_CONFIG" ]]; then
  if ! runner_settings="$(cd /opt/plugin-runner && python -m plugin_runner --environment "$PLUGIN_RUNNER_CONFIG")"; then
    echo "[entrypoint] $PLUGIN_RUNNER_CONFIG cannot be used; the message above says why." >&2
    exit 1
  fi
  while IFS='=' read -r key value; do
    if [[ -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done <<< "$runner_settings"
  PLUGIN_RUNNER=true
fi
export PLUGIN_RUNNER

###############################################
# 6. Hand off to supervisord (redis + uvicorn + nginx, and the plugin runner).
###############################################
exec /usr/local/bin/supervisord -c /etc/supervisor/supervisord.conf
