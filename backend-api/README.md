# Backend

The backend and admin tooling of Workspace.

## Repository structure

| Directory | Description |
|---|---|
| `backend/` | FastAPI application: API server, database models, migrations, background workers |
| `admin_cli/` | CLI tool for managing users, entities, and backend operations |
| `admin_frontend/` | Admin dashboard (Vite + React); the root `docker-compose.yml` serves it on port 3001 |

## Getting started

To run the whole stack, follow the root [README](../README.md). See [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md) for local development of the backend itself.

## Infrastructure

- `docker-compose.yml`: full-stack deployment (API, workers, database, Redis)
- `docker-compose-local-dev.yml`: infrastructure only (MySQL, Redis, worker) for local backend development
- `docker-compose-local-dev-postgres.yml`, `docker-compose-local-dev-sqlite.yml`: the same on PostgreSQL and on SQLite
- `docker-compose-lite.yml`: the API on SQLite and Redis, built from `fastapi.lite.Dockerfile`
