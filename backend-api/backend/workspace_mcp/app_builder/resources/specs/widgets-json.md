---
title: widgets.json Spec
uri: workspace://specs/widgets-json
use_when: You are authoring or editing widgets.json and need the top-level shape and the critical fields per widget.
language_specific: false
related:
  - workspace://specs/widget-types
  - workspace://specs/widget-parameters
  - workspace://specs/apps-json
  - workspace://validation/common-errors
---

# `widgets.json` Spec

`widgets.json` is the metadata contract that tells FINOS Workspace which widgets your backend offers, what type each one is, and which endpoint serves its data.

## Top-level shape

`widgets.json` is a JSON **object**. Keys are widget ids, values are widget definitions:

```json
{
  "weekly_summary": { "...widget definition..." },
  "audit_report":   { "...widget definition..." }
}
```

Returning a JSON array is the most common mistake here — FINOS Workspace will reject it. Widget ids are referenced by app layouts (the `i` field in `apps.json` layout items), so they must be stable.

## Widget definition fields

Each value is an object. The high-leverage fields:

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Display title shown on the widget. |
| `type` | Yes | One of `markdown`, `html`, `newsfeed`, `pdf`, `iframe`. See `workspace://specs/widget-types`. |
| `endpoint` | Yes | Path on this backend that serves the widget's data. |
| `description` | Recommended | Tooltip text, and the main signal the AI Agent uses to find the widget. |
| `category` / `subCategory` | Optional | Grouping in the widget catalog. |
| `gridData` | Optional | Default placement hint as `{w, h}`. Not the app layout — see below. |
| `params` | Optional | Array of parameter definitions. See `workspace://specs/widget-parameters`. |
| `data` | Optional | Type-specific config. For `markdown`, `data.dataKey` names the path of the string inside a JSON response; for `newsfeed`, the path of the array of articles. |
| `source` | Optional | Array of source labels, e.g. `["API"]`. |
| `raw` | Optional | `true` when the endpoint also answers `raw=true` with the underlying rows as JSON (`html` widgets): FINOS Workspace then offers a toggle to the data. |
| `runButton` | Optional | When `true`, the widget waits for the user to click Run before fetching. Default `false`. Only set `true` for heavy work (>5 s). |
| `refetchInterval` | Optional | Auto-refresh interval in milliseconds. |

Unknown keys are tolerated by some FINOS Workspace builds and ignored by others — don't author speculative fields.

## `gridData` is a hint, not the layout

`gridData` is the default placement when a widget is dragged onto a dashboard from the catalog. It is *not* the layout used by an app template — that lives in `apps.json` under `tabs[].layout[]`. Don't try to express tabs or coordinates inside `widgets.json`.

Common mistakes:

- Returning an array instead of an object.
- Setting a `type` other than the five above — the widget is left out of the catalog.
- Setting `defaultViz` — deprecated legacy field, never emit it.

## Endpoint path

`endpoint` is the path the widget calls. It can be any HTTP path on the backend; it does not have to match the widget id. FINOS Workspace will issue a `GET` (or, when configured, `POST`) to `<backend-url><endpoint>` and pass the widget's parameters as query string entries (or in the body, depending on backend connection setup). It also adds a `theme` query parameter (`dark` or `light`) to `markdown` and `html` requests.

## Example shape

```json
{
  "weekly_summary": {
    "name": "Weekly Summary",
    "description": "The week's activity for one team, as written commentary",
    "type": "markdown",
    "endpoint": "/summary",
    "gridData": { "w": 20, "h": 12 },
    "params": [
      { "paramName": "team", "type": "endpoint", "label": "Team", "description": "Team to summarize",
        "optionsEndpoint": "/teams" }
    ]
  }
}
```

## What this spec does not cover

- Choosing a widget type — see `workspace://specs/widget-types`.
- Authoring params — see `workspace://specs/widget-parameters`.
- Wiring layouts and parameter sync — see `workspace://specs/apps-json` and `workspace://specs/layout-grid`.
- Common validation errors — see `workspace://validation/common-errors`.
