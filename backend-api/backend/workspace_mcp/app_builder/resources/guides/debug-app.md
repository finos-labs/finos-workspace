---
title: Debug an App
uri: workspace://guides/debug-app
use_when: An app does not load, widgets render empty, or parameter sync isn't working, and you need a diagnostic order.
language_specific: false
related:
  - workspace://contract/backend
  - workspace://specs/widgets-json
  - workspace://specs/apps-json
  - workspace://validation/common-errors
---

# Debug an App

Diagnostic order — work top to bottom. The first failure usually masks everything below it, so don't jump steps.

## 1. Fetch `/widgets.json` directly

```text
GET <backend-url>/widgets.json
```

What you should see: a JSON **object** keyed by widget id. Common failures:

- Returns a JSON array → FINOS Workspace will reject it. Convert to `{ "widget_id": { ... } }`.
- 404 → route isn't registered. Check the route exists and is `GET`.
- 500 / parse error → likely a JSON file read with the wrong encoding. On Windows, defaulting to `cp1252` mangles non-ASCII. Read JSON files as UTF-8 explicitly.
- CORS error in the browser console → backend isn't allowing the origin the FINOS Workspace is served from (or `http://localhost:1420`). Add the origin.

## 2. Fetch `/apps.json` directly (if the app ships templates)

```text
GET <backend-url>/apps.json
```

What you should see: a JSON **array** of app objects. Common failures:

- Returns a single object → FINOS Workspace will reject it with `Unknown App: [name]: Required` or similar. Wrap in `[ ... ]`.
- Each app missing `allowCustomization`, `groups`, `prompts` → some validators flag these as required. Add them with sensible defaults.
- Each tab missing `id`, `name`, or `layout` → required.

## 3. Validate the JSON shape

Walk these checks before debugging individual widgets:

- `widgets.json` is an object. Every entry has `name`, `type`, `endpoint`.
- `apps.json` is an array. Every layout item uses `i`, not `id`. Every `i` matches a `widgets.json` key.
- Layout coordinates are on the 40-column grid; widgets don't overlap.
- Every `type` is one of `markdown`, `html`, `newsfeed`, `pdf`, `iframe`, or a plugin type enabled for the organization. A widget of another type is left out of the catalog; FINOS Workspace names it in a warning.
- Every key is one the contract defines (`workspace://specs/widgets-json`). A key it does not define is ignored and named under the backend's unrecognized fields; a value out of bounds leaves the widget out, named with the path of each problem.

See `workspace://validation/common-errors`.

## 4. Hit each widget endpoint with default params

For each widget in `widgets.json`, send the request FINOS Workspace would send (`workspace://specs/widgets-json`, "The request"):

```text
<widget.method, GET by default> <backend-url><widget.endpoint, placeholders filled>?<query params>
```

with the default values of its params, its header params as headers and its body params as a JSON body. What you should see depends on the widget `type`:

- `markdown` → a markdown string.
- `html` → an HTML document; if the widget sets `raw`, `?raw=true` should return the underlying rows as JSON.
- `newsfeed` → a JSON array of articles.
- `pdf` → the PDF, or JSON with a base64 `content` or a `url`.
- `iframe` → the `endpoint` is a page URL that a browser can open (and that allows being embedded).

Common failures:

- 404 → the widget's `endpoint` doesn't match any registered route.
- 200 but empty array → the endpoint runs but the data fetch returned nothing. Add logging on the backend.
- 200 but wrong shape (e.g. a `markdown` endpoint returns a JSON object without `data.dataKey`) → fix the endpoint to match the widget type.
- 500 → backend exception. Check the server log.

## 5. Check CORS and auth

If the backend works from `curl` but fails in FINOS Workspace:

- CORS: open the browser devtools network tab while loading the dashboard. CORS failures show as red entries with no response body. Add the missing origin.
- Auth: if the backend requires a header or query string, confirm FINOS Workspace's backend connection has it configured (Settings → Data Connectors → edit the connection).
- Mixed content: a backend served over HTTP can't be reached from an HTTPS FINOS Workspace. Use HTTPS in production.

## 6. Parameter sync isn't working

Symptoms: changing a synced param in one widget doesn't update the others; the widget's link menu shows "No Active Groups."

Walk through:

- Group `name` is `Group 1`, `Group 2`, ... literally — not `"team-group"` or anything custom. Custom names validate but never link.
- Group `type` matches the widget param shape: `param` for `text+options`, `endpointParam` for `endpoint+optionsEndpoint`. The wrong type silently disables sync.
- The group's `widgetIds` array, every layout item's `groups: [...]`, and the widget's own param config all agree on the same `paramName`.
- For dynamic dropdowns: every widget shares the same `optionsEndpoint`. If they differ, FINOS Workspace can't link them.

## 7. Use FINOS Workspace validation if available

The browser/MCP path exposes the *actual* validator the running FINOS Workspace uses. When the doc and the validator disagree, **trust the validator** — adjust the files to match what FINOS Workspace accepts and then update docs/comments.

- **`workspace_mcp` (preferred)**: `manage_backends(operation="add", ...)` returns schema errors directly. `list_available_widgets(backend_id=...)` and `manage_apps(operation="list", backend_id=...)` confirm what loaded.
- **Browser**: Settings → Data Connectors → Connect Backend → Test surfaces the same errors.

## 8. Refresh, don't restart, for metadata changes

- `widgets.json` / `apps.json` edits → right-click the backend → "Refresh backend".
- Code/handler edits → restart the backend.
- Major schema changes → close the dashboard and open a fresh app instance from the gallery so cached state doesn't lie to you.
