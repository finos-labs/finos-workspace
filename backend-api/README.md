# Backend

The backend and admin tooling of Workspace.

## Repository structure

| Directory | Description |
|---|---|
| `backend/` | FastAPI application: API server, database models, migrations, background workers |

## Getting started

To run the whole stack, follow the root [README](../README.md). See [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md) for local development of the backend itself.

## Infrastructure

- `docker-compose.yml`: full-stack deployment (API, workers, database, Redis)
- `docker-compose-local-dev.yml`: infrastructure only (MySQL, Redis, worker) for local backend development
- `docker-compose-local-dev-postgres.yml`, `docker-compose-local-dev-sqlite.yml`: the same on PostgreSQL and on SQLite
- `docker-compose-lite.yml`: the API on SQLite and Redis, built from `fastapi.lite.Dockerfile`

## Admin CLI

`backend/scripts/workspace_admin.py` manages entities, entity types, users and data
backends. It runs inside the API container and works on the database itself: it sends no
request to the API, so it needs no sign-in.

```bash
docker compose exec api python -m scripts.workspace_admin --help    # the root docker-compose.yml
docker exec workspace workspace-admin --help                         # Lite
```

| Command | Does |
|---|---|
| `entity create --config <file>`, `entity list`, `entity show <uuid>`, `entity update <uuid> --data '<json>'`, `entity delete <uuid>` | Entities; `entity sample` prints a config |
| `entity-type create --name <name> --code <code>`, `entity-type list` | Entity types |
| `user create <entity-uuid> --email <email> --first-name <name> --last-name <name> [--role admin\|developer\|user]` | Prints the link with which the user sets their password (once, within 24 hours) |
| `user reset-password <email>` | The password stops working, every session ends; prints the link that sets a new one |
| `user list [--email <part>]`, `user move --entity-uuid <uuid> --email <email> [--role ...]`, `user delete <email>` | `delete` removes the user from their entity |
| `user export <email> [--out <dir>] [--with-files] [--include-history]` | Writes the account's archive in the container and prints its export key once; `docker compose cp api:/opt/code/exports .` copies it out |
| `data-backend add <entity-uuid> --name <name> --url <url> [--header key:value[:location]]`, `data-backend list <entity-uuid>`, `data-backend delete <entity-uuid> --name <name>` | Data backends of an entity |
| `provision check --config <file>`, `provision apply --config <file>` | An entity with its admins and users in one go; `provision sample` prints a config |

`--json` prints the outcome as JSON. A refused action prints why and exits with 1.
