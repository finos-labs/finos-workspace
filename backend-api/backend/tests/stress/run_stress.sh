#!/usr/bin/env bash
# Stress-test launcher: bring up a chosen backend topology and run the load simulator against it.
#
#   ./run_stress.sh --workers 3 --users 80
#   ./run_stress.sh --workers 1 --users 80 --mcp-users 40 --api-mcp 0   # MCP-impact A/B
#
# Flags (all optional; defaults in []):
#   --workers   N                     [1]       uvicorn worker processes
#   --users     N                     [40]      simulated API users
#   --duration  seconds               [20]
#   --ramp      seconds               [5]       stagger user arrival
#   --mcp-users N                     [0]       extra MCP-only hammerers (for the MCP-impact test)
#   --api-mcp   0|1                   [1]       include MCP calls in the API users' mix
#   --seed                            seed the admin user (run once on a fresh DB)
#   --no-run                          just bring the stack up, don't run the simulator
#   --down                            tear the stack down and exit
#
# Requires: docker compose, and a Python with aiohttp + websockets (the backend venv is used if present).
set -euo pipefail

WORKERS=1; USERS=40; DURATION=20; RAMP=5; MCP_USERS=0; API_MCP=1
HOST_PORT=8001; SEED=0; NORUN=0; DOWN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --workers) WORKERS="$2"; shift 2;;
    --users) USERS="$2"; shift 2;;
    --duration) DURATION="$2"; shift 2;;
    --ramp) RAMP="$2"; shift 2;;
    --mcp-users) MCP_USERS="$2"; shift 2;;
    --api-mcp) API_MCP="$2"; shift 2;;
    --host-port) HOST_PORT="$2"; shift 2;;
    --seed) SEED=1; shift;;
    --no-run) NORUN=1; shift;;
    --down) DOWN=1; shift;;
    *) echo "unknown flag: $1" >&2; exit 2;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT="$(cd "$BACKEND/.." && pwd)"
BASE="docker-compose-local-dev.yml"
OVERLAY="backend/tests/stress/docker-compose.stress.yml"

# Pick a Python with the simulator's deps (prefer the backend venv).
PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  if   [ -x "$BACKEND/venv/Scripts/python.exe" ]; then PYTHON="$BACKEND/venv/Scripts/python.exe"
  elif [ -x "$BACKEND/venv/bin/python" ];        then PYTHON="$BACKEND/venv/bin/python"
  else PYTHON="python"; fi
fi

cd "$ROOT"

if [ "$DOWN" = 1 ]; then
  docker compose -f "$BASE" down
  exit 0
fi

echo ">> bringing up the stack: workers=$WORKERS host_port=$HOST_PORT"
STRESS_WORKERS="$WORKERS" STRESS_HOST_PORT="$HOST_PORT" \
  docker compose -f "$BASE" -f "$OVERLAY" up -d --force-recreate

echo ">> waiting for http://localhost:$HOST_PORT/health ..."
for _ in $(seq 1 40); do
  if [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' "http://localhost:$HOST_PORT/health" 2>/dev/null)" = "200" ]; then
    echo "   healthy"; break
  fi; sleep 1
done

if [ "$SEED" = 1 ]; then
  echo ">> seeding admin user (init_users)"
  docker exec fastapi sh -c "cd /opt/code && python -m scripts.init_users" >/dev/null 2>&1 || \
    echo "   (init_users failed)"
  # The administrator gets the password the simulator signs in with, read from standard input
  printf '%s\n' "${ADMIN_PASSWORD:?set ADMIN_EMAIL and ADMIN_PASSWORD}" | \
    docker exec -i fastapi sh -c 'cd /opt/code && python -m scripts.init_users --new-password "$1"' \
      _ "${ADMIN_EMAIL:?set ADMIN_EMAIL and ADMIN_PASSWORD}"
fi

if [ "$NORUN" = 1 ]; then
  echo ">> stack up on :$HOST_PORT (--no-run); simulator skipped"
  exit 0
fi

echo ">> running load simulator"
BASE_URL="http://localhost:$HOST_PORT" USERS="$USERS" DURATION="$DURATION" RAMP="$RAMP" \
  MCP_USERS="$MCP_USERS" API_MCP="$API_MCP" \
  WORKSPACE_AUTH_TOKEN="$(docker exec fastapi printenv WORKSPACE_AUTH_TOKEN)" \
  "$PYTHON" "$SCRIPT_DIR/load_simulator.py"
