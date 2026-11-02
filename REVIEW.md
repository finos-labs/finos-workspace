# `feature/sharing-role` review (PR #26)

Base `develop` `cb94e62` (#17 and the Excel add-in's removal, #32, merged in). Head `67c6b13`.

2026-10-20, with removed users signed out for good and the login badge gone: API 1474 passed (1 skipped), web app 4106, admin panel 13, Playwright 15 on a fresh stack; ruff, tsc, Biome clean; migration `1792514781` checked on MySQL with the old data. Not run: Ines's own tests (`agent/` is develop's, unchanged but for its docs). CodeQL not rechecked since 2026-10-17 (4.7).

## 1. What breaks on upgrade

| Breaks | Fix |
|---|---|
| API does not start | Set `JWT_SECRET` (≥ 32 bytes; `JOSESECRET` is no longer read), `WORKSPACE_AES_KEY` (base64url, ≥ 32 bytes decoded; a new key clears values encrypted under the old one), `BACKEND_CORS_ORIGINS`, and with folder storage `LOCAL_STORAGE_SECRET_KEY` (≥ 32 bytes). See 3. |
| 403 `Requests must come from an allowed origin` | Every request and websocket needs an `Origin` listed in `BACKEND_CORS_ORIGINS` or matching `BACKEND_CORS_ORIGIN_REGEX`. Only `/health` and `/healthz` are exempt. Callers to fix: Prometheus scrapes of `/metrics`; BQ Agent (send `WORKSPACE_ORIGIN`, as Ines in `agent/` does); MCP clients (the web app's token dialog snippets add the header). |
| API served under the web app's origin | Same-origin GETs carry no `Origin` and are refused. Serve the API on its own origin, over HTTPS outside localhost (cookies are `Secure`, `SameSite=Strict`). |
| Google, Microsoft, Okta sign-in refused | Set `GOOGLE_OAUTH_CLIENT_ID`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `OKTA_CLIENT_ID` on the API, same values as the web app. The Entra app must send the `email` and `xms_edov` claims. |
| Everyone signed out | Migration `1792104777` deletes all sessions. |
| Users lose sharing, the Copilot, uploads | A user without a role gets none of them (admins keep the admin pages); existing roles get sharing `none`. Create and assign roles after the migrations. |
| Copilot web tools set per user or organization | `SEARCH_WEB` and `FETCH_FROM_WEB` are role settings (on for a new role; on for a user when any role allows them). Migration `1792000000` copies an organization's off switch to its roles; switches set for one user are dropped. `GET`/`PATCH /admin/entitlement/{user_uuid}` and the user's "Copilot web access" are gone: set them in the role dialog. |
| HTML widgets that call the API as the viewer | The HTML viewer's `srcDoc` frame stays on an opaque origin (no `allow-same-origin`, unlike develop): its scripts get no cookies and no Workspace origin. |
| Copilot usage not recorded; users with limits refused | The agent service sends `X-Metering-Authorization: Bearer <JWT>` on `PUT /app/usage` (HS256, `sub: metering`, signed with `JWT_SECRET`). |
| OAuth MCP servers disconnected | Users sign in to them again. |
| Encrypted values cleared | Values that do not decrypt under `WORKSPACE_AES_KEY`. The migration log counts them. |
| Removed routes | See 4.5. `GET /logout` is now `POST /logout`; `GET /user` callers use `GET /app/user`. |
| Admin CLI | `backend-api/admin_cli/` and sign-in with `source: "cli"` (now 422) are removed. Use `docker compose exec api python -m scripts.workspace_admin` (Lite: `docker exec workspace workspace-admin`). PR #20's `plugin` commands must move there. |
| No admin password in the `init` log | Set it: `docker compose run --rm init python -m scripts.init_users --new-password <email>` (read from the terminal or standard input). |
| `POST /admin/reset-password/{user_uuid}`, `POST /admin/create-user` | Answer `success`, `link`, `expires_at` (a single-use link to `APPURL/reset-password#<token>`), no temporary password. |
| Lite | The API moved from `/api` on port 3000 to port 8000: `docker run -p 3000:3000 -p 8000:8000`. |
| Removed settings | `DISABLE_CORS`, `WORKSPACE_FRONTEND_USER_AGENT`, `REDIS_DB_SDK`, `JOSESECRET` are ignored. |
| API does not start with `MODE=onprem` | The on-prem mode is gone: set `MODE=production` (`create_local_env` writes it). |
| The "Developer" organization disappears | It was a bucket the API made at every start; Developer is only a user type now. Migration `1792514781` deletes it where no user is in it and nothing refers to it; invites to its maps lose their map. |
| Entity type "On-Premise" | Renamed "Default" by migration `1792514781` (code and hierarchy kept). |
| Users removed from an organization | Are no users: removal ends every session of theirs, and sign-in (password or provider) answers 401 as for an unknown account. They are no longer put back into the first organization (`assign_default_mapping` is gone). Only a superuser puts one back: Admin → Entities → All users lists them with entity "None", and Move user gives them an entity and user type. |

## 2. Run

```bash
cd backend-api/backend && python -m scripts.create_local_env --admin-email <your-email>
```

```bash
PLATFORM=linux/arm64 docker compose up -d --build
```

```bash
docker compose run --rm init python -m scripts.init_users --new-password <your-email>
```

Web app `http://localhost:3000`, admin panel `http://localhost:3001`, API `http://localhost:8000`. `PLATFORM` on Apple silicon only.

```bash
cd backend-api && ruff check backend
```

```bash
cd backend-api/backend && poetry install --with dev && pytest tests -q
```

Move `envs/.env` and `user_create.json` out of `backend-api/backend` first: 11 tests fail with them present.

```bash
cd frontend && bun install --frozen-lockfile && bun run typecheck && bunx @biomejs/biome ci src && bun run test:unit
```

```bash
cd backend-api/admin_frontend && npm ci && npm run lint && npx tsc --noEmit && npm test
```

```bash
cd frontend && E2E_USER_EMAIL=<admin-email> E2E_USER_PASSWORD=<password> bunx playwright test --project=chromium
```

## 3. Configuration

API, worker, init (`backend-api/backend/envs/.env`). The API does not start if a required value is missing or invalid.

| Variable | Required | Rule |
|---|---|---|
| `JWT_SECRET` | Yes | ≥ 32 bytes |
| `WORKSPACE_AES_KEY` | Yes | base64url, ≥ 32 bytes decoded. Do not change. |
| `BACKEND_CORS_ORIGINS` | Yes | JSON list of origins (no path, no `*`): web app, admin panel, each service's `WORKSPACE_ORIGIN` |
| `BACKEND_CORS_ORIGIN_REGEX` | No | Pattern the whole origin must match (e.g. preview hosts) |
| `LOCAL_STORAGE_SECRET_KEY` | With `STORAGE_PROVIDER=folder` (default) | ≥ 32 bytes |
| `APPURL` | Yes | Web app address; password links point at it |
| `GOOGLE_OAUTH_CLIENT_ID`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `OKTA_CLIENT_ID`, `OKTA_DOMAIN` | For that sign-in | Same as the web app |
| `ALLOWED_MCP_HOSTNAMES` | For MCP servers on private networks | JSON list; also applies to MCP OAuth. A superuser's servers, and every user's when `MODE=local`, may be at any address |
| `RATE_LIMIT_EXEMPT_ENABLED`, `WORKSPACE_AUTH_TOKEN` | No | `1` and a JWT signed with `JWT_SECRET`: the only rate-limit exemption |

| Component | Setting |
|---|---|
| Web app | No new variables. Ines: `AI_API_URL`, `AI_COPILOT_ENABLED=true`, `AI_COPILOT_DEFAULT_COPILOT=true`. |
| Services calling the API | `WORKSPACE_ORIGIN`, sent as `Origin` |
| Admin CLI | None; runs with the API container's settings |
| Lite | Generates `JWT_SECRET`, `WORKSPACE_AES_KEY`, `LOCAL_STORAGE_SECRET_KEY` on the data volume unless given with `-e`. Defaults to `localhost:3000`/`8000`; on other ports set `BACKEND_CORS_ORIGINS`, `APPURL`, `VITE_BACKEND_URL`, `SELFURL`. `docker exec -it workspace credentials` sets the admin password. |
| Dev environment | The infrastructure repository's values file (`DEV_VALUES_FILE`): the required values above, `BACKEND_CORS_ORIGINS` (or the regex) with the web app, admin panel and service origins |

## 4. Changes

### 4.1 Access

| Item | Rule |
|---|---|
| User type | Permissions map `Admin` (organization admin pages), `Developer` (adds connections, no daily limits, shares need admin approval), `User` (adds no connections) |
| Role | Sharing `none` / `receive` / `share`; agent calls and tokens per day; upload GB; Copilot web search and page reading (`search_web`, `fetch_from_web`) (NULL limit = none). Grants: backends, files, prompts, Copilot models (`role_copilot_model`), MCP servers or tools (`role_mcp_access`, `*` = all) |
| Several roles | Union: highest sharing, highest limit (NULL wins), each web tool if any role allows it, all grants. No role: nothing. New role: sharing `none`, no limits, web tools on. |
| Organization | `entity.sharing_enabled` (superuser, default on). Admins act in their own organization only and cannot manage superusers. |
| Changes | Role or switch changes revoke shares and share requests no longer allowed. Leaving an organization removes the user's roles, their items' grants, shares and share requests there. |
| Developer shares | Stored in `share_request`; nobody receives them until an admin approves. `GET /admin/share-requests`, `POST /admin/share-requests/{uuid}/approve` (re-checks; 409), `/decline`. Removing a share needs no approval. |
| Copilot | Agent checks `POST /app/copilot/authorize`; the MCP proxy refuses tools no role grants. A web tool no role allows is refused even where an MCP grant covers it (`disabled_capabilities`). Grants for the web app's `default-copilot` are stored as `default_agent`. The deployment's `DEFAULT_MCP_SERVERS` are listed for every user; a user's own servers only for those who may add connections. |
| Not enforced | Direct shares from before the upgrade, until the users' roles next change. Superusers. External agents that do not call authorize. |

Tests: `backend-api/backend/tests/test_user_access.py`, `test_copilot_access.py` (`TestWebToolsOfTheCopilot`), `test_workspace_tools.py`, `test_copilot_metering.py`, `test_user_types.py`, `test_admin_organization.py`, `test_sharing.py`, `test_share_requests.py`.

### 4.2 Sessions and secrets

| Item | Rule |
|---|---|
| Sessions | Random token; database keeps its SHA-256. Cookies `__Host-ws_session`, `__Host-ws_admin`, `__Host-ws_totp` (HttpOnly, Secure, SameSite=Strict) with `X-Workspace-Client: web` or `admin`. 30 days with "remember me", 7 without. |
| Bearer tokens | The agent token only (30 min; `GET /app/user`, `PUT /app/usage`, `POST /app/copilot/authorize`). No session is a bearer; the sign-in answer carries no token. |
| Origin | `AllowedOriginMiddleware`, outermost (`api/auth_helpers.py`, `HEALTH_PATHS`) |
| At rest | AES-256-GCM bound to `table.column` (`api/crypto.py`, `v2.`): backend headers, custom Copilot headers, MCP servers and headers, MCP OAuth grants, TOTP secrets, users' OpenAI and Perplexity keys |
| Browser | No keys or tokens stored. A backend's credentials (headers and query rows) go only to that backend's origin; saved dashboards and apps carry none. |
| MCP OAuth | In the API (`routers/app/mcp_oauth.py`); public addresses only, unless in `ALLOWED_MCP_HOSTNAMES`, the user is a superuser or `MODE=local` |
| Sign-in | Provider tokens must be issued to this deployment's client id; Microsoft and Okta use a nonce from `POST /app/sign-in/nonce`. TOTP codes work once. Sign-in routes: 5 per minute per address. |
| Passwords | Admin → Users → Reset password, or Add Users with "Bypass invitation", gives the link `APPURL/reset-password#<token>`: 24 h, single use, SHA-256 in Redis, set with `POST /app/reset-password`. Sign-in page: "Ask your admin". |

### 4.3 Migrations

`backend-api/backend/alembic/versions/`, in order, after develop's `b6dd1da576b6`. Head `8615f7e17679`. Each `downgrade()` is described in its file.

| File | Content |
|---|---|
| `1792000000-roles_define_access.py` | Drops `tier`, `default_tier`, `data_bundle`, `entity_entitlement`, `entitlement`, `entity.seats`, `entity.expiration_date`, `user.billing_active`; renames `entitlement_usage` to `user_usage`; adds role settings (with `search_web`, `fetch_from_web`: off where the organization's entitlement had them off), `entity.sharing_enabled`, missing Developer maps |
| `1792084860-drop_login_ip_address.py` | Drops `login.ip_address` |
| `1792102721-secrets_at_rest.py` | AES-CBC to AES-GCM under the same key; encrypts TOTP secrets, provider keys, MCP headers; drops `session.api_token` (develop's `9c4d7a2e1f35` drops `user.auth_token`); deletes passwords from `user_invite.data` |
| `1792104777-hashed_sessions.py` | Adds `session.token_hash`; deletes all sessions; strips the copies of backend credentials from saved dashboards and apps. `downgrade()` does not restore them. |
| `1792108167-mcp_oauth_grants.py` | Adds `mcp_oauth_grant` |
| `1792113663-bind_ciphertexts.py` | Re-encrypts to `v2.`; encrypts `mcp_servers.servers` |
| `1792172839-share_requests.py` | Adds `share_request` |
| `1792440969-databases_from_before_the_merge.py` | For a database that reached `8b5e2d7c1f40` before develop was merged in: adds the two role web switches (on) and runs develop's marketplace cleanup `2f6c81b4e7a9`. Checks first; changes nothing on a database that came through the whole chain. |
| `1792512656-drop_role_excel_add_in.py` | Drops `role.excel_add_in` where an earlier run of this branch added it. Checks first. |
| `1792514781-drop_the_developer_entity.py` | Deletes the "Developer" organization (type code `DEF`) where no user is in its maps and no role, relationship, dashboard, backend, file share, theme or audit row refers to it, then its type once unused; renames "On-Premise" entity types to "Default". Checks first. |
| `1785000300-drop_marketplace_schema.py` (develop's, changed) | Drops the indexes on a removed column first: on SQLite the table rebuild recreated `ix_api_source_vendor_app_uuid` on the dropped column and failed |
| `0001_baseline.py` (changed) | `custom_copilot.headers`, `custom_copilot.copilots`, `api_source.endpointHeaders` declared as `Text` |

### 4.4 Routes added

`GET /app/session`, `GET /session`, `POST /logout`, `POST /app/sign-in/nonce`, `GET /app/access`, `GET`/`PUT /app/copilot-keys`, `POST /app/copilot/token`, `POST /app/mcp-oauth/start`, `/complete`, `/disconnect`, `GET /admin/share-requests`, `POST /admin/share-requests/{uuid}/approve`, `/decline`, `POST /app/reset-password`; web app page `/reset-password`.

### 4.5 Removed

| Removed | Replacement |
|---|---|
| Tier, seats, expiry, entitlements, billing flag: tables and columns (migration `1792000000`), `GET`/`PATCH /admin/entitlement/{user_uuid}`, `GET /admin/entity-info`, `/app/entitlement`, `/entity/entitlement/{entity_uuid}`, `FeatureLock.tsx`, `AdminUserBillingStatus.tsx`, `AdminUserWebAccess.tsx`, entitlement and web-switch fields in both entity forms and the admin panel's user form | Roles (4.1) |
| SDK: `routers/sdk.py` (`/sdk/token`, `POST /sdk/login`), `ws_sdk_` tokens, `personal_access_token.expires_at`, `user.auth_token`, `session.api_token`, `REDIS_DB_SDK` | None. `personal_access_token` remains for `ws_mcp_` tokens. |
| On-prem and the Developer organization: `MODE=onprem`, `is_onprem()`, the on-prem service-token check (any JWT signed with `JWT_SECRET` passed it), `create_developer_mapping()`, the `DEVELOPER_MAPPING` gating of shared dashboards and files, `ON_PREM_ADMIN_MAPPING`, `on_prem_admin_uuid` in `user_create.json` | Roles decide sharing; organization backends are listed for every member; `DEFAULT_USER_MAPPING` (the first organization's User map, from `user_create.json`) for users nobody placed |
| Excel add-in in roles and sign-in: `role.excel_add_in`, sessions of `source: "excel"` (bearer), `access_token` in the sign-in answer, the role dialog's switch | None (develop removed the add-in, #32) |
| `GET /openapi.json`, `/docs`, `/redoc`; admin panel docs page | None |
| HTTP admin CLI `backend-api/admin_cli/`; sign-in source `cli` | `scripts/workspace_admin.py` in the API container, through `routers/administration.py` |
| `check_valid`, `check_origin` dependency, `VALID_PATHS`, `check_cookie_origin`, `PublicCORSMiddleware` | `AllowedOriginMiddleware`. `check_origin` remains as `check_service_token`. |
| `api/aes.py` | `api/crypto.py` |
| `browser-provider.ts` (MCP OAuth in the browser) | `routers/app/mcp_oauth.py` |
| `useGetCustomApiKeys.tsx` (OpenAI key in browser state) | `GET`/`PUT /app/copilot-keys`, `useCopilotKeys.tsx` |
| `featureFlags.ts` | `lib/state/access.ts` |
| JWT session helpers, `fetchWithToken` | Hashed sessions and cookies |
| Temporary passwords (reset, create-user, admin CLI, `init` log) | Password links |
| `POST /login-github-google`, `DELETE /totp`, `GET /username-list/{username}` | None (no caller; signed in without a credential, disabled 2FA without a code, listed every user name) |
| `GET /user`, `GET /logout-everywhere`, `GET /app/validate-and-sync`, `GET /app/user-has-entity`, `GET /app/copilot-chats`, `GET /app/skills`, `GET /app/files`, `routers/run_tasks.py`, unused helpers in `api/base.py` and `api/auth_helpers.py`, `useMultipleQueries` | None (no caller) |

### 4.6 Web app

| Item | Change |
|---|---|
| Backend credentials | Header and query rows go with every request to the backend's origin: widget data, parameter options, form options and submit, "Validate widgets" probe, `agents.json`, app images, the agent's widget data and options (`useFunctionCall`). Widgets carry no copies (`createSourceWidget`, `updateApiSource`). |
| Forms | One button per `form` parameter, named by its `label` (else `paramName`). Endpoint inputs list their options (`optionsEndpoint`, `optionsParams` kept by the schema in `lib/types/app.ts`). |
| App images | `img`, `img_dark`, `img_light` paths (`/thumbnails/{name}`) resolve against the backend URL and are fetched with its credentials; SVG, data URI and base64 are shown (`Avatar.tsx`). No browser storage (`workspace_image_load` no longer used). |
| Browser secrets | Left by the old web app; deleted on load (`retiredBrowserSecrets.ts`) |
| Login page | No "Last Used" badge (it kept the last sign-in method in browser storage) |
| Role dialog | "Copilot may search the web (SEARCH_WEB)", "Copilot may read pages from the web (FETCH_FROM_WEB)" |
| Agent requests (develop's) | Dictation and the Workspace tools use the agent token (`fetchAgent`) and the signed-in user, not a token in the page |

### 4.7 CodeQL (PR #26, extended suite: 38 open)

| Alerts | Fix |
|---|---|
| 1–3 | `permissions: contents: read` in `e2e.yml`, `pr-build-check.yml`, `prod-deploy.yml` |
| 5, 6, 11–20 | Third-party actions pinned to commits: `oven-sh/setup-bun` v2.2.0, `staevs/s3-deploy-action` v1.2.3, `aws-actions/configure-aws-credentials` v4.3.1, `aws-actions/amazon-ecr-login` v2.1.7, `crate-ci/typos` v1.51.1 |
| 21 | `crud.prefix_last_word` replaces a backtracking regex |
| 23, 59, 61, 62 | `obfuscate_secrets` masks values with `********`; `init_users --new-password` field renamed `admin_email` |
| 32, 38–44 | `validateBackend.ts`, `convertHeadersToRecord`: `Object.fromEntries` and `Map` |
| 33 | The "Validate widgets" probe sent the backend's credentials to any origin; now its own only |
| 45 | Bridge websocket log leaves out the payload |
| 46 | `apiSource.worker.ts` ignores messages from another origin |
| 30, 31, 63 | Test sanitization, e2e ids from `crypto.randomUUID()`; 31 was in the Excel add-in, which develop removed |
| 33–37 open | Requests to the user's configured backend; CodeQL counts the page's message to its own worker as user input |

### 4.8 Other components

| Component | Change |
|---|---|
| Admin panel | Cookie sign-in, superuser only; no tier or entitlement fields; sharing switch per entity; `npm test` in CI |
| CI | `e2e.yml` sets a masked admin password through `--new-password` |

## 5. Open

| Item | State |
|---|---|
| CodeQL 33–37 | Open (4.7) |
| PR #20 | `plugin` commands extend the removed HTTP CLI; must move to `scripts/workspace_admin.py` |
| Prometheus | Must send an allowed `Origin` (infrastructure repository) |
| Accounts given a temporary password before the upgrade | Still see the "Update Password" prompt at sign-in |
| `SUPPRESSED_API_ROUTERS` | Does not remove routes of included routers |
| `entities.spec.ts` | "an entity type can be added and renamed" leaves its entity type behind |
