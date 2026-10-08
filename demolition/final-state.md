# State at the end of the demolition

2026-10-07, branch `finos-demolition` (the commit after the snapshot `be00e95`); the target repository's changes were absorbed on 2026-10-08 (plan, call 24). How each check was run is in
[`README.md`](README.md) and in the sections named below.

## Gates

| Area | Check | Result |
| :-- | :-- | :-- |
| Backend | `ruff check .` | clean |
| Backend | `pytest` (with `envs/.env` and `user_create.json` moved aside, see the plan, section 8) | 900 passed, 4 skipped, 0 failed |
| Backend | `alembic upgrade head` on SQLite, MySQL and PostgreSQL (`tests/test_migration_dialects.py`) | passes |
| Backend | `alembic check` on the compose stack's MySQL | only the known `ix_user_chat_message` reflection noise |
| Backend | `scripts/export_workspace_mcp_surface.py --check` | fixture current |
| Workspace | `tsc --noEmit` (strict) | 0 errors |
| Workspace | `vitest run` (Node 24) | 335 files, 4,086 tests passed |
| Workspace | `biome check src tests` after the safe fixes | 11 diagnostics, all in test files (style and accessibility findings; the plan's section 10 lists Biome findings in some test files as present at the start) |
| Workspace, admin panel, add-in | production builds | pass |
| Admin panel | `tsc --noEmit` | 0 errors |
| Add-in | `tsc --noEmit`, `jest` (46 tests, `TZ=UTC`), `vite build`, `office-addin-manifest validate` | pass |
| Stack | `docker compose build --no-cache` and `up` on fresh volumes | healthy |
| End to end | Playwright against the stack | 21 passed (the setup plus 10 tests in each of two browsers) |
| Lite | `lite/build-local.sh`, run once | builds, starts healthy |
| Frontend image, local stack | `docker compose build web` and run (config from `BACKEND_URL`, user `nginx`); `local/` `make up` and Playwright against the Vite server | pass |
| Workflows | `actionlint` on `.github/workflows/*.yml`, `gitleaks` on the files call 24 added | clean |
| Residual | `python3 demolition/tools/residual_references.py` | 0 files |
| Names | `python3 demolition/tools/purge/scan.py openbb,terminal,pro,obb - NOTICE` | only the copyright line of `excel-add-in/LICENSE` |
| Secrets, licences | [`audit/`](audit/README.md) | no secret; one licence question (`buffers`) |
| Walkthrough | [`walkthrough/`](walkthrough/README.md) | every kept widget type, admin user and role, marketplace listing, 13 pages without console errors |

## Versions that matter

Node 24 (the repository's `engines` allow 22 to 24; Node 26's built-in `localStorage` breaks the persisted stores
under jsdom), Python 3.13, Poetry 2.3.2, FastMCP 4.0.11 with MCP SDK 2.3.0, FastAPI 0.141, Starlette 1.6,
Pydantic 2.13.

## Open items

1. **History.** The branch sits on the upstream snapshot, whose history holds the original `config.toml` with a fixed
   administrator password and company OAuth client IDs (see [`audit/README.md`](audit/README.md)). Decide whether the
   donated repository keeps it or starts from a squashed tree.
2. **`buffers`.** No licence upstream; see the audit.
3. **Copyright lines.** `NOTICE` names the original product and company in its first lines; `excel-add-in/LICENSE` names
   the company. Both are attribution and wait for the legal review.
4. **Sign-in with a real identity provider** (Google, Microsoft, Okta) was not run, because it needs the provider's
   credentials. The buttons render and start their flows with test configuration. `VITE_OKTA_DOMAIN` is the full issuer
   URL; a malformed value now leaves Okta sign-in out instead of breaking the login page.
5. **Marketplace categories** in the submit wizard are finance-flavoured (Sentiment, Fixed Income, Prediction Markets,
   ...). They are data, not a service; make them neutral if the donation should not suggest a domain.
6. **Names that stayed on purpose:** `billing_active` is the seat flag (the admin list labels it "Billing Status"),
   `DEVELOPER_MAPPING` is the default permission mapping for new users, and `MODE=lite|onprem|production|local|test`
   still selects the deployment mode (plan, section 10).
7. **This folder names what it removed** (the product, its abbreviation, the old tier names), because that is what a
   record of the removal has to do. The residual check and the name scan skip `demolition/` and `DEMOLITION-PLAN.md`.
   Leave both out of any copy that must be free of those names.
8. **`scripts/cfgs/config.toml` is tracked.** The file holds the first administrator (an address on a reserved domain) and a
   generated password, and `create_local_env` refuses to write over it, so the README's first step fails on a fresh
   checkout. The snapshot tracked it with a fixed password and the first commit of this branch tracks the generated one.
   It should be untracked (`git rm --cached backend-api/backend/scripts/cfgs/config.toml`, which the ignore rule already
   covers) before the branch is published. The password that the commit holds belongs to a stack that no longer exists:
   the local file was regenerated on 2026-10-08.
9. **Settings for the ported workflows** (call 24), in the target repository. Variables: `AWS_REGION`, `AWS_IMAGE_PUSH_ROLE_ARN`,
   `ECR_REGISTRY`, `INFRA_REPO`, `DEV_VALUES_FILE`, `INFRA_APP_ID`. Secret: `INFRA_APP_PRIVATE_KEY`. Secrets of the `prod`
   environment: `AWS_PROD_KEY_ID`, `AWS_PROD_SECRET_ACCESS_KEY`, `PROD_S3_BUCKET` (was `PRO_PROD_S3_BUCKET`),
   `PROD_CLOUDFRONT_DISTRIBUTION_ID`, `PROD_VITE_BACKEND_URL`, `PROD_VITE_AI_API_URL`, `PROD_VITE_GOOGLE_OAUTH_CLIENT_ID`.
10. **The target's `develop` must not be merged as is.** Its tree holds `frontend/src/lib/charting_library/` (proprietary).
    Record the absorption with `git merge -s ours --allow-unrelated-histories origin/develop`, which keeps this tree.
