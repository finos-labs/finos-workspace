# Running the Workspace locally for development

Everything for working on the app on your own machine lives in this folder. One command starts the frontend, the backend API and its worker, MySQL and Redis, and code edits show up without restarting anything.

To run the built images instead (web app, admin panel and API, as a user would), use `docker-compose.yml` at the repository root; its [README section](../README.md#running-the-whole-stack) explains it. The two stacks use port 8000, so run one at a time.

## Before you start

- Docker Desktop, running, with at least 8 GB of memory for Docker (Settings, Resources).
- Ports 3306, 6379, 8000 and 1420 free.
- `make`, which comes with macOS (Xcode command line tools) and Linux. On Windows, use WSL.
- `python3`, only the first time and only its standard library: it writes the settings.

Nothing else: the backend, Node and Bun run inside the containers.

## Start

```sh
cd local
ADMIN_EMAIL=<your-email> make up
```

`ADMIN_EMAIL` names the first administrator. It is needed only while `backend-api/backend/envs/.env` does not exist; the first `make up` creates that file with random secrets, and `backend-api/backend/scripts/cfgs/config.toml` with the organization and the administrator, whose password is random. Both files are yours: neither is for git. Later runs only need `make up`.

The first run builds the backend images and installs the frontend packages, so it takes several minutes. Later runs reuse the images and start much faster. `make up` waits until the app answers and then prints where to go:

- App: <http://localhost:1420>
- Backend: <http://localhost:8000>
- Sign in as the administrator in `backend-api/backend/scripts/cfgs/config.toml` (email and password).

## Commands

Run these in this folder, or from the repo root as `make -C local <command>`.

| Command | What it does |
|---|---|
| `make up` | Checks your machine, builds, starts everything and waits until the app answers |
| `make down` | Stops everything and keeps the data |
| `make logs` | Follows all logs; `make logs s=backend` follows one service |
| `make ps` | Shows what is running |
| `make restart s=<service>` | Restarts one service |
| `make shell s=<service>` | Opens a shell in a service (default: `backend`) |
| `make reset` | Deletes the local database and frontend packages, then starts again |
| `make doctor` | Checks Docker, Docker Compose and the ports without starting anything |

Without `make`, use Docker Compose directly from this folder: `docker compose up --build -d`, `docker compose down`, `docker compose logs -f` and so on, after `./dev.sh env` has written the settings once.

## What runs

| Service | Port | What it is |
|---|---|---|
| `frontend` | 1420 | Vite dev server for `frontend/` |
| `backend` | 8000 | FastAPI app from `backend-api/backend/` |
| `backend-worker` | | Background jobs (RQ), same code as the backend |
| `init` | | Runs once per start: database migrations, then the administrator and the organization |
| `mysql` | 3306 | Database, user `root`, password `root`, database `workspace` |
| `redis` | 6379 | Cache and job queue |

The admin panel (`backend-api/admin_frontend`) is not part of this stack; it runs in the root `docker-compose.yml`.

## Making changes

- Frontend code: the browser reloads on save.
- Backend code: the API restarts itself on save.
- Worker code: the worker does not reload; run `make restart s=backend-worker`.
- Database migrations: `init` applies new ones on every `make up`.
- Python dependencies (`pyproject.toml`): `make up` rebuilds the backend images.
- Frontend dependencies (`package.json`): `make restart s=frontend` runs `bun install` again.

## Settings

The backend reads `backend-api/backend/envs/.env`, the same file the root `docker-compose.yml` uses. `scripts.create_local_env` writes it from `envs/.env.example` and changes these values:

| Setting | Value | Why |
|---|---|---|
| `MODE` | `onprem` | The mode the backend's own development guide uses |
| `SELFURL` | `http://localhost:8000` | Links the backend builds point at the API |
| `DB_HOST`, `REDIS_HOST` | `mysql`, `redis` | The container names |
| `DB_NAME` | `workspace` | The database the MySQL container creates |
| `STORAGE_PROVIDER` | `folder` | Uploaded files go to `backend-api/backend/local_storage/` instead of cloud storage |
| `JWT_SECRET`, `WORKSPACE_AES_KEY`, `WORKSPACE_AUTH_TOKEN`, `LOCAL_STORAGE_SECRET_KEY` | generated | `WORKSPACE_AUTH_TOKEN` is a JWT signed with `JWT_SECRET`; the example's values are placeholders |

`compose.yaml` overrides `FRONTENDURL` and `APPURL` with `http://localhost:1420`, the address of the dev server, so links and redirects point at it. The example file turns CORS off (`DISABLE_CORS=1`), which the dev server on another port relies on.

Edit `envs/.env` freely, then `make restart s=backend`. To get a fresh one, delete it, and `config.toml` next to it, and run `ADMIN_EMAIL=<your-email> make up`; if the database already holds the old administrator, run `make reset` instead.

The frontend uses `frontend/.env`, except that `compose.yaml` points the backend and AI URLs at `localhost`.

A new backend setting needs adding in more places than this folder: `envs/.env.example` for local runs, and the values of every environment you deploy to.

## What does not work locally

- AI features. They need an AI service, which this setup does not run; `AI_API_URL` stays empty and `AI_COPILOT_ENABLED` stays `false`. The root `docker-compose.yml` runs Ines, the Workspace's agent.
- Google sign-in, unless `http://localhost:1420` is an allowed origin of the Google OAuth client. Use the email sign-in.

## Differences from a deployed environment

- Plain `http://localhost` with one port per service, instead of HTTPS hostnames behind a load balancer.
- The frontend runs the Vite dev server instead of the nginx image, which writes its settings into `config.js` at start.
- One copy of each service.
- MySQL with the password `root` and Redis without a password, both without TLS.
- The backend images are built for `linux/amd64`, like the ones deployed; on Apple silicon set `PLATFORM=linux/arm64` (for example `PLATFORM=linux/arm64 make up`) to build for the host.

## Troubleshooting

- `make doctor` says a port is in use: stop whatever holds it (the message prints the `lsof` command that shows it), or stop another stack. The root `docker-compose.yml` stack also uses port 8000: `docker compose down` there.
- `make up` stops with "the init step failed": `make logs s=init` shows why.
- The app loads but login fails: `make logs s=backend` shows the request and the error.
- Start from scratch: `make reset`. This deletes the local database.
