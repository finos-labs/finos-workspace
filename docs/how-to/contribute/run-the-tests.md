---
title: How to run the tests
sidebar_position: 2
---

# How to run the tests

Each part of the repository has its own tests, and a pull request runs them in CI. This guide shows the command for each part, so that you can run the same checks before you push. The backend, the web app, the agent and the example plugins are separate projects, and a change to one of them needs only that project's checks. The workflows in `.github/workflows` are the authority: `backend-checks.yml`, `frontend-checks.yml`, `ines-checks.yml`, `examples.yml` and `e2e.yml` each run the commands below.

## The backend

The backend needs Python 3.13, Poetry and a running Docker, because its tests start a MySQL and a Valkey container of their own and remove them afterwards. Run the commands in `backend-api/backend`:

```bash
poetry install --with dev
pytest tests -q
```

To run less, name a file, a class or a test, or select by words in the name:

```bash
pytest tests/test_auth.py -v
pytest tests/test_auth.py::TestAppLogin::test_login_valid_credentials -v
pytest tests -k Theme
```

The suite is large, so a full run takes several minutes. Two kinds of test need extra care:

- **A local stack changes the settings.** The backend reads `backend-api/backend/envs/.env` and `user_create.json` when they exist, and running the stack on the same checkout creates both. A value in them can make a test that expects the defaults fail. Move both files away for a full run and put them back afterwards.
- **The migration tests start more containers.** `tests/test_migration_dialects.py` runs the whole chain of migrations on MySQL, PostgreSQL and SQLite. The SQLite part needs no Docker. [How to add a database migration](add-a-database-migration.md) describes these tests.

CI also lints the backend with Ruff, in the version that `backend-checks.yml` pins:

```bash
cd backend-api
ruff check backend
```

## The web app

The web app needs Node 26.12.1, the version in `engines` of `frontend/package.json`. Run the commands in `frontend`:

```bash
npm ci --ignore-scripts
npx biome ci .
npm run typecheck
npm run test:unit
```

- **`npx biome ci .`** checks the format and the lint rules of the whole project, and it fails on anything it finds. `npm run lint` writes the fixes that Biome can make, including its unsafe ones.
- **`npm run typecheck`** runs `tsc --noEmit`.
- **`npm run test:unit`** runs the Vitest tests in `tests/unit`. To run a file, use `npx vitest run tests/unit/components/General/Avatar.test.tsx`, and to run tests by name, `npx vitest run -t "Avatar"`. Add `-- --coverage` to `npm run test:unit` for a coverage report. The tests mirror the structure of `src`, and the network is mocked with MSW.
- **The spelling check** of CI uses the tool `typos` with `frontend/_typos.toml`, on `frontend/src` and the change log.

The end-to-end tests run in a browser against a whole stack, over HTTPS, as a deployment serves it. They sign in as an account that exists in that stack. `frontend/TESTING.md` describes how to start the stack with `docker-compose.e2e.yml`, which account to name in `E2E_USER_EMAIL` and `E2E_USER_PASSWORD`, and which projects run in which browsers. Then:

```bash
npm run test:e2e
npx playwright test tests/e2e/auth.spec.ts
npx playwright test tests/e2e --ui
```

The first command runs every end-to-end test, the second one file, and the third opens Playwright's interactive interface.

## The agent

The agent Ines needs the same Node version. Run the commands in `agent`:

```bash
npm ci
npm run typecheck
npm test
```

`npm test` runs the tests of the agent and of its MCP server with the test runner that Node includes, and it has to pass before a merge. `npm run test:coverage` adds a coverage report. The evaluations, `npm run evals` and its variants, call a real model with the keys in the agent's `.env` file, so they are not part of CI and cost money.

## The documentation site

In `website`, `npm run typecheck` generates the reference data and checks the types, and `npm run build` builds the site and fails when a reference is stale or a link is broken. [How to write and preview documentation](write-docs.md) explains how to prepare the data that these commands read.

## The example plugins

Each example plugin has tests of its own. In `docs/examples/plotly-charts` and in `docs/examples/sql-explorer`, run `npm ci --ignore-scripts`, `npm run build` and `npm test`. The SQL explorer also has a backend, which CI tests against a PostgreSQL that it starts, as `examples.yml` shows.
