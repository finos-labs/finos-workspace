---
title: Widget Parameters
uri: workspace://specs/widget-parameters
use_when: You are defining widget params (text, number, boolean, date, endpoint dropdowns) and need the right type and option-source choice.
language_specific: false
related:
  - workspace://specs/widgets-json
  - workspace://specs/apps-json
  - workspace://specs/widget-types
---

# Widget Parameters

Widget controls live under a widget's `params` array in `widgets.json`. The right `type` is the one that **matches the shape of the value**, not the easiest to implement.

## Common fields

Every param object should have:

| Field | Required | Notes |
|-------|----------|-------|
| `paramName` | Yes | Query/body key sent to the data endpoint. |
| `type` | Yes | Renderer — see below. |
| `label` | Yes | Display label in the param panel. |
| `description` | Yes (in practice) | Tooltip help shown on hover. Don't omit. |
| `value` | Usually | Default value. |
| `show` | Optional | When `false`, the param is hidden in the UI but still sent — used when a group or another widget supplies the value. |
| `multiSelect` | Optional | For dropdowns that allow selecting multiple values. Use a comma-separated default string unless the app's existing convention uses an array. |
| `optionsEndpoint` | When `type: "endpoint"` | Backend path that returns the options list. |
| `optionsParams` | Optional | Dependent options — e.g. `{ "country": "$country" }` re-fetches when the named param changes. |
| `options` | When `type: "text"` with a curated list | Inline `[{label, value}]` array. |

## Type cheatsheet

Pick the right type before defaulting to `text` with options. Wrong type → clunky UX even though it "works".

| Param shape | Correct `type` | Wrong choice |
|-------------|----------------|--------------|
| Yes/no flag | `boolean` (renders as toggle) | `text` with `[{label:"Yes",value:"true"},{label:"No",value:"false"}]` |
| Free-form integer (limit, days, count) | `number` | `text` with hardcoded options |
| Free-form text (search query) | `text` (no `options`) | `text` with curated options |
| Date or date range | `date` with `$currentDate` modifiers | `text` with hardcoded date strings |
| Curated short list (3–6 fixed values) | `text` with `options` | OK — this is the intended use |
| A choice among values the backend knows (teams, accounts, regions) | `endpoint` with `optionsEndpoint` | `text` (forces the user to type the exact value) |
| Dropdown that depends on another param | `endpoint` with `optionsParams: {key: "$other"}` | static `text` options |

## Type examples

### `text`

```json
{ "paramName": "query", "type": "text", "label": "Search Query",
  "description": "Enter search term", "value": "" }
```

### `number`

```json
{ "paramName": "limit", "type": "number", "label": "Limit",
  "description": "Maximum rows to return", "value": 10 }
```

### `boolean`

```json
{ "paramName": "include_archived", "type": "boolean", "label": "Include Archived",
  "description": "Include items that have been archived", "value": false }
```

### `date`

```json
{ "paramName": "start_date", "type": "date", "label": "Start Date",
  "description": "Window start", "value": "$currentDate-1M" }
```

Date modifiers: `$currentDate`, `$currentDate-1d`, `$currentDate-1w`, `$currentDate-1M`, `$currentDate-1y`. Avoid hardcoded date strings — they get stale.

### Static dropdown — `text` with `options`

```json
{ "paramName": "granularity", "type": "text", "label": "Granularity",
  "description": "How the period is divided", "value": "day",
  "options": [
    { "label": "Day",   "value": "day" },
    { "label": "Week",  "value": "week" },
    { "label": "Month", "value": "month" }
  ] }
```

### Dynamic dropdown — `endpoint`

```json
{ "paramName": "team", "type": "endpoint", "label": "Select Team",
  "description": "Choose a team",
  "optionsEndpoint": "/teams" }
```

The `optionsEndpoint` should return an array of `{ label, value }` objects.

Keep dropdown options simple. Use `{label, value}` for normal dropdowns; add `category` only when FINOS Workspace needs that category for grouping/search semantics. Avoid `extraInfo` unless the user explicitly wants an advanced/search-rich dropdown.

### Multi-select dimensions

For filters like years, geographies, countries, sectors, or business units:

```json
{ "paramName": "years", "type": "endpoint", "label": "Years",
  "description": "Reporting years to include",
  "optionsEndpoint": "/year_options",
  "multiSelect": true,
  "value": "2020,2021,2022,2023,2024" }
```

Prefer real individual choices over fake aggregate choices:

- Good: options `2020`, `2021`, `2022`, `2023`, `2024` with all selected by default.
- Avoid: a selectable `2020-2024` option unless it is a real domain value users should choose.
- Good: options `Portugal`, `Angola`, `Brazil`.
- Avoid: a selectable `All Geographies` option unless it is a real source row users should choose directly.

### Dependent dropdown — `optionsParams`

```json
{ "paramName": "city", "type": "endpoint", "label": "City",
  "description": "City within the selected country",
  "optionsEndpoint": "/cities",
  "optionsParams": { "country": "$country" } }
```

When the user changes the `country` param, the `city` dropdown re-fetches with `?country=...` appended.

## Hidden params

A param with `"show": false` is not shown but is still sent to the endpoint. Use it for a value that a parameter group or another widget supplies, so the widget does not offer a second control for the same thing:

```json
{ "paramName": "team", "type": "endpoint", "label": "Team",
  "optionsEndpoint": "/teams", "value": "platform", "show": false }
```

## What this spec does not cover

- The widget-level shape that contains `params` — see `workspace://specs/widgets-json`.
- App-level `groups[].type` choice (`param` vs `endpointParam` vs `ticker`) — see `workspace://specs/apps-json`.
- Layout wiring and parameter groups — see `workspace://specs/layout-grid`.
