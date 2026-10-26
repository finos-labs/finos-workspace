---
title: How to regenerate the reference data
---

# How to regenerate the reference data

Do this when a change to the API, the settings, the database models, the plugin manifest, the `widgets.json` schema or the admin CLI makes `tests/test_reference_data.py` fail, or when the Workspace MCP server's tools change and `tests/test_workspace_mcp_surface_parity.py` fails.

## Regenerate the backend data

1. From `backend-api/backend`, with the backend's Python environment active, run the exporter with the variables of the `env` block of `pytest.ini` set:

   ```bash
   cd backend-api/backend
   env $(sed -n 's/^    \([A-Z_]*=.*\)$/\1/p' pytest.ini | xargs) python -m scripts.export_reference_data
   ```

   It rewrites six files in `tests/fixtures`: `openapi.json`, `widgets_schema.json`, `plugin_manifest_schema.json`, `database_schema.json`, `settings.json` and `admin_cli.json`. Add `--check` to compare them with the code without writing.

2. If the Workspace MCP server's tools, resources or prompts changed, regenerate its fixture the same way:

   ```bash
   env $(sed -n 's/^    \([A-Z_]*=.*\)$/\1/p' pytest.ini | xargs) python -m scripts.export_workspace_mcp_surface
   ```

3. Commit the changed files.

## Regenerate the site's data

The site reads the backend fixtures and the frontend and agent sources directly, and writes what its components render to `docs/src/generated`, which git does not track. To refresh it:

```bash
cd docs
npm run generate
```

`npm start`, `npm run build` and `npm run typecheck` run it first, so a changed source needs no other step.
