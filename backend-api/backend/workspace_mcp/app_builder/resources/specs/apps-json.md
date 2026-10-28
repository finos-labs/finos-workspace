---
title: apps.json Spec
uri: workspace://specs/apps-json
use_when: You are authoring or editing apps.json and need the served shape, tab layout, and parameter group wiring.
language_specific: false
related:
  - workspace://specs/widgets-json
  - workspace://specs/layout-grid
  - workspace://validation/common-errors
---

# `apps.json` Spec

`apps.json` is the **app templates** contract. It declares one or more dashboards: the tabs they contain, the widgets placed on each tab, and the parameter groups that synchronize widgets.

## Top-level shape

The `/apps.json` endpoint MUST return a JSON **array** of app objects:

```json
[ { "...app object..." }, { "...app object..." } ]
```

Returning a single object instead of an array is the most common shape mistake — FINOS Workspace will reject it with an error like `Unknown App: [name]: Required`.

> **Schema vs served format.** Some validators describe a schema for *one* app object. The `/apps.json` endpoint serves an **array** of these objects. Validate each array element against the per-app schema individually.

## Per-app fields

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | App display name. |
| `tabs` | Yes | Object keyed by tab id; each value has `id`, `name`, `layout`. |
| `description` | Recommended | Shown in the app gallery. |
| `img`, `img_dark`, `img_light` | Recommended | App gallery image URLs. Prefer populated values: a stable hosted image URL or a backend-served `/thumbnails/{name}` SVG/PNG. Empty string `""` is acceptable only as a fallback. |
| `allowCustomization` | Recommended | Boolean. Whether users can modify the layout in their copy. |
| `groups` | Recommended | Array of parameter sync groups. Use `[]` when none are needed — that's the safe default. |
| `prompts` | Recommended | Array of suggested prompts for the agent. Use `[]` when none. |
| `id` | Optional | If set, must match `^custom-.+`. Plain strings are rejected. |
| `mcpServers` | Optional | MCP servers of this backend: see "MCP servers" below. |

Several FINOS Workspace validators flag `allowCustomization`, `groups`, or `prompts` as required. Including all three (with empty arrays where applicable) is the safest default.

## Tab shape

`tabs` is an object keyed by tab id. The most common case is a single, unnamed tab — use empty strings for `id` and `name`:

```json
"tabs": {
  "": {
    "id": "",
    "name": "",
    "layout": [ /* layout items */ ]
  }
}
```

Named tabs:

```json
"tabs": {
  "overview": { "id": "overview", "name": "Overview", "layout": [ ... ] },
  "details":  { "id": "details",  "name": "Details",  "layout": [ ... ] }
}
```

Each tab value requires `id`, `name`, and `layout`.

## Layout item shape

Each entry in `layout` is an object:

| Field | Required | Notes |
|-------|----------|-------|
| `i` | Yes | Widget id. MUST match a key in `widgets.json`. **Not `id`.** |
| `x` | Yes | Column origin (0–39). |
| `y` | Yes | Row origin. |
| `w` | Yes | Width in columns (typically 10–40). |
| `h` | Yes | Height in rows (typically 4+). |
| `groups` | Optional | Array of group names this widget participates in, e.g. `["Group 1"]`. |
| `state` | Optional | Pre-configures display: `params`, `paramOrder`, `style`. |

Coordinates are on a 40-column grid — see `workspace://specs/layout-grid`.

## Parameter groups

`groups` synchronizes a parameter across multiple widgets. The runtime is strict about three things:

1. **For strict compatibility, group `name` follows the literal `Group 1`, `Group 2`, ... pattern.** Put human-readable meaning in `description`, `category`, or surrounding app copy. If you use descriptive group names, browser-test them because validators may warn while runtime behavior can vary.
2. **Group `type` must match how the underlying widget's param is defined in `widgets.json`.** It is one of two values:

   | `groups[].type` | Use when widget param is | `paramName` |
   |---|---|---|
   | `"param"` | static dropdown — `type: "text"` with inline `options` | required |
   | `"endpointParam"` | dynamic dropdown — `type: "endpoint"` with `optionsEndpoint` | required |

3. **Three places must agree:** the group's `widgetIds`, every participating widget's layout `groups: [...]`, and the widget's own param config (matching `paramName` and option source).

Group object shape:

```json
{
  "name": "Group 1",
  "type": "endpointParam",
  "paramName": "team",
  "widgetIds": ["team_summary", "team_report"],
  "defaultValue": "platform"
}
```

> **Implicit auto-sync.** FINOS Workspace also auto-links widgets that share an identical `paramName` plus matching `options`/`optionsEndpoint`, even with no entry in `groups`. The explicit `groups` entry layers a named, user-toggleable group on top — useful when you want users to see and disable the linkage from the UI. If you don't need that affordance, matching `paramName` + `optionsEndpoint` is enough.

## Layout item `state`

Optional. Pre-configures how a widget displays inside this app template. Common keys:

- `params` — pre-set parameter values for this widget.
- `paramOrder` — render order for the widget's parameter panel.
- `storage.text` and `storage.html` — the text of a note, the HTML of an HTML widget.
- `storage.plugin.config` — the configuration of a widget whose type a widget plugin renders. It is checked against that plugin's settings when the backend loads: a key the settings do not define, a value they refuse, or a configuration for a widget no plugin renders leaves the app out, with the path of each problem.
- `style.borderWidth` (0–24), `style.radius` (0–64), `style.contentPadding` (0–64), `style.shadow` (`none|sm|md|lg`).

`state.style` is closed — typos like `"shadowSize"` fail validation. `state` itself is open, so per-widget extras are tolerated.

> **Schema ≠ runtime.** Some `state.*` fields validate but produce no visible effect (e.g. `state.style.headerMode`). Render in FINOS Workspace and confirm before committing speculative state defaults.

## MCP servers

An app can declare MCP servers that belong to this backend. When the backend is connected, FINOS Workspace registers each one for the user, with the backend connection's header credentials; the user connects it (an OAuth server asks for consent first), and their roles decide which tools the AI Agent may use.

```json
"mcpServers": [
  { "name": "Team data", "url": "https://<mcp-host>/mcp", "authType": "token",
    "description": "Queries over the team reports" }
]
```

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | The server's name in this backend. A widget's `mcp_tool` names it. Two apps of one backend may declare the same server, but one name cannot name two servers. |
| `url` | Yes | The server's URL. |
| `authType` | Optional | `token` for a static token, which the user enters (the server stays off until then); OAuth otherwise. |
| `description` | Optional | Shown with the server. |

A widget opts in to one tool of these servers with `mcp_tool` (`workspace://specs/widgets-json`).

## Minimal example

```json
[
  {
    "name": "My Dashboard",
    "description": "Weekly summary and report for a team",
    "img": "http://localhost:7779/thumbnails/my_dashboard",
    "img_dark": "http://localhost:7779/thumbnails/my_dashboard",
    "img_light": "http://localhost:7779/thumbnails/my_dashboard",
    "allowCustomization": true,
    "tabs": {
      "": {
        "id": "", "name": "",
        "layout": [
          { "i": "team_summary", "x": 0,  "y": 0, "w": 20, "h": 12, "groups": ["Group 1"] },
          { "i": "team_report",  "x": 20, "y": 0, "w": 20, "h": 12, "groups": ["Group 1"] }
        ]
      }
    },
    "groups": [
      {
        "name": "Group 1",
        "type": "endpointParam",
        "paramName": "team",
        "widgetIds": ["team_summary", "team_report"],
        "defaultValue": "platform"
      }
    ],
    "prompts": []
  }
]
```

## What this spec does not cover

- Layout grid math — see `workspace://specs/layout-grid`.
- Widget metadata that supplies the widgets referenced here — see `workspace://specs/widgets-json`.
- Common validation errors — see `workspace://validation/common-errors`.
