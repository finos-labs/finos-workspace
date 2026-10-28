# Backend

FastAPI + SQLAlchemy backend for FINOS Workspace.

## Setup

See [DEVELOPMENT_SETUP.md](../DEVELOPMENT_SETUP.md) for full local development instructions.

Quick start for local UI testing:

```bash
docker compose -f docker-compose-local-dev.yml up --build --watch

# in a second shell
cd backend
../.venv/bin/python -m scripts.init_users
```

This runs the API and RQ worker in Docker with the local `backend/` folder mounted.
The API reloads automatically, and Compose can restart the worker when files change.
See [DEVELOPMENT_SETUP.md](../DEVELOPMENT_SETUP.md) for the full workflow.

## Project Layout

| Path | Description |
|---|---|
| `api/` | Core application — models, schemas, helpers, auth |
| `routers/` | API route handlers |
| `utilities/` | Configuration, shared utilities |
| `alembic/` | Database migration revisions |
| `envs/` | Environment files (`.env`) |
| `scripts/` | Dev-only scripts and config (excluded from Docker images) |
| `tests/` | Test suite (`pytest`) |
| `run.py` | Application entrypoint (Gunicorn + Uvicorn) |
| `main.py` | FastAPI app factory |

## Conventions

- Use `api.base.get_now()` instead of `datetime.datetime.now`.
- The `User.password` column uses a `PasswordType` TypeDecorator that bcrypt-hashes
  on write. Always pass plaintext passwords — never pre-hash.
- Secrets at rest (`api/crypto.py`): a secret the API uses again (authenticator secrets,
  users' provider keys, data-backend, Copilot and MCP headers) is stored in an
  `EncryptedType` or `EncryptedStringType` column, AES-256-GCM under a key derived from
  `WORKSPACE_AES_KEY`. A credential the API only checks (an MCP token) is stored as
  its SHA-256 (`crypto.hash_token`). No secret goes into a plain column, a log line or a
  response to the browser. Random secrets come from the `secrets` module.
- Sessions (`api/auth_helpers.py`) are random tokens stored as their SHA-256. The web app
  holds its own in an HttpOnly cookie and names itself in the `X-Workspace-Client` header
  (`web`). A cookie request with an `Origin`, and
  every one that changes anything, must come from one of `BACKEND_CORS_ORIGINS`. Every answer to a request that carried a cookie or
  a token is `Cache-Control: no-store`. No session is a bearer token. The default Copilot acts for
  the user with an agent token (`POST /app/copilot/token`), which only `GET /app/user`,
  `PUT /app/usage` and `POST /app/copilot/authorize` accept.

## Secrets and keys

The API does not start without these, and refuses short or malformed values:

| Setting | What it is |
|---|---|
| `WORKSPACE_AES_KEY` | Key of the encryption at rest: base64url, at least 32 bytes. Keep it: data stored under it cannot be read with another key. |
| `JWT_SECRET` | Signs the service tokens (`WORKSPACE_AUTH_TOKEN`, the metering token); at least 32 bytes. |
| `LOCAL_STORAGE_SECRET_KEY` | Signs pre-signed file URLs with `STORAGE_PROVIDER=folder`; at least 32 bytes. |

`python -m scripts.create_local_env` writes all of them, random, into `envs/.env`. To make
one yourself: `python -c "import secrets; print(secrets.token_urlsafe(32))"`.

`BACKEND_CORS_ORIGINS` is required too: the origins of the web app, exactly as browsers
send them (scheme, host and port; never `*`). The
session cookie reaches the API only when it is on the same site as the web app: serve it
under the web app's registrable domain, or under `/api` of the web app's origin, over
HTTPS. The cookies are scoped to the API's host, whatever the port, so a
deployment serves the API on a host of its own that no other server shares. On localhost
(the compose stack) that cannot hold: browsers treat `http://localhost` as secure,
and the session cookie also reaches every other server on a local port that the browser
navigates to or loads a frame or an image from, such as a local data backend or an app
in an iframe widget. Run only servers you trust on localhost next to a signed-in FINOS Workspace.
The sign-in providers check their tokens against `GOOGLE_OAUTH_CLIENT_ID`,
`AZURE_CLIENT_ID` with `AZURE_TENANT_ID`, and `OKTA_CLIENT_ID` with `OKTA_DOMAIN`, the same
public values the web app uses (its `VITE_` settings of the same names); a provider without
them refuses every sign-in. `AZURE_TENANT_ID` is the tenant's id (a GUID) or domain, or
`organizations` or `common` for a multi-tenant app. The Entra app
registration must send the optional ID-token claims `email` and `xms_edov`: without them
Microsoft vouches for no address, so a Microsoft sign-in reaches no existing account,
claims no invitation and makes no new account; it is refused, unless the account is
already linked to that Microsoft user.

The API reaches users' MCP servers only at public internet addresses. An MCP server on a
private network (an internal host, a compose service) has to be listed by host name in
`ALLOWED_MCP_HOSTNAMES`, a JSON list.

No password is printed, logged or kept in a file: `scripts.init_users` creates the first
administrator without one, and `python -m scripts.init_users --new-password <email>` sets it,
read from the terminal without echo or from standard input.

Rate limits count requests per client address. The API takes that address from
`X-Forwarded-For` only when the request comes from loopback or a private network
(`api/rate_limit.py` `TRUSTED_PROXIES`), where load balancers, ingresses and compose networks
connect from; a client on the internet cannot pick its own address.

## Database Migrations

```bash
# Apply pending migrations
../.venv/bin/python -m alembic upgrade head

# Create a new migration after model changes
../.venv/bin/python -m alembic revision --autogenerate -m "description"
```

## Testing

```bash
../.venv/bin/python -m pytest
```

Requires a running MySQL instance (see [DEVELOPMENT_SETUP.md](../DEVELOPMENT_SETUP.md)).
Coverage report is generated at `htmlcov/index.html`.
