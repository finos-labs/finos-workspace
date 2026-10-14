#!/bin/bash
# One-box entrypoint.
#
# Goal: `docker run -d -p 3000:3000 -e WORKSPACE_ADMIN_EMAIL=<your-email> <image>` is all it
# takes. Anything the user supplies via -e is preserved; everything else is generated
# once per /data volume and persisted to /data/secrets.env so values stay
# stable across container restarts and the JWT_SECRET / WORKSPACE_AUTH_TOKEN
# pair remains consistent.
set -euo pipefail

DATA_DIR="${DATA_DIR:-/data}"
SECRETS_FILE="${DATA_DIR}/secrets.env"
STATE_DIR="${DATA_DIR}/state"
STATE_INITIALISED="${STATE_DIR}/initialised"

mkdir -p "$DATA_DIR" "$DATA_DIR/storage" "$DATA_DIR/redis" "$STATE_DIR"
chown -R appuser:appuser "$DATA_DIR"

###############################################
# 1. Bootstrap secrets on first run.
###############################################
# Generate any value the user didn't pass via -e, store in /data/secrets.env,
# then re-source so the rest of the entrypoint (and supervisord children) see
# the resolved environment. PyJWT lives in the backend venv, so we use it for
# the JWT_SECRET / WORKSPACE_AUTH_TOKEN pair.
gen_hex() { python -c "import secrets; print(secrets.token_hex($1))"; }
gen_b64() { python -c "import secrets; print(secrets.token_urlsafe($1))"; }

# A password that the sign-in form accepts (the same generator that scripts.create_local_env uses).
gen_password() { (cd /opt/code && python -c "from scripts.create_local_env import admin_password; print(admin_password())"); }

# Defaults applied only if the variable is unset/empty.
: "${JWT_SECRET:=}"
: "${WORKSPACE_AUTH_TOKEN:=}"
: "${WORKSPACE_AES_KEY:=}"
: "${LOCAL_STORAGE_SECRET_KEY:=}"
: "${WORKSPACE_ADMIN_EMAIL:=}"
: "${WORKSPACE_ENTITY_NAME:=Workspace}"
: "${WORKSPACE_ADMIN_PASSWORD:=}"
: "${WORKSPACE_FRONTEND_USER_AGENT:=}"

if [[ -f "$SECRETS_FILE" ]]; then
  # Load only the vars the caller did NOT already set. Filters out comments
  # and blank lines, then `export -n` first so we don't accidentally clobber
  # caller-supplied values.
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    if [[ -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < "$SECRETS_FILE"
fi

# The administrator's address has no default: it is the account you sign in with.
if [[ -z "$WORKSPACE_ADMIN_EMAIL" ]]; then
  echo "[entrypoint] WORKSPACE_ADMIN_EMAIL is not set. Start the container with" >&2
  echo "[entrypoint]   -e WORKSPACE_ADMIN_EMAIL=<the address of the first administrator>" >&2
  exit 1
fi

# Generate anything still missing.
[[ -z "$JWT_SECRET" ]]               && JWT_SECRET="$(gen_hex 48)"
[[ -z "$WORKSPACE_AES_KEY" ]]           && WORKSPACE_AES_KEY="$(gen_hex 8)"  # 16-char hex
[[ -z "$LOCAL_STORAGE_SECRET_KEY" ]] && LOCAL_STORAGE_SECRET_KEY="$(gen_b64 24)"
[[ -z "$WORKSPACE_ADMIN_PASSWORD" ]]    && WORKSPACE_ADMIN_PASSWORD="$(gen_password)"
[[ -z "$WORKSPACE_FRONTEND_USER_AGENT" ]] && WORKSPACE_FRONTEND_USER_AGENT="$(gen_hex 8)"

# WORKSPACE_AUTH_TOKEN must be a JWT signed with JWT_SECRET (HS256). The backend
# decodes it on startup; mismatched secret => permanent 401s on /app/* routes.
if [[ -z "$WORKSPACE_AUTH_TOKEN" ]]; then
  WORKSPACE_AUTH_TOKEN="$(JWT_SECRET="$JWT_SECRET" python -c "
import jwt, os
print(jwt.encode({'sub': 'workspace'}, os.environ['JWT_SECRET'], algorithm='HS256'))
")"
fi

export JWT_SECRET WORKSPACE_AUTH_TOKEN WORKSPACE_AES_KEY LOCAL_STORAGE_SECRET_KEY
export WORKSPACE_ADMIN_EMAIL WORKSPACE_ADMIN_PASSWORD WORKSPACE_ENTITY_NAME

# Persist (chmod 600). Generated values stay stable across restarts; the
# admin password is included so the user can recover it after losing the
# initial container logs.
umask 077
cat > "$SECRETS_FILE" <<EOF
# Generated on first start. Override any of these via
# docker run -e ... — caller-supplied values always win.
JWT_SECRET=$JWT_SECRET
WORKSPACE_AUTH_TOKEN=$WORKSPACE_AUTH_TOKEN
WORKSPACE_AES_KEY=$WORKSPACE_AES_KEY
LOCAL_STORAGE_SECRET_KEY=$LOCAL_STORAGE_SECRET_KEY
WORKSPACE_ADMIN_EMAIL=$WORKSPACE_ADMIN_EMAIL
WORKSPACE_ADMIN_PASSWORD=$WORKSPACE_ADMIN_PASSWORD
WORKSPACE_FRONTEND_USER_AGENT=$WORKSPACE_FRONTEND_USER_AGENT
WORKSPACE_ENTITY_NAME=$WORKSPACE_ENTITY_NAME
EOF
chown appuser:appuser "$SECRETS_FILE"
umask 022

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

# Re-render the seed config.toml with our admin email/password so init_users
# picks them up. init_users is idempotent (select-before-insert), so we run it
# on every start.
(cd /opt/code && python -c "
import os
from scripts.create_local_env import seed_config
print(seed_config(os.environ['WORKSPACE_ENTITY_NAME'], os.environ['WORKSPACE_ADMIN_EMAIL'], os.environ['WORKSPACE_ADMIN_PASSWORD'], seats=10000), end='')
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
   URL:      http://localhost:${PORT}
   Admin:    ${WORKSPACE_ADMIN_EMAIL}
   Password: ${WORKSPACE_ADMIN_PASSWORD}
   Print this again anytime with:  docker exec workspace credentials
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
