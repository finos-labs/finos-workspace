# Stress / load tests

A repeatable, multi-user load simulator for the backend + Workspace MCP, plus a launcher that
brings up the topology you want to test.

> These are **manual** load tests against a running stack — not part of the pytest suite. The
> pytest regression tests (`tests/test_bridge_load.py`, `tests/test_runtime_metrics.py`,
> `tests/test_workspace_mcp_bridge.py`) stay where they are.

## Contents

| file | purpose |
|---|---|
| `run_stress.sh` | launcher — brings up the MySQL dev stack with a chosen worker count and runs the simulator |
| `load_simulator.py` | the load generator (realistic multi-user Workspace MCP traffic) |
| `docker-compose.stress.yml` | one parameterized overlay (workers + Prometheus), layered on a base stack |

## Prerequisites

- Docker + `docker compose`.
- A Python with `aiohttp` and `websockets` for the simulator. The launcher auto-uses the backend
  venv (`backend/venv`) if present; otherwise set `PYTHON=/path/to/python`.
- Run from a bash shell (Git Bash on Windows).

## Quick start

```bash
cd backend/tests/stress

# 3 workers, 80 users — the production-representative run
./run_stress.sh --workers 3 --users 80

# MCP-impact A/B: hold API load fixed, add a pool of MCP-only hammerers
./run_stress.sh --workers 3 --users 80 --mcp-users 0  --api-mcp 0   # baseline
./run_stress.sh --workers 3 --users 80 --mcp-users 40 --api-mcp 0   # + MCP load

# Just bring the stack up (no load), or tear it down
./run_stress.sh --workers 1 --no-run
./run_stress.sh --down
```

## Flags

| flag | default | meaning |
|---|---|---|
| `--workers` | `1` | uvicorn worker processes |
| `--users` | `40` | simulated API users |
| `--duration` | `20` | seconds |
| `--ramp` | `5` | stagger user arrival over this many seconds (avoids a thundering herd) |
| `--mcp-users` | `0` | extra MCP-only users layered on top (for measuring MCP's impact on the API) |
| `--api-mcp` | `1` | `0` makes the API users pure-API (no MCP in their mix) — use for the A/B above |
| `--seed` | off | run `init_users` to create the admin user (needed once on a fresh DB) |
| `--no-run` | off | bring the stack up but skip the simulator |
| `--down` | off | tear the stack down and exit |

The simulator authenticates as the administrator that `ADMIN_EMAIL` and `ADMIN_PASSWORD` name; both
are required. With `--seed`, that is the administrator listed in `scripts/cfgs/config.toml`
(write it with `python -m scripts.create_local_env --admin-email <your-email>`), and the seed step
sets their password to `ADMIN_PASSWORD` (read from standard input, never printed). Every
simulated user comes from one address, so they send the stack's `WORKSPACE_AUTH_TOKEN` as
`X-Workspace-Authorization` and the stress overlay sets `RATE_LIMIT_EXEMPT_ENABLED=1`, which lets
that token skip rate limiting (development stacks only; set both yourself for a stack you started
another way). The simulated users are the web app: they ride its session cookie with its client header and the
origin `ORIGIN` (default `http://localhost:3000`), which must be one of the stack's
`BACKEND_CORS_ORIGINS`.

## What it does

Each simulated user logs in, opens a bridge WebSocket (an auto-answering "browser tab"), and loops a
weighted mix of real endpoints: `validate-and-sync` (once, the dashboard-open aggregation),
`dash/sync` (save), the read endpoints (`api-source`, `apps`, `shared`, `resource-permissions`),
`display-settings`, and Workspace MCP tool calls over `/mcp`. A `--mcp-users` pool can add MCP-only
load to isolate the MCP server's impact on the rest of the API.

## Reading the output

The simulator prints, per action: count, `ok%`, p50/p95 latency, and HTTP status distribution.
Then it reports the live runtime gauges scraped from `/metrics`:

- `db_pool_connections` — checked-out connections per engine pool (n/a for SQLite — `StaticPool`).
- `threadpool_tokens` — worker thread-pool occupancy.
- `event_loop_lag_seconds` — event-loop scheduling delay (the main "something is blocking the loop"
  signal).
