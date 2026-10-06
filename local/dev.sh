#!/usr/bin/env bash
# Helpers for the local stack in compose.yaml. The Makefile calls these; run
# `./dev.sh -h` to see them.
set -euo pipefail

LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ENV="$LOCAL_DIR/backend.env"
BACKEND_ENV_EXAMPLE="$LOCAL_DIR/../backend-api/backend/envs/.env.example"
PORTS=(3306 6379 8000 1420)
APP_URL="http://localhost:1420"
API_HEALTH_URL="http://localhost:8000/healthz"
WAIT_SECONDS="${WAIT_SECONDS:-1200}"

usage() {
  cat <<EOF
Usage: ./dev.sh <command>

Commands:
  doctor   Check Docker, Docker Compose and free ports
  env      Create backend.env from the backend's .env.example if it is missing
  wait     Wait until the backend and the frontend answer, then print the login
  emails   For each sign-up: the email address, activation link and temporary password

Options:
  -h, --help   Show this help

Environment:
  WAIT_SECONDS   How long 'wait' waits before giving up (default: 1200)
EOF
}

fail() {
  echo "error: $*" >&2
  exit 1
}

compose() {
  docker compose --project-directory "$LOCAL_DIR" "$@"
}

doctor() {
  command -v docker >/dev/null || fail "Docker is not installed. Install Docker Desktop."
  docker info >/dev/null 2>&1 || fail "Docker is not running. Start Docker Desktop."
  local version
  version="$(docker compose version --short 2>/dev/null)" || fail "Docker Compose v2 is missing. Update Docker Desktop."
  echo "ok: Docker Compose ${version#v}"

  # Ports already taken by something other than this stack.
  if command -v lsof >/dev/null && [[ -z "$(compose ps -q 2>/dev/null)" ]]; then
    local port
    for port in "${PORTS[@]}"; do
      if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        fail "port $port is in use. See what holds it with: lsof -nP -iTCP:$port -sTCP:LISTEN"
      fi
    done
    echo "ok: ports ${PORTS[*]} are free"
  fi
}

create_env() {
  if [[ -f "$BACKEND_ENV" ]]; then
    echo "ok: using existing local/backend.env"
    return
  fi

  # The backend checks browser requests against its own OPENBB_AUTH_TOKEN, which
  # must be a JWT signed with JWT_SECRET. The template's values are placeholders,
  # so this machine gets a random secret and a token signed with it.
  local jwt_secret unsigned token
  jwt_secret="$(openssl rand -hex 32)"
  unsigned="$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url).$(printf '%s' '{"sub":"pro","auth":"local-auth"}' | b64url)"
  token="$unsigned.$(printf '%s' "$unsigned" | openssl dgst -sha256 -hmac "$jwt_secret" -binary | b64url)"

  # Local values on top of the template: on-prem mode, the MySQL and Redis
  # containers, the database MySQL creates, no TLS to it (the template's SSL_*
  # entries are placeholder paths), files on disk instead of S3, no HubSpot, and
  # localhost URLs for the links and redirects the backend builds.
  sed \
    -e 's/^MODE=.*/MODE=onprem/' \
    -e 's|^SELFURL=.*|SELFURL=http://localhost:8000|' \
    -e 's|^FRONTENDURL=.*|FRONTENDURL=http://localhost:1420|' \
    -e 's|^PROURL=.*|PROURL=http://localhost:1420|' \
    -e 's/^DB_HOST=.*/DB_HOST=mysql/' \
    -e 's/^REDIS_HOST=.*/REDIS_HOST=redis/' \
    -e 's/^DB_NAME=.*/DB_NAME=user_db/' \
    -e 's/^SSL_CA=.*/SSL_CA=/' \
    -e 's/^SSL_CERT=.*/SSL_CERT=/' \
    -e 's/^SSL_KEY=.*/SSL_KEY=/' \
    -e 's/^STORAGE_PROVIDER=.*/STORAGE_PROVIDER=folder/' \
    -e 's/^HUBSPOT=.*/HUBSPOT=0/' \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$jwt_secret|" \
    -e "s|^OPENBB_AUTH_TOKEN=.*|OPENBB_AUTH_TOKEN=$token|" \
    "$BACKEND_ENV_EXAMPLE" >"$BACKEND_ENV"
  echo "ok: created local/backend.env"
}

# Base64url without padding, as JWTs use.
b64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

emails() {
  # Outside production the backend writes each email to its log instead of
  # sending it: a "to:" line with the address, then a "global_merge_vars:" line
  # with the email's fields. A sign-up email's fields are create_url (the link)
  # and password (the temporary password). The backend's log filter replaces
  # setting values with their names, so SELFURL is turned back into a URL here,
  # and Python writes a backslash in the password as two.
  local line to="" link password found=0
  while IFS= read -r line; do
    case "$line" in
      *" - to: "*)
        to="$(sed -E "s/.*'email': '([^']*)'.*/\1/" <<<"$line")"
        ;;
      *" - global_merge_vars: "*"'create_url'"*)
        link="$(sed -E "s/.*'name': 'create_url', 'content': '([^']*)'.*/\1/" <<<"$line")"
        password="$(sed -E "s/.*'name': 'password', 'content': '([^']*)'.*/\1/" <<<"$line" | sed 's/\\\\/\\/g')"
        printf '%s\n  link:      %s\n  password:  %s\n\n' "$to" "${link/SELFURL/http://localhost:8000}" "$password"
        found=1
        ;;
    esac
  done < <(compose logs --no-color --no-log-prefix backend 2>/dev/null |
    sed $'s/\x1b\\[[0-9;]*m//g' |
    grep -E '\|send_template\|[0-9]+ - (to|global_merge_vars): ')

  if (( found )); then
    echo "Newest last. Open the link, then log in with the email address and the password."
  else
    echo "No sign-up emails yet. Sign up at $APP_URL, then run 'make emails' again."
  fi
}

wait_ready() {
  local deadline=$((SECONDS + WAIT_SECONDS)) init_state
  echo "Waiting for the backend and the frontend (the first run builds images and installs packages)..."
  until curl -fs -o /dev/null "$API_HEALTH_URL" && curl -fs -o /dev/null "$APP_URL"; do
    init_state="$(compose ps --all --format '{{.State}} {{.ExitCode}}' init 2>/dev/null || true)"
    if [[ "$init_state" == exited* && "$init_state" != "exited 0" ]]; then
      fail "the init step failed. See why with: make logs s=init"
    fi
    (( SECONDS < deadline )) || fail "not ready after ${WAIT_SECONDS}s. See: make logs"
    sleep 5
  done
  cat <<EOF

Ready.
  App:      $APP_URL
  Login:    admin@openbb.co / asdQWE123!
  Backend:  http://localhost:8000
  Emails:   nothing is sent locally; 'make emails' shows sign-up links and passwords
EOF
}

case "${1:-}" in
  doctor) doctor ;;
  env) create_env ;;
  wait) wait_ready ;;
  emails) emails ;;
  -h | --help) usage ;;
  *)
    usage >&2
    exit 1
    ;;
esac
