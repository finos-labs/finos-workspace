---
title: Common Errors
uri: workspace://validation/common-errors
use_when: A widget or app failed to load and you want a curated list of the most likely shape, layout, and contract failures.
language_specific: false
related:
  - workspace://specs/widgets-json
  - workspace://specs/apps-json
  - workspace://specs/layout-grid
  - workspace://guides/debug-app
---

# Common Errors

The mistakes that catch real apps. When validation fails, walk this list before exploring.

## `widgets.json` shape

| Symptom | Cause | Fix |
|---------|-------|-----|
| `[widgets.json]: Invalid format`, with an `Expected` and a `Received` line | Top-level is `[ ... ]`, or a single widget instead of an object of widgets | Change to `{ "widget_id": { ... } }` |
| `missing \`name\`` (or `description`, `endpoint`) | A required key is absent | Add it |
| A widget's key listed under unrecognized fields | A key the contract does not define, such as `defaultViz`, `widgetId` or `widgetType`; the widget loads without it | Remove it; the keys are in `workspace://specs/widgets-json` |
| Widget missing from the catalog, with a warning that nothing renders its type | A typo, a type that nothing renders (such as `table`, `chart` or `metric`), or a plugin type not enabled for the organization | Use a built-in type, or ask an administrator to enable the plugin |
| `endpoint` must be a path or an absolute URL with no `?` and no `#` | A static query value in the endpoint | Make it a param with a default `value` and `"show": false` |
| `` `{xxx}` names no param of this widget `` | A placeholder in `endpoint` with no param of that name | Declare the param, or fix the placeholder |
| `` `xxx` fills a path placeholder, so it is sent nowhere else and declares no `in` `` | A path param with `in` | Remove its `in` |
| `Body params are sent only with "method": "POST"` | A param `in: body` on a `GET` widget | Set `"method": "POST"` |
| A header param refused | Its name is one a browser forbids or FINOS Workspace sets, or one the backend connection's credentials use | Rename it; the rules are in `workspace://specs/widget-parameters` |
| `` `xxx` is declared twice `` | Two params with one `paramName` | Rename one |
| Widget far too wide or too narrow on the dashboard | `gridData.w` does not fit the 40-column grid | Use `w` between 1 and 40 |
| Widget endpoint 404 | Path mismatch | Confirm `endpoint` matches a real route |

## `apps.json` shape

| Symptom | Cause | Fix |
|---------|-------|-----|
| `[tabs]: Invalid input: expected object, received undefined` | Missing or wrong tab structure | Each tab needs `id`, `name`, `layout` |
| App has no thumbnail | `img`, `img_dark`, and `img_light` are empty | Prefer a stable hosted image URL or serve a small SVG/PNG from `/thumbnails/{name}` |
| Creating a dashboard from the app fails with `Unable to create app because these widgets are unavailable: xxx` | Layout `i` doesn't match any widget id | Fix typo or align with `widgets.json` keys |
| `id` rejected | Top-level `id` doesn't match `^custom-.+` | Use `custom-<slug>` or omit `id` |

## Layout fields

| Symptom | Cause | Fix |
|---------|-------|-----|
| Widget never appears | Layout used `id` instead of `i` | Rename the key to `i` |
| Coordinates ignored | Layout used `gridData: {x,y,w,h}` | Use `x`, `y`, `w`, `h` directly on the layout item |

## Parameter groups

| Symptom | Cause | Fix |
|---------|-------|-----|
| Group exists, no widget joins | A layout item's `groups` does not contain the group's exact `name` | Make the `name` in `groups` and in each layout item the same text |
| Group exists but sync silently disabled | Group `type` doesn't match the underlying param shape | `param` for static `text+options`, `endpointParam` for `endpoint+optionsEndpoint` |
| Sync works for some widgets, not others | A widget is missing from the group's `widgetIds`, or its layout entry is missing `"groups": [...]`, or its widget config uses a different `paramName`/`optionsEndpoint` | Make all three places agree |

## Endpoint and route check

| Symptom | Cause | Fix |
|---------|-------|-----|
| Validate Widgets fails a route | The route answers `404` to the plain `OPTIONS` request that the API sends | Answer `OPTIONS` with `204` on every route in `widgets.json` (`workspace://contract/backend`) |
| Validate Widgets lists routes as not checked | The backend answers every `OPTIONS` request, whatever the path, so the check cannot tell a route from a path that does not exist | Answer `OPTIONS` with `404` on a path that does not exist (`workspace://contract/backend`) |
| A widget fails with the header `X-Workspace-Proxy-Error` | The API refused or could not make the request: `403` for a connection that is not a superuser's and is not a public `https` address, `502` when nothing answered | Use a public `https` address, or have a superuser add the connection |
| A widget shows "`xxx` needs a value" instead of its data | A path param, or a placeholder of `optionsEndpoint`, has no value | Give the param a default `value`, or choose one |
| The API cannot reach the backend | A connection that is not a superuser's must be a public `https` address, unless the stack runs with `MODE=local` | Serve the backend over public HTTPS, or develop on a local stack |
| 404 on widget endpoint | Path typo or missing route | Confirm the route is registered; match `endpoint` exactly |
| Wrong response shape | Endpoint returns the wrong kind of response for the widget type | `markdown` → string; `html` → HTML document; `newsfeed` → array of articles; `pdf` → file or base64 JSON |
| Garbled non-ASCII | JSON file read with OS locale (cp1252 on Windows) | Open files with `encoding="utf-8"` (Python) or your language's UTF-8 equivalent |

## When the doc and the validator disagree

Trust the running validator. FINOS Workspace's actual validator is the source of truth — adjust the files to match what it accepts, then update docs.

- **Preferred check** — `workspace_mcp`: `manage_backends(operation="add", url=...)` returns schema errors directly.
- **Browser check**: open Connections in the sidebar and choose Connect Backend. FINOS Workspace validates the backend and lists the invalid items.

See `workspace://guides/debug-app` for the full diagnostic order.
