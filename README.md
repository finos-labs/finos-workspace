# Workspace

Source code for Workspace and the components that build and run it.

## Layout

| Directory | What it is |
|---|---|
| `frontend/` | The Workspace frontend (React 18 + TypeScript + Vite) |
| `backend-api/` | Backend API (FastAPI + SQLAlchemy), admin CLI, and admin dashboard |
| `lite/` | Single-image Docker packaging of the backend and frontend |
| `local/` | Development stack with hot reload for the frontend and the API (`make up`); see [local/LOCAL_SETUP.md](local/LOCAL_SETUP.md) |
| `excel-add-in/` | The Add-in for Excel (Office.js, TypeScript/React) |

Each component keeps its own README with setup and development instructions.

## Running the whole stack

`docker-compose.yml` builds and starts everything: MySQL, Redis, the API, the background
worker, the web app and the admin panel.

```bash
(cd backend-api/backend && python3 -m scripts.create_local_env --admin-email <your-email>)
docker compose up --build        # on Apple silicon: PLATFORM=linux/arm64 docker compose up --build
```

`create_local_env` writes three files, none of which git tracks:

- `envs/.env` starts from `envs/.env.example`, points it at the compose services and fills in
  random keys: `JWT_SECRET`, `WORKSPACE_AUTH_TOKEN` (a JWT signed with it), `WORKSPACE_AES_KEY`
  (32 bytes, base64url: it encrypts the credentials stored in the database) and
  `LOCAL_STORAGE_SECRET_KEY`. It names the origins of the web app and the admin panel in
  `BACKEND_CORS_ORIGINS`.
- `scripts/cfgs/config.toml` names the organization (`--entity-name`) and the administrator that
  the first start creates. It holds no password.
- `user_create.json` starts empty. Compose mounts it into the containers and the first start fills it in.

It refuses to overwrite the first two unless you pass `--force`.

The web app is on <http://localhost:3000>, the admin panel on <http://localhost:3001> and the API on <http://localhost:8000>. The first start
creates the organization and the administrator listed in
`backend-api/backend/scripts/cfgs/config.toml`, without a password. Set it (typed twice, not shown):

```bash
docker compose run --rm init python -m scripts.init_users --new-password <your-email>
```

Then sign in with that email and password. Run the same command to set a new password; every
session of the account ends. No password is printed, logged or kept in a file.
`docker compose down -v` removes the databases too.

The web image is configured when the container starts: `BACKEND_URL` and `AI_API_URL` in `docker-compose.yml` become the
settings in `config.js`, and any other setting is one more `environment:` entry (the variable names are in
`frontend/render-frontend-config.sh`). To edit the code with hot reload instead, see `local/`.

## Notes

- The workflows in the root `.github/workflows/` are the ones GitHub Actions runs: the checks on pull requests
  (`frontend-checks.yml`, `backend-checks.yml`, `excel-add-in-checks.yml`, `admin-frontend-checks.yml`,
  `pr-description.yml`), the end-to-end tests (`e2e.yml`), the Docker images and build check (`backend-image.yml`,
  `frontend-image.yml`, `pr-build-check.yml`), the deployment to the dev environment (`deploy-dev.yml`, which builds
  the images and deploys them) and the production frontend deployment (`prod-deploy.yml`). The app's settings are
  defaults in its code; the values the dev environment sets differently are in the infrastructure repository. Each deployment file's header lists the repository variables and
  secrets it reads. The `.github/workflows/` files left inside `frontend/` are kept for reference; GitHub Actions only
  executes workflows from a repository's root `.github/` directory, so none of them run here as-is.
- Licensed under Apache-2.0 (see [LICENSE](LICENSE)). Individual components may carry additional notices in their own directories.
