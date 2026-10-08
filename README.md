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

`create_local_env` writes two files, neither of which git tracks:

- `envs/.env` starts from `envs/.env.example`, points it at the compose services and fills in
  `JWT_SECRET`, `WORKSPACE_AUTH_TOKEN` (a JWT signed with it) and `WORKSPACE_AES_KEY` (16 characters).
- `scripts/cfgs/config.toml` names the organization (`--entity-name`) and the administrator that
  the first start creates. The administrator's password is random and is kept in that file;
  `--admin-password` chooses one instead.

It refuses to overwrite either file unless you pass `--force`.

The web app is on <http://localhost:3000>, the admin panel on <http://localhost:3001> and the API on <http://localhost:8000>. The first start
creates the organization and the administrator listed in
`backend-api/backend/scripts/cfgs/config.toml`; sign in with that email and password.
`docker compose down -v` removes the databases too.

The web image is configured when the container starts: `BACKEND_URL` and `AI_API_URL` in `docker-compose.yml` become the
settings in `config.js`, and any other setting is one more `environment:` entry (the variable names are in
`frontend/render-frontend-config.sh`). To edit the code with hot reload instead, see `local/`.

## Notes

- The workflows in the root `.github/workflows/` are the ones GitHub Actions runs: the end-to-end tests (`e2e.yml`),
  the pull request build checks and Docker images (`pr-build-check.yml`, `backend-image.yml`, `frontend-image.yml`), the
  deployment to the dev environment (`deploy-dev.yml`) and the production frontend deployment (`prod-deploy.yml`).
  Each file's header lists the repository variables and secrets it reads. The `.github/workflows/` files inside each
  component are kept for reference; GitHub Actions only executes workflows from a repository's root `.github/`
  directory, so none of them run here as-is.
- Licensed under Apache-2.0 (see [LICENSE](LICENSE)). Individual components may carry additional notices in their own directories.
