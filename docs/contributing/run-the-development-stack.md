---
title: How to run the development stack
sidebar_position: 1
---

# How to run the development stack

The folder `local` of the repository starts everything that you need to work on the app on your own machine: the web app's development server, the API and its worker, MySQL and Valkey. A change to the code shows up without a restart. This guide starts the stack, sets the administrator's password and says how each kind of change reaches the running services. To run the finished images instead, as a user would, follow [Run FINOS Workspace on your machine](../technical-guide/build-from-source/run-the-stack-from-source.md). The two stacks both use port 8000, so run one at a time.

## Before you start

- Docker, running, with at least 8 GB of memory for Docker.
- Ports 3306, 6379, 8000 and 1420 free. The command that checks the machine fails and names the first port that is in use.
- `make`, which macOS and Linux provide. On Windows, use WSL.
- `python3`, only the first time and only its standard library, to write the settings.

Nothing else is needed, because the API and Node run in containers. The images of this stack are public ones, so it needs no login to a container registry, unlike the stack at the root of the repository.

## Start the stack

In the folder `local`, name the first administrator and start everything:

```bash
ADMIN_EMAIL=<your-email> make up
```

The address is needed only while `backend-api/backend/envs/.env` does not exist. The first run creates that file with random secrets, and it writes `backend-api/backend/scripts/cfgs/config.toml` with the organization and the administrator's address. Both files are yours, and neither belongs in git. Later runs need only `make up`.

The first run builds the backend images and installs the packages of the web app, so it takes several minutes. `make up` waits until the app answers and then prints where to go: the app at `http://localhost:1420` and the API at `http://localhost:8000`.

## Set the administrator's password

The `init` step creates the administrator without a password. Set one before the first sign-in, while the stack runs, in the folder `local`:

```bash
docker compose run --rm init python -m scripts.init_users --new-password <your-email>
```

The command asks for the password twice and does not show it. The same command sets a new password later, and it ends every session of the account. The password is in the database, so stopping and starting the stack keeps it, and `make reset` deletes it with the database. Then sign in at `http://localhost:1420` with the address that you named.

## What runs

| Service | Port | What it is |
|---|---|---|
| `frontend` | 1420 | The Vite development server for `frontend` |
| `backend` | 8000 | The API, from `backend-api/backend` |
| `backend-worker` | | The background jobs, from the same code as the API |
| `init` | | Runs once at every start: the database migrations, then the administrator and the organization |
| `mysql` | 3306 | The database, with the user `root`, the password `root` and the database `workspace` |
| `valkey` | 6379 | The cache and the job queue |

## Work on the code

- **The web app.** The browser reloads when you save a file.
- **The API.** It restarts when you save a file.
- **The worker.** It does not reload. Run `make restart s=backend-worker`.
- **Database migrations.** `init` applies new ones at every `make up`, as [How to add a database migration](add-a-database-migration.md) describes.
- **Python dependencies.** `make up` builds the backend images again.
- **Packages of the web app.** `make restart s=frontend` runs the install again.
- **Settings.** The API reads `backend-api/backend/envs/.env`, the same file that the root stack uses. Edit it, then run `make restart s=backend`. The web app reads `frontend/.env`.

These commands run in the folder `local`, or from the root as `make -C local <command>`:

| Command | What it does |
|---|---|
| `make up` | Checks the machine, builds, starts everything and waits until the app answers. |
| `make down` | Stops everything and keeps the data. |
| `make logs` | Follows all the logs, and `make logs s=backend` follows one service. |
| `make ps` | Shows what runs. |
| `make restart s=<service>` | Restarts one service. |
| `make shell s=<service>` | Opens a shell in a service, in `backend` by default. |
| `make reset` | Deletes the local database and the installed packages, and starts again. |
| `make doctor` | Checks Docker, Docker Compose and the ports without starting anything. |

On Apple silicon, the backend images are built for `linux/amd64` as the deployed ones are. Set `PLATFORM=linux/arm64`, for example `PLATFORM=linux/arm64 make up`, to build for your machine.

## What is different from a deployment

The stack runs plain HTTP on `localhost` with one port per service, a single copy of each service, and a database and a cache without TLS and with a fixed password. The web app runs the Vite development server in place of the finished image. Files that users upload go to `backend-api/backend/local_storage`, because `STORAGE_PROVIDER` is `folder`.

The Agent does not work in this stack, because it does not run the agent Ines: `AI_API_URL` stays empty and `AI_COPILOT_ENABLED` stays `false`. The root stack runs Ines. Sign in with the address and the password, and not with Google, unless `http://localhost:1420` is an allowed origin of your Google client.

## When something fails

- **`make doctor` says that a port is in use.** Stop what holds it, such as the root stack, which uses port 8000.
- **`make up` says that the init step failed.** `make logs s=init` shows why.
- **The app loads but the sign-in fails.** `make logs s=backend` shows the request and the error.
- **You want to start from scratch.** `make reset` deletes the local database, and you set the password again.
