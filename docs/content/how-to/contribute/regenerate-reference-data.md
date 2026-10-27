---
title: How to regenerate the reference data
---

# How to regenerate the reference data

Many reference pages are generated from the code, so that they cannot drift away from it. A test keeps each generated fixture equal to the code, and the test fails when the code changes without the fixture. This guide shows what to do when that happens.

Regenerate the data when a change to the API, the settings, the database models, the plugin manifest, the `widgets.json` schema or the admin CLI makes `tests/test_reference_data.py` fail. Do the same when a change to the Workspace MCP server's tools makes `tests/test_workspace_mcp_surface_parity.py` fail.

## Regenerate the backend data

1. From `backend-api/backend`, with the backend's Python environment active, run the exporter. It needs the variables of the `env` block of `pytest.ini`, so the command sets them first:

   ```bash
   cd backend-api/backend
   env $(sed -n 's/^    \([A-Z_]*=.*\)$/\1/p' pytest.ini | xargs) python -m scripts.export_reference_data
   ```

   The exporter rewrites six files in `tests/fixtures`: `openapi.json`, `widgets_schema.json`, `plugin_manifest_schema.json`, `database_schema.json`, `settings.json` and `admin_cli.json`. Add `--check` to compare the files with the code without writing them.

2. If the tools, resources or prompts of the Workspace MCP server changed, regenerate its fixture in the same way:

   ```bash
   env $(sed -n 's/^    \([A-Z_]*=.*\)$/\1/p' pytest.ini | xargs) python -m scripts.export_workspace_mcp_surface
   ```

3. Commit the changed files.

## Regenerate the site's data

The site reads the backend fixtures and the sources of the frontend and the agent directly. It writes what its components render to `docs/src/generated`, which git does not track. To refresh that data, run the generator:

```bash
cd docs
npm run generate
```

The commands `npm start`, `npm run build` and `npm run typecheck` run the generator first, so a changed source needs no other step.
