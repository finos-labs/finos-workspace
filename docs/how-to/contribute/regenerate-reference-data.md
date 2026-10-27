---
title: How to regenerate the reference data
sidebar_position: 6
---

# How to regenerate the reference data

Many reference pages are generated from the code, so that they cannot drift away from it. Each part of Workspace that the reference describes writes JSON files into a folder named `reference-data`, and the site's generator reads them. Git does not track the folders, so nothing generated is committed, and the data always comes from the code of the commit that you build. This guide shows how to write the data and what to do when the site stops for want of it.

Write the data before you generate or build the site, and write it again after a change to the API, the settings, the database models, the plugin manifest, the `widgets.json` schema, the admin CLI, the Workspace bridge, the agent or the plugin runtime of the web app.

## Write all the data

From `website`, run the script that writes the data of the three parts in turn:

```bash
cd website
npm run reference
```

The script runs `npm ci` in `agent` and in `frontend`, so it replaces their `node_modules`, and it expects the backend's Python environment to be active, as the next section describes. The sections after it show how to write the data of one part.

## Write the backend's data

1. From `backend-api/backend`, with the backend's Python environment active, run the exporter. It needs the variables of the `env` block of `pytest.ini`, so the command sets them first:

   ```bash
   cd backend-api/backend
   env $(sed -n 's/^    \([A-Z_]*=.*\)$/\1/p' pytest.ini | xargs) python -m scripts.export_reference_data
   ```

   The exporter writes nine files into `backend-api/backend/reference-data`: `openapi.json`, `widgets_schema.json`, `plugin_manifest_schema.json`, `database_schema.json`, `settings.json`, `admin_cli.json`, `widget_plugins.json`, `workspace_bridge.json` and `api_metrics.json`. The last one lists the metrics that the API serves, which a test compares with what the API's instrumentation registers. Pass `-o <folder>` to write them elsewhere. A test fails when a setting, a manifest field, a widgets.json property or a field of a bridge command has no description, so a new one needs its description in the code.

2. The page about the Workspace MCP server is generated from a fixture that the repository does keep, `tests/fixtures/workspace_mcp_sidecar_surface.json`, because it records the contract of that server. If the tools, resources or prompts of the server changed on purpose, regenerate the fixture in the same way and commit it:

   ```bash
   env $(sed -n 's/^    \([A-Z_]*=.*\)$/\1/p' pytest.ini | xargs) python -m scripts.export_workspace_mcp_surface
   ```

## Write the agent's data

From `agent`, install the dependencies and run the exporter on Node 26.12.1. It writes `agent/reference-data/reference.json`, which holds the routes, the metrics, the MCP tools, the query protocol and the limits of Ines.

```bash
cd agent
npm ci --ignore-scripts
npm run reference
```

The descriptions of the agent's environment variables are in `agent/src/lib/env-reference.ts`, and a test fails when the code reads a variable that the file does not describe.

## Write the web app's data

From `frontend`, install the dependencies and run the script that runs the three tests which write the data. It writes four files into `frontend/reference-data`. The file `plugin-reference.json` holds the plugin runtime's messages, limits, permissions and policy rules, and `workspace-bridge-reference.json` holds the limits, the errors and the commands of the bridge in the tab. The file `web-app-reference.json` holds the numbers, names and lists of the web app's interface that the how-to guides quote, such as the file types that a dashboard accepts and the longest name of a folder, and `apps-schema.json` is the JSON Schema of `apps.json`. A test fails when a field of an `apps.json` entry has no description.

```bash
cd frontend
npm ci --ignore-scripts
npm run reference
```

## Generate the site's data

The site reads the three folders. It writes what its components render to `website/src/generated`, which git does not track. To refresh that data, run the generator:

```bash
cd website
npm run generate
```

The generator stops with the command that writes the data when a file is missing. The commands `npm start`, `npm run build` and `npm run typecheck` run it first, so a changed folder needs no other step. The generator also checks that the web app and the API agree on the rules of a plugin and of the bridge, which are the permissions, the versions, the policy of a frame, the commands and the errors, and that the hand-written pages mention what the code defines, for example every command that a widget plugin can call and every kind of typed result. It stops with the list of what disagrees or is missing.

The Docs workflow writes the data in the same way before it builds the site, as [How to write and preview documentation](write-docs.md#how-the-site-is-published) describes.
