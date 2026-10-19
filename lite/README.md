# The Workspace as one Docker image

A single image that bundles the FastAPI backend, the `workspace` web app, Redis, nginx and supervisord. It defaults to SQLite, generates its own secrets on first start and creates the first administrator, so running it takes one command.

## Quick start

Build the image (see [Building the image](#building-the-image)), then:

```bash
docker run -d -p 3000:3000 \
  -v workspace-data:/data \
  -e WORKSPACE_ADMIN_EMAIL=<your-email> \
  --name workspace \
  <image>
```

Open <http://localhost:3000> and sign in as the address you gave. The password is generated on first start; print it any time with:

```bash
docker exec workspace credentials
```

It is stored in `/data/secrets.env` inside the container, and therefore in the `workspace-data` volume, so it survives restarts. It is also printed at the end of the startup logs (`docker logs workspace --tail 15`).

`WORKSPACE_ADMIN_EMAIL` has no default: the container stops with a message if it is missing.

To run on another port (8080, say), map it: `-p 8080:3000`.

## Overriding configuration

Every value the image generates can be replaced with `-e` at run time. Whatever you pass wins; the image only fills in what is missing.

### The administrator and the organization

```bash
docker run -d -p 3000:3000 \
  -v workspace-data:/data \
  -e WORKSPACE_ADMIN_EMAIL=<your-email> \
  -e WORKSPACE_ADMIN_PASSWORD=<a password> \
  -e WORKSPACE_ENTITY_NAME=<the name of your organization> \
  <image>
```

`WORKSPACE_ENTITY_NAME` defaults to `Workspace`. A password you choose has to meet the sign-in form's rules: at least 8 characters with an upper-case letter, a lower-case letter, a digit and a special character, and no spaces.

### Bring your own database (Postgres / MySQL)

```bash
docker run -d -p 3000:3000 \
  -e WORKSPACE_ADMIN_EMAIL=<your-email> \
  -e DATABASE_TYPE=postgresql \
  -e DB_HOST=<database host> \
  -e DB_PORT=5432 \
  -e DB_NAME=<database> \
  -e WRITE_DB_USER=<user> \
  -e WRITE_DB_PASSWORD=<password> \
  -e READ_DB_USER=<user> \
  -e READ_DB_PASSWORD=<password> \
  <image>
```

MySQL works the same way with `DATABASE_TYPE=mysql` and `DB_PORT=3306`.

### External Redis

```bash
docker run -d -p 3000:3000 \
  -e WORKSPACE_ADMIN_EMAIL=<your-email> \
  -e REDIS_HOST=<redis host> \
  -e REDIS_PORT=6379 \
  -e REDIS_PASS=<password> \
  <image>
```

Redis still runs *inside* the container as well; it is harmless and lets the image stay self-contained. To skip the embedded one, edit `supervisord.conf` and rebuild.

### Custom secrets

By default the image generates `JWT_SECRET`, `WORKSPACE_AUTH_TOKEN`, `WORKSPACE_AES_KEY` and `LOCAL_STORAGE_SECRET_KEY` on first start and persists them to `/data/secrets.env`. To bring your own, pass any of them with `-e`:

```bash
docker run -d -p 3000:3000 \
  -e JWT_SECRET=$(openssl rand -hex 48) \
  -e WORKSPACE_AES_KEY=$(openssl rand -hex 8) \
  ...
```

`WORKSPACE_AUTH_TOKEN` must be a JWT (HS256) signed with `JWT_SECRET`. If you set `JWT_SECRET` without providing `WORKSPACE_AUTH_TOKEN`, the image mints a matching token for you.

### The web app's settings

The web app reads `/config.js` when it loads. The image writes that file at every start with [`render_frontend_config.py`](./render_frontend_config.py), from two things the build leaves in the image: the `config.js` it wrote, and `config.env.json`, which names the environment variable of every setting. Pass any of those variables with `-e` and it replaces its setting; the rest keep the value they were built with. The variables are the `VITE_*` ones of [`workspace/.env`](../workspace/.env), which lists each setting with a comment and its default, for example:

| Variable | What it sets |
| --- | --- |
| `VITE_BACKEND_URL` | Where the app finds the backend (`/api` in this image: nginx proxies it) |
| `VITE_AI_API_URL` | The AI service the Copilot talks to |
| `VITE_DOCS_URL` | The documentation site (empty: links to it are hidden) |
| `VITE_SUPPORT_EMAIL` | Where users are sent for help (empty: no address is shown) |
| `VITE_AUTHENTICATION_IDENTITY_PROVIDERS` | Single sign-on providers to offer (`google`, `microsoft`, `okta`) |

A variable that is not a setting is reported in the startup logs and ignored. To start from a `config.js` of your own instead of the built one, mount it over the file the renderer reads (the renderer writes `/usr/share/nginx/html/config.js`, so that path cannot be mounted):

```bash
docker run -d -p 3000:3000 \
  -v $(pwd)/my-config.js:/usr/local/share/workspace/config.js:ro \
  -v workspace-data:/data \
  -e WORKSPACE_ADMIN_EMAIL=<your-email> \
  <image>
```

## Building the image

The Dockerfile and container config live here; the backend comes from `backend-api/backend` and the frontend from `frontend/` in this repository. The build copies both source trees next to the Dockerfile, then builds.

### In CI (GitHub Actions)

The [`Build & publish`](./.github/workflows/build.yml) workflow assembles the context from the checked-out repository and builds and pushes a multi-arch image to GHCR as `<owner>/lite` (set the `LITE_IMAGE` repository variable to publish under another name). Run it from the **Actions** tab (`workflow_dispatch`) on any branch or tag:

- `push_image`: uncheck to build without pushing.
- `tag`: an extra image tag.

The image push uses the built-in `GITHUB_TOKEN`. The workflow runs from the repository root's `.github/workflows/`.

### Locally

Use [`build-local.sh`](./build-local.sh), which copies the sources and runs a single-arch `docker build --load`:

```bash
./build-local.sh
./build-local.sh --platform linux/amd64
```

To publish a multi-arch image from your machine, use [`publish.sh`](./publish.sh) with the registry namespace to publish under:

```bash
ORG=<namespace> ./publish.sh
```

The assembled `backend/` and `frontend/` directories are git-ignored, so they won't pollute this repository.

## What's inside the container

- `nginx` on `${PORT}` (default 3000). Serves the web app and reverse-proxies `/api/*` to the backend at `127.0.0.1:8000`, stripping the `/api` prefix.
- `uvicorn` running the FastAPI backend on `127.0.0.1:8000`.
- `redis-server` on `127.0.0.1:6379`, dumping to `/data/redis`.
- `supervisord` as the child of tini (PID 1).

All three are managed by [supervisord.conf](./supervisord.conf). nginx and redis log to stdout and stderr, so `docker logs` shows everything.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage build (frontend, backend, runtime) |
| `entrypoint.sh` | Secret bootstrap, migrations, administrator, then supervisord |
| `supervisord.conf` | Runs redis, uvicorn and nginx |
| `nginx.conf.template` | Site config; `${PORT}` is substituted on start |
| `render_frontend_config.py` | Writes `/usr/share/nginx/html/config.js` from the environment |
| `credentials.sh` | `docker exec <container> credentials`: prints the administrator's login |
| `import.sh` | `docker exec <container> workspace-import <archive>`: imports an exported account |
| `installation-guide.md`, `enduser-steps.md` | Pulling the image from a private registry, and running it |
| `.github/workflows/build.yml` | CI: assemble the source, build and push to GHCR |
| `build-local.sh` | Local build helper (assembles the context, single-arch `--load`) |
| `publish.sh` | Local multi-arch build and push to a registry (GHCR by default) |
| `VERSION` | Image version tag |
