# Audit

The scans of phase 7 of [`DEMOLITION-PLAN.md`](../../DEMOLITION-PLAN.md), run on 2026-10-07 against the tree
at the end of the demolition.

## Secret scan

- **Tool and command:** [gitleaks](https://github.com/gitleaks/gitleaks) (`zricethezav/gitleaks:latest` in Docker),
  `gitleaks dir /repo --redact`.
- **Scope:** an export of every tracked and every untracked file that git does not ignore (1,436 files, 10.4 MB),
  without `node_modules`, build output and the git-ignored local files (`envs/.env`, `scripts/cfgs/config.toml`,
  `user_create.json`, the Playwright session).
- **Result:** 7 findings, all false positives. Nothing real.

| Rule | File | Line | What it is |
| :-- | :-- | --: | :-- |
| generic-api-key | `backend-api/backend/tests/scripts/test_create_local_env.py` | 68 | the placeholder arguments `a-secret`, `0123456789abcdef`, `storage` of a unit test |
| generic-api-key | `backend-api/backend/tests/scripts/test_create_local_env.py` | 86 | the placeholder arguments `a-secret`, `0123456789abcdef`, `storage` of a unit test |
| generic-api-key | `frontend/src/components/AI/hooks/useChatSearch.tsx` | 120 | the key `previous7Days` of a chat group, not a credential |
| generic-api-key | `frontend/tests/unit/api/workspaceBridge.api.test.ts` | 66 | a fixture token (`ws_mcp_…_secret`) in a unit test |
| generic-api-key | `frontend/tests/unit/api/workspaceBridge.api.test.ts` | 70 | a fixture token (`ws_mcp_…_secret`) in a unit test |
| generic-api-key | `frontend/tests/unit/lib/state/auth.login.test.ts` | 152 | a fixture value `perplexity-key-456` in a unit test |
| generic-api-key | `frontend/tests/unit/lib/state/auth.test.ts` | 71 | a fixture value `perplexity-123` in a unit test |

**Not covered by the scan, and worth knowing:**

- The git history. It is the upstream snapshot (`be00e95`) plus the demolition commit. The snapshot still holds
  values that the working tree no longer has: the original `backend-api/backend/scripts/cfgs/config.toml` with a fixed
  administrator password, and `.env` files with company OAuth client IDs. The vendored TradingView library is *not*
  in it (no `charting_library` path in `be00e95` or in the working tree). Whether the donated repository keeps this
  history or starts from a squashed tree is a decision for the owners.
- The generated local files. `scripts.create_local_env` writes `envs/.env` and `scripts/cfgs/config.toml` with random
  secrets, and both are git-ignored (`config.toml` has to be removed from the index once, because it is tracked in
  the snapshot).

## Licence scan

- **npm packages** (production dependencies, with `node_modules` installed from the lockfiles), in `frontend/`,
  `backend-api/admin_frontend/` and `excel-add-in/`:
  `npx license-checker-rseidelsohn --production --json --excludePrivatePackages`
- **Python packages** (the backend's virtualenv, Poetry 2.3.2 lock):
  `uvx --from pip-licenses pip-licenses --python <venv>/bin/python --format=json --with-urls --partial-match`
- **Inventories:** [`licences-workspace.csv`](licences-workspace.csv) (455 packages),
  [`licences-admin-frontend.csv`](licences-admin-frontend.csv) (207),
  [`licences-excel-add-in.csv`](licences-excel-add-in.csv) (316) and
  [`licences-backend.csv`](licences-backend.csv) (145).
- **Result:** every package is MIT, ISC, BSD-2/3, Apache-2.0, MPL-2.0, BlueOak-1.0.0, 0BSD, CC0, Unlicense,
  Python-2.0 or a dual licence that offers one of them. The exceptions and what was decided:

| Package | Finding | Decision |
| :-- | :-- | :-- |
| `text-unidecode` 1.3 (backend) | Artistic or GPL | Removed. Its only user was `python-slugify`, for a `SlugType` that nothing used; both are gone from `pyproject.toml` and `poetry.lock`. |
| `psycopg2-binary` (backend) | LGPL | Removed earlier. The drivers are `asyncpg` (Apache-2.0) and `pg8000` (BSD-3-Clause). `psycopg` 3 is LGPL too and is not used. |
| `buffers` 0.1.1 (workspace) | No licence field and no licence file upstream | Open. It arrives through `exceljs` → `unzipper` → `binary`. ClearlyDefined curates it as MIT. Needs a decision of the owners' legal review. |
| `jszip` 3.10.1 | MIT or GPL-3.0-or-later | Used under MIT. |
| `dompurify` | MPL-2.0 or Apache-2.0 | Used under Apache-2.0. |
| `rgbcolor`, `chainsaw`, `traverse`, `use-mcp` | Reported as `MIT*` (the licence was read from a file or a README) | MIT. |
| `argparse` | Python-2.0 | PSF licence; permissive. |
| `fastmcp`, `fastmcp-slim` 4.0.11 | Apache-2.0 | New with the FastMCP 4 upgrade. |
| `mcp`, `mcp-types` 2.3.0, `truststore` | MIT | New with the FastMCP 4 upgrade. |
| `httpx2`, `httpcore2`, `httpx2-jsfetch` | BSD-3-Clause | New with the FastMCP 4 upgrade. |

**The FINOS Category X list** (TradingView Advanced Charts, `react-ts-tradingview-widgets`, `highcharts` and
`highcharts-react-official`, `ag-grid-enterprise`, `ag-charts-enterprise`, `rpc-websockets` through
`@pythnetwork/client`, `psycopg2-binary`): none of them is in any manifest, lockfile or source file, and the
vendored library is not in the history either. The TradingView paragraph is gone from `NOTICE`; its copyright lines
remain.

**Copyright lines.** `NOTICE` (first lines) and `excel-add-in/LICENSE` still name the original company. They are
attribution, so they stay until the owners' legal review decides otherwise. The add-in is MIT, the rest Apache-2.0.
