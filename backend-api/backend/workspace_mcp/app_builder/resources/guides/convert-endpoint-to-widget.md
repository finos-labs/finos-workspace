---
title: Convert an Existing Endpoint to a Widget
uri: workspace://guides/convert-endpoint-to-widget
use_when: You already have an HTTP endpoint that returns JSON and want to expose its response as a FINOS Workspace widget.
language_specific: false
related:
  - workspace://specs/widget-types
  - workspace://specs/widgets-json
  - workspace://specs/widget-parameters
  - workspace://examples/generic-http/minimal
---

# Convert an Existing Endpoint to a Widget

Use this when the backend already exists and you need to wrap one of its endpoints as a FINOS Workspace widget. The work is mostly metadata authoring, not code.

## 1. Inspect a sample response

Hit the endpoint with realistic params and read the JSON. Note:

- Top-level shape: array of objects, single object, string, HTML document, file?
- Field names and value types.
- Any timestamp fields and their format.
- Whether numbers are pre-formatted strings or raw numbers.
- Whether the endpoint already supports query params, and how it interprets unknown ones.

## 2. Choose the widget type

Match the response shape to a widget type. See `workspace://specs/widget-types` for the catalog and the "choose this, not that" rules.

| Sample response shape | Widget type |
|------------------------|-------------|
| Markdown string, or JSON that holds one at a known path | `markdown` |
| An HTML document | `html` |
| Array of articles `{title, date, author, excerpt, body}` | `newsfeed` |
| A PDF (bytes, or JSON with base64 `content` or a `url`) | `pdf` |
| A page that already has a URL | `iframe` |
| Array of row objects, or numbers meant for a table or chart | None of these. Wrap the rows in an `html` or `markdown` response (a table in the document), and keep the rows behind `?raw=true` with `"raw": true` on an `html` widget |

If the shape doesn't match any widget type cleanly, change the endpoint to fit the closest type — don't try to force the wrong renderer.

## 3. Pick `endpoint`, `name`, and `widget_id`

- `widget_id` (the dict key in `widgets.json`) should be stable, snake-cased, descriptive. It's referenced from `apps.json` layouts.
- `name` is the user-visible widget title.
- `endpoint` is the path FINOS Workspace calls. It's typically the same path your existing handler is on; it doesn't have to match the widget id. A path parameter becomes a `{name}` placeholder (`/teams/{team}/report`); the path has no `?` or `#`.
- `method` is `POST` when the handler takes a JSON body; it is `GET` otherwise.

## 4. Translate query params to widget params

Every input the endpoint accepts becomes a `params` entry in `widgets.json`: a path parameter (named by its placeholder, with no `in`), a query param (the default), a header (`"in": "header"`) or a key of the JSON body (`"in": "body"`, with `"method": "POST"`). Credentials are not params: they belong to the backend connection. Pick the right `type`:

- `boolean` for toggles (don't use `text` with `"true"`/`"false"` options).
- `number` for free-form integers.
- `date` with `$currentDate` modifiers for date inputs.
- `endpoint` with `optionsEndpoint` for dropdowns whose values come from another endpoint.
- `text` with `options` only for genuinely curated short lists (e.g. interval presets).

Every param needs `paramName`, `type`, `label`, `description`, and a sensible `value`. See `workspace://specs/widget-parameters`.

If a param depends on another (e.g. `city` depends on `country`), wire it via `optionsParams: { "country": "$country" }`.

## 5. Shape the response

- `markdown`: return the markdown string. If the endpoint returns JSON, set `"data": { "dataKey": "path.to.text" }` on the widget so FINOS Workspace reads the string from that path.
- `html`: return a complete HTML document that reads well without scripts, and honor `theme=dark|light`. If the document is built from rows, set `"raw": true` on the widget and return those rows (JSON array of objects) when called with `raw=true`.
- `newsfeed`: return a JSON array of articles `{ "title", "date", "author", "excerpt", "body" }`, with `body` in markdown and `date` as an ISO 8601 string. If the array sits inside an object, set `"data": { "dataKey": "path.to.articles" }` on the widget.
- `pdf`: return `application/pdf`, or JSON `{ "data_format": { "data_type": "pdf", "filename": "report.pdf" }, "content": "<base64>" }` (or `"url"` instead of `"content"`).
- `iframe`: no response to shape; `endpoint` is the page URL.

## 6. Add descriptions

Every widget should have a `description`. Every param should have a `description`. They drive tooltips and hover help. Skipping them is an easy way to ship a widget that no one understands.

## 7. Produce the widget draft

Combine the above into a `widgets.json` entry:

```json
{
  "weekly_summary": {
    "name": "Weekly Summary",
    "description": "The week's activity for one team, as written commentary",
    "type": "markdown",
    "endpoint": "/summary",
    "gridData": { "w": 20, "h": 12 },
    "params": [
      { "paramName": "team", "type": "endpoint", "label": "Team",
        "description": "Team to summarize", "optionsEndpoint": "/teams" }
    ]
  }
}
```

## 8. Validate

- Confirm `widgets.json` is still a JSON object (not an array) after adding the entry.
- Confirm the `endpoint` path exists and returns the shape the widget type expects with the default params.
- If you're also adding the widget to an `apps.json` template, confirm the layout's `i` matches the new widget id.

See `workspace://validation/common-errors` for the failure list and `workspace://guides/debug-app` if something doesn't render.

## 9. Link it to other widgets (if it makes sense)

If other widgets on the same dashboard take the same param (a `team`, say), put them in one parameter group so that one choice drives all of them. See `workspace://specs/layout-grid` and `workspace://specs/apps-json`.
