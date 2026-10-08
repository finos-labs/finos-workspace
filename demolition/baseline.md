# Phase 0 baseline (commit `be00e95`, untouched code)

Toolchain: Node 24.21.0 (the `engines` range is `^22.13.1 || ^23 || ^24`; on Node 26 the built-in `localStorage` shadows jsdom's and 644 unit tests fail), bun 1.3.14 (`bun install --frozen-lockfile`), Python 3.13.15 with the `poetry.lock` versions (`poetry install --with dev`), Docker for testcontainers.

| Check | Command | Result |
|---|---|---|
| Frontend unit tests | `vitest run tests/unit` | 5,187 passed, 0 failed (2,070 suites) |
| Frontend typecheck | `tsc --noEmit -p tsconfig.demolition-check.json` | 188 errors, all present before any change (44 in `TVChartContainerFunc.tsx`, 31 in the UDF datafeed, 8 in `widgetParams.ts`, 1 in each of 21 design-system stories, ...) |
| Backend tests | `pytest tests` (MySQL 8.0 and Redis through testcontainers) | 1,025 passed, 5 skipped, 3 failed |
| Migrations, SQLite | `alembic upgrade head`, then `alembic downgrade base` | both succeed |
| Model/schema diff, SQLite | autogenerate compare after `upgrade head` | 1 difference: index `copilot_messages.ix_user_chat_message` reported as removed and re-added |

Problems present before any change:

- **`tsc --noEmit` does not typecheck at all.** `tsconfig.json` sets `"ignoreDeprecations": "6.0"`, which TypeScript 5.9.2 (the locked version) rejects (TS5103), and the project reference to `tsconfig.node.json` stops the run at TS6305 before any file is checked. The checks above use `frontend/tsconfig.demolition-check.json` (untracked, deleted at the end): it extends `tsconfig.json`, sets `ignoreDeprecations` to `"5.0"` and has no project references.
- **Three gate tests fail:** `test_workspace_mcp_auth.py::{test_mcp_endpoint_rejects_missing_and_malformed_auth, test_mcp_endpoint_rejects_revoked_token, test_mcp_tool_call_with_valid_token_returns_no_browser_connected}`, also when the file runs alone. FastMCP raises "StreamableHTTPSessionManager task group was not initialized": the test client does not run the MCP app's lifespan.
- **`alembic check` on SQLite** reports every UUID column as a type change (`NUMERIC(16)` reflected, `UUIDType` in the model). That is SQLite reflection, not drift; the diff above filters it out.

Rule for every later phase: no test that passes here may fail, the typecheck may not gain an error, and the schema diff may not gain a difference. Tests removed with deleted code are listed per phase.
