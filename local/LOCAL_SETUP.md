# Running OpenBB Workspace locally

Everything for running the app on your own machine lives in this folder. One command starts the frontend, the backend API and its worker, MySQL and Redis. Code edits show up without restarting anything.

## Before you start

- Docker Desktop, running, with at least 8 GB of memory for Docker (Settings, Resources).
- Ports 3306, 6379, 8000 and 1420 free.
- `make`, which comes with macOS (Xcode command line tools) and Linux. On Windows, use WSL.

Nothing else: Python, Node and Bun run inside the containers.

## Start

```sh
cd local
make up
```

The first run builds the backend images and installs the frontend packages, so it takes several minutes. Later runs reuse the images and start much faster. `make up` waits until the app answers and then prints the login:

- App: <http://localhost:1420>
- Login: `admin@openbb.co` / `asdQWE123!`
- Backend: <http://localhost:8000>

## Signing up a new user

You can sign up new users locally, but no email ever reaches an inbox, so the app's "check your inbox" message will not come true. Here is why, and what to do instead.

### Where the email goes

When someone signs up, the backend prepares an email with two things in it: a link that activates the account, and a temporary password.

- In production, the backend hands that email to Mailchimp, which delivers it.
- On your machine, the backend is not in production mode, so it never contacts Mailchimp. It writes the email into its log instead (the running text output you see with `make logs`).

The email exists; it went to the backend's log instead of your inbox. `make emails` reads that log and prints the parts you need.

### Steps

1. Open <http://localhost:1420>, choose sign up and enter an email address. It does not need to be a real one.
2. In a terminal, run `make emails` in this folder. You get one entry per sign-up, newest last:

   ```text
   jane@example.org
     link:      http://localhost:8000/pro/create-account/8dd64e4e-...?email=jane%40example.org
     password:  XgsmxShfVoWLir2^

   Newest last. Open the link, then log in with the email address and the password.
   ```

3. Open the `link` in your browser. It activates the account and takes you to the login page.
4. Log in with the email address and the `password`. The app then asks you to choose your own password.

### Password reset

Password reset links can't be used locally. The reset email does reach the log, but the backend's log filter replaces the secret part of the link with `********`. If you lose the password of a local test account, sign up again with another address, or start fresh with `make reset`.

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
| `make emails` | For each sign-up: the email address, the activation link and the temporary password (see [Signing up a new user](#signing-up-a-new-user)) |
| `make reset` | Deletes the local database and frontend packages, then starts again |
| `make doctor` | Checks Docker, Docker Compose and the ports without starting anything |

Without `make`, use Docker Compose directly from this folder: `./dev.sh env` once, then `docker compose up --build -d`, `docker compose down`, `docker compose logs -f` and so on.

## What runs

| Service | Port | What it is |
|---|---|---|
| `frontend` | 1420 | Vite dev server for `frontend/` |
| `backend` | 8000 | FastAPI app from `backend-api/backend/` |
| `backend-worker` | | Background jobs (RQ), same code as the backend |
| `init` | | Runs once per start: database migrations, then the admin user and its entity |
| `mysql` | 3306 | Database, user `root`, password `root`, database `user_db` |
| `redis` | 6379 | Cache and job queue |

## Making changes

- Frontend code: the browser reloads on save.
- Backend code: the API restarts itself on save.
- Worker code: the worker does not reload; run `make restart s=backend-worker`.
- Database migrations: `init` applies new ones on every `make up`.
- Python dependencies (`pyproject.toml`): `make up` rebuilds the backend images.
- Frontend dependencies (`package.json`): `make restart s=frontend` runs `bun install` again.

## Settings

The backend reads `local/backend.env`. The first `make up` creates it from `backend-api/backend/envs/.env.example` and changes these values for local use:

| Setting | Local value | Why |
|---|---|---|
| `MODE` | `onprem` | The mode the backend's own development guide uses |
| `SELFURL`, `FRONTENDURL`, `PROURL` | `http://localhost:8000`, `http://localhost:1420`, `http://localhost:1420` | Links in emails and redirects after sign-up point at your machine |
| `DB_HOST`, `REDIS_HOST` | `mysql`, `redis` | The container names |
| `DB_NAME` | `user_db` | The database the MySQL container creates |
| `SSL_CA`, `SSL_CERT`, `SSL_KEY` | empty | The template holds placeholder paths; local MySQL has no TLS |
| `STORAGE_PROVIDER` | `folder` | Uploaded files go to `backend-api/backend/local_storage/` instead of S3 |
| `HUBSPOT` | `0` | No calls to HubSpot |
| `JWT_SECRET`, `OPENBB_AUTH_TOKEN` | generated | The backend checks browser requests against `OPENBB_AUTH_TOKEN`, a JWT that must be signed with `JWT_SECRET`; the template's values are placeholders |

`backend.env` is gitignored and belongs to your machine, so edit it freely, then `make restart s=backend`. To get a fresh one, delete it and run `make up`.

The frontend uses `frontend/.env`, except for two things `compose.yaml` overrides: the backend, SDK and AI URLs point at `localhost`, and the sign-up screen is on (`VITE_AUTHENTICATION_ALLOW_REGISTRATION`).

A new backend setting needs adding in more places than this folder. Locally it goes in `backend-api/backend/envs/.env.example`. For bq-dev it goes in `BQ/dev/apps/values.yaml` in `workspace-infra`, or in the `bq-dev/backend` secret if it's sensitive. Prod has its own config in `BQ/prod/apps/backend.tf`.

## What does not work locally

- Ticker search, charts and market data. They need the SDK service, which this setup does not run yet.
- AI features. They need the AI service, which this setup does not run yet.
- Google sign-in, unless `http://localhost:1420` is an allowed origin of the Google OAuth client. Use email sign-up and login.
- Real emails. The backend logs them instead; `make emails` shows them.
- Payments. Stripe and Chargebee are not set up.

## Differences from bq-dev and prod

- Plain `http://localhost` with one port per service, instead of HTTPS hostnames behind a load balancer.
- The frontend runs the Vite dev server instead of the nginx image, which writes its settings into `config.js` at start.
- MySQL 8.0 here; RDS runs MySQL 8.4.
- Redis without TLS or a password; bq-dev's Valkey requires both.
- One copy of each service.
- The backend images are built for `linux/amd64`, like the ones deployed, so Apple Silicon Macs run them under emulation.

## Troubleshooting

- `make doctor` says a port is in use: stop whatever holds it (the message prints the `lsof` command that shows it), or stop another project's containers.
- `make up` stops with "the init step failed": `make logs s=init` shows why.
- The app loads but login fails: `make logs s=backend` shows the request and the error.
- Start from scratch: `make reset`. This deletes the local database.
