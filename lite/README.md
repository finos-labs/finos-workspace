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

The first start creates that account without a password. Set it (typed twice, not shown):

```bash
docker exec -it workspace credentials
```

Then open <http://localhost:3000> and sign in. Run the same command to set a new password; every session of the account ends. No password is printed, logged or kept in a file.

`WORKSPACE_ADMIN_EMAIL` has no default: the container stops with a message if it is missing.

To run on another port (8080, say), map it, and name the address the browser opens: `-p 8080:3000 -e BACKEND_CORS_ORIGINS='["http://localhost:8080"]'`. The API accepts a signed-in request only from that origin (`http://localhost:3000` by default); for a host name, give it as the browser shows it, e.g. `https://<your-host>`.

## Overriding configuration

Every value the image generates can be replaced with `-e` at run time. Whatever you pass wins; the image only fills in what is missing.

### The administrator and the organization

```bash
docker run -d -p 3000:3000 \
  -v workspace-data:/data \
  -e WORKSPACE_ADMIN_EMAIL=<your-email> \
  -e WORKSPACE_ENTITY_NAME=<the name of your organization> \
  <image>
```

`WORKSPACE_ENTITY_NAME` defaults to `Workspace`. The volume remembers both, so later starts can leave them out. There is no setting for the administrator's password: `docker exec -it workspace credentials` sets it.

### Sign-in providers

To offer Google, Microsoft or Okta sign-in, set the web app's settings for them (`VITE_AUTHENTICATION_IDENTITY_PROVIDERS` and the provider's `VITE_*_CLIENT_ID` and the like, below) and pass the API the same public values: `-e GOOGLE_OAUTH_CLIENT_ID=...`, `-e AZURE_CLIENT_ID=... -e AZURE_TENANT_ID=...`, or `-e OKTA_CLIENT_ID=... -e OKTA_DOMAIN=...` (the Okta issuer, exactly as in `VITE_OKTA_DOMAIN`). A provider the API has no values for refuses every sign-in. `AZURE_TENANT_ID` is the tenant's id or domain, or `organizations` or `common`. The Entra app registration must send the optional ID-token claims `email` and `xms_edov`, or a Microsoft sign-in by email is refused. See [`envs/.env.example`](../backend-api/backend/envs/.env.example).

### MCP servers on a private network

The API reaches users' MCP servers only at public internet addresses. Name any MCP server it should reach on your network, or on the Docker host, by the host name in its URL: `-e ALLOWED_MCP_HOSTNAMES='["host.docker.internal"]'`.

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

By default the image generates `JWT_SECRET`, `WORKSPACE_AES_KEY` and `LOCAL_STORAGE_SECRET_KEY` on first start and keeps them in `/data/secrets.env`, on the data volume, so that they stay the same across restarts and upgrades. To bring your own, pass any of them with `-e` (or `--env-file`); a key you pass is used as given and is never written to the volume:

```bash
docker run -d -p 3000:3000 \
  -e JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))") \
  -e WORKSPACE_AES_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))") \
  -e LOCAL_STORAGE_SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))") \
  ...
```

`WORKSPACE_AES_KEY` encrypts the credentials stored in the database (AES-256-GCM): it must be base64url and decode to at least 32 bytes, as above. `JWT_SECRET` and `LOCAL_STORAGE_SECRET_KEY` must be at least 32 characters. The API refuses to start otherwise. Pass the same values at every start: data stored under one `WORKSPACE_AES_KEY` cannot be read with another.

A copy of a volume whose keys the image generated (a backup, a snapshot, a migration archive) holds `secrets.env` next to the database, so whoever has the copy can decrypt the credentials in it. To keep the key off the volume, pass it with `-e` and keep it in your own secret store; to move a generated key there, read it from `/data/secrets.env` once and pass it from then on, and the next start removes it from the file.

`WORKSPACE_AUTH_TOKEN` must be a JWT (HS256) signed with `JWT_SECRET`. Unless you pass one, the image mints it from `JWT_SECRET` at every start.

### The web app's settings

The web app reads `/config.js` when it loads. The image writes that file at every start with [`render_frontend_config.py`](./render_frontend_config.py), from two things the build leaves in the image: the `config.js` it wrote, and `config.env.json`, which names the environment variable of every setting. Pass any of those variables with `-e` and it replaces its setting; the rest keep the value they were built with. The variables are the `VITE_*` ones of [`frontend/.env`](../frontend/.env), which lists each setting with a comment and its default, for example:

| Variable | What it sets |
| --- | --- |
| `VITE_BACKEND_URL` | Where the app finds the backend (`/api` in this image: nginx proxies it) |
| `VITE_AI_API_URL` | The AI service the Copilot talks to |
| `VITE_MARKETPLACE_URL` | A remote marketplace to list apps from (empty: this backend) |
| `VITE_DOCS_URL` | The documentation site (empty: links to it are hidden) |
| `VITE_SUPPORT_EMAIL` | Where users are sent for help (empty: no address is shown) |
| `VITE_AUTHENTICATION_IDENTITY_PROVIDERS` | Single sign-on providers to offer (`google`, `microsoft`, `okta`) |
| `VITE_UI_SHOW_MARKETPLACE` | Show the Apps Marketplace tab |

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

All three are managed by [supervisord.conf](./supervisord.conf), and their output goes to `docker logs`. nginx's access log is `/var/log/nginx/access.log` in the container; it names each request's path and leaves out query strings, which can carry credentials.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage build (frontend, backend, runtime) |
| `entrypoint.sh` | Keys, migrations, administrator, then supervisord |
| `secrets.sh` | The keys: which come from the environment, which the volume keeps (`/data/secrets.env`) |
| `supervisord.conf` | Runs redis, uvicorn and nginx |
| `nginx.conf.template` | Site config; `${PORT}` is substituted on start. Its access log keeps no query strings |
| `render_frontend_config.py` | Writes `/usr/share/nginx/html/config.js` from the environment |
| `credentials.sh` | `docker exec -it <container> credentials`: sets the administrator's password |
| `tests/` | `bash tests/test_secrets.sh` (the keys) and `bash tests/test_nginx_log.sh` (the access log; needs Docker) |
| `import.sh` | `docker exec -it <container> workspace-import <archive>`: imports an exported account, asking for its export key |
| `installation-guide.md`, `enduser-steps.md` | Pulling the image from a private registry, and running it |
| `.github/workflows/build.yml` | CI: assemble the source, build and push to GHCR |
| `build-local.sh` | Local build helper (assembles the context, single-arch `--load`) |
| `publish.sh` | Local multi-arch build and push to a registry (GHCR by default) |
| `VERSION` | Image version tag |
