---
title: Layout Grid and Groups
uri: workspace://specs/layout-grid
use_when: You are placing widgets, sizing them, or wiring synchronized parameter groups in apps.json.
language_specific: false
related:
  - workspace://specs/apps-json
  - workspace://specs/widgets-json
  - workspace://specs/widget-parameters
---

# Layout Grid and Groups

Workspace lays out widgets on a fixed grid and supports param synchronization via named groups. Both live in `apps.json`.

## Grid

- The grid is **40 columns wide**.
- Common widths: `w=40` full, `w=20` half, `w=10` quarter.
- Minimum widget width: typically 8–10 columns.
- Height is flexible. Minimum is usually 4 rows. Avoid heights above ~20 unless the content really needs it.
- A `navigation_bar` widget, when present, usually occupies `y=0` with `h=2`, so the first content row begins at `y=2`.

Each layout item lives under `tabs[].layout[]` with the shape:

```json
{ "i": "widget_id", "x": 0, "y": 2, "w": 40, "h": 12, "groups": ["Group 1"] }
```

Use `i` for the widget id (not `id`). Use `x`, `y`, `w`, `h` directly (not nested in `gridData`).

## Suggested heights by widget type

| Widget type | Recommended `h` |
|-------------|------------------|
| `markdown` | 8–12 |
| `html` | 12–15 |
| `newsfeed` | 12–15 |
| `pdf` | 15–20 |
| `iframe` | 12–20 |

## Tabs

Tabs organize app sections. Use one tab when the dashboard fits on one screen; split into multiple tabs only when it actually helps the user. 3–5 tabs is a healthy ceiling.

For a single, unnamed tab use empty strings:

```json
"tabs": { "": { "id": "", "name": "", "layout": [ ... ] } }
```

## Parameter groups

Groups synchronize a parameter (e.g. `team`) across multiple widgets. The runtime is strict:

1. **A widget joins a group by its `name`.** The `name` in `groups` and in each layout item's `groups` must be the same text, and any text works, such as `"team-group"`. `Group 1` is only the name that the UI gives a new group.
2. **Group `type` must match the widget param's shape** — see `workspace://specs/apps-json`.
3. **Three places must agree:** `groups[].widgetIds`, each layout item's `groups: [...]`, and each widget's own param config.

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

## Checklist

- [ ] Every layout item uses `i` and matches a key in `widgets.json`.
- [ ] Every widget that shares a parameter lists the group's `name` in the `groups` of its layout entry, is listed in that group's `widgetIds`, and declares the matching param.
- [ ] Widgets do not overlap and fit in the 40 columns.
- [ ] Open the app in Workspace and change the shared param in one widget — confirm the others refresh.

## What this spec does not cover

- Required `apps.json` fields and tab/layout schema — see `workspace://specs/apps-json`.
- Widget-side param definitions — see `workspace://specs/widget-parameters`.
- Type cheatsheet for groups — covered in `workspace://specs/apps-json`.
