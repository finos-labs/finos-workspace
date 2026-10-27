---
title: How to regenerate the reference data
---

# How to regenerate the reference data

Many reference pages are generated from the code, so that they cannot drift away from it. Each part of Workspace that the reference describes writes a fixture, which is a JSON file under its `tests/fixtures`, and a test keeps that fixture equal to the code. The test fails when the code changes without the fixture. This guide shows what to do when that happens.

Regenerate the data when a change to the API, the settings, the database models, the plugin manifest, the `widgets.json` schema, the admin CLI or the Workspace bridge makes `tests/test_reference_data.py` fail. Do the same when a change to the Workspace MCP server's tools makes `tests/test_workspace_mcp_surface_parity.py` fail, when a change to the agent makes `tests/unit/scripts/reference.test.ts` fail, and when a change to the plugin runtime or the bridge in the web app makes a test named `reference.test.ts` or `workspaceBridgeReference.test.ts` fail.

## Regenerate the backend data

1. From `backend-api/backend`, with the backend's Python environment active, run the exporter. It needs the variables of the `env` block of `pytest.ini`, so the command sets them first:

   ```bash
   cd backend-api/backend
   env $(sed -n 's/^    \([A-Z_]*=.*\)$/\1/p' pytest.ini | xargs) python -m scripts.export_reference_data
   ```

   The exporter rewrites eight files in `tests/fixtures`: `openapi.json`, `widgets_schema.json`, `plugin_manifest_schema.json`, `database_schema.json`, `settings.json`, `admin_cli.json`, `widget_plugins.json` and `workspace_bridge.json`. Add `--check` to compare the files with the code without writing them. A test also fails when a setting, a manifest field, a widgets.json property or a field of a bridge command has no description, so a new one needs its description in the code.

2. If the tools, resources or prompts of the Workspace MCP server changed, regenerate its fixture in the same way:

   ```bash
   env $(sed -n 's/^    \([A-Z_]*=.*\)$/\1/p' pytest.ini | xargs) python -m scripts.export_workspace_mcp_surface
   ```

3. Commit the changed files.

## Regenerate the agent's data

From `agent`, run the exporter on Node 26.12.1. It writes `tests/fixtures/reference.json`, which holds the routes, the metrics, the MCP tools, the query protocol and the limits of Ines. Add `:check` to the script name to compare the file with the code without writing it.

```bash
cd agent
npm run reference
```

The descriptions of the agent's environment variables are in `agent/src/lib/env-reference.ts`, and a test fails when the code reads a variable that the file does not describe.

## Regenerate the web app's data

From `frontend`, run the tests that write the fixtures with `UPDATE_REFERENCE` set. They write `tests/fixtures/plugin-reference.json`, which holds the plugin runtime's messages, limits and permissions, and `tests/fixtures/workspace-bridge-reference.json`, which holds the limits and the commands of the bridge in the tab.

```bash
cd frontend
UPDATE_REFERENCE=1 npx vitest run tests/unit/plugins/reference.test.ts tests/unit/components/AI/workspaceBridgeReference.test.ts
```

The same tests compare the web app with the backend's fixtures, for example the permissions of a plugin and the commands of the bridge, so run the backend exporter first.

## Regenerate the site's data

The site reads the fixtures of the backend, the web app and the agent. It writes what its components render to `website/src/generated`, which git does not track. To refresh that data, run the generator:

```bash
cd website
npm run generate
```

The commands `npm start`, `npm run build` and `npm run typecheck` run the generator first, so a changed fixture needs no other step. The generator also checks that the hand-written pages mention what the code defines, for example every command that a widget plugin can call and every kind of typed result, and it stops with the list of what is missing.

Netlify builds the published site from the committed fixtures and the sources, as [How to write and preview documentation](write-docs.md#how-the-site-is-published) describes. A change to the code that leaves a fixture behind fails the tests, so the published pages come from fixtures that equal the code.
