---
title: Widget Types
uri: workspace://specs/widget-types
use_when: You are picking the widget type string for a new widget or auditing whether an existing widget uses the right type.
language_specific: false
related:
  - workspace://specs/widgets-json
  - workspace://specs/widget-parameters
  - workspace://guides/convert-endpoint-to-widget
---

# Widget Types

`type` in `widgets.json` selects the renderer. Pick the type that matches the **shape of the data and the user task**, not the type that's easiest to implement.

## Catalog

The types FINOS Workspace renders itself:

<!-- generated:types -->
| Type | Use case | Endpoint returns | Method | Params go in |
|---|---|---|---|---|
| `markdown` | Prose, generated commentary, formatted text | A markdown string, as text or as JSON with the string at `data.dataKey` | GET or POST | query, header, body, or the path |
| `html` | A report, page or visualization the backend renders itself | An HTML document as text | GET or POST | query, header, body, or the path |
| `newsfeed` | Articles and updates, each with a title, an excerpt and a full text | A JSON array of articles, or JSON with the array at `data.dataKey` | GET or POST | query, header, body, or the path |
| `pdf` | A document the user reads page by page | The PDF (`application/pdf`), or JSON with its `data_format` and a base64 `content` or a `url` | GET or POST | query, header, body, or the path |
| `iframe` | An existing web page | Nothing: the endpoint is the page's URL, which the browser opens | GET | query, or the path |
<!-- /generated:types -->

A widget plugin can add types. A plugin is installed for the deployment and enabled per organization by its administrators, so the types a user can use depend on their organization: `workspace://specs/widgets-json-schema` is the schema in force for the signed-in user, with those types. A widget of a type nothing renders for the user is left out of their catalog, and FINOS Workspace names it in a warning when the backend is connected.

> Use the exact type string. Don't invent aliases.

## Use-case → type quick selector

| Data shape | Type |
|------------|------|
| Long-form prose, generated commentary, a list of findings | `markdown` |
| A report with its own layout, styling, tables or graphics that the backend renders | `html` |
| Articles, announcements or updates with a title and a body | `newsfeed` |
| A document, filing or report that exists as a PDF | `pdf` |
| An application or page that already has a URL | `iframe` |

## Choose this, not that

- **Prose goes to `markdown`, not `html`.** Markdown picks up the FINOS Workspace's theme and typography; use `html` only when you need layout or graphics markdown cannot express.
- **Articles go to `newsfeed`, not `markdown`.** `newsfeed` shows the list with title, date and author, a search box and each article's full text on demand; a `markdown` widget would be one long page.
- **A document that exists as a file goes to `pdf`, not a link inside `markdown`.**
- **A page you do not control goes to `iframe`, not a copy of its HTML.** Some sites refuse to be embedded; if the page stays blank, serve it from your own backend as `html` instead.
- **Dates, numbers and flags are params, not text.** Pick the right param `type` (`workspace://specs/widget-parameters`) so the user gets a date picker or a toggle instead of a text box.

## `html` widgets

The endpoint's response is shown in a sandboxed frame. Scripts run only when the deployment enables HTML script execution, so a report should read correctly without them. The widget follows the FINOS Workspace theme only if the endpoint honors a `theme` query parameter (`dark` or `light`), which FINOS Workspace sends.

If the HTML is generated from data rows, set `"raw": true` on the widget and have the endpoint return those rows as JSON when it is called with `raw=true`. FINOS Workspace then shows a toggle between the report and its data, and the AI Agent reads the rows instead of parsing the HTML (see `workspace://overview/ai-agent-contract`).

## `newsfeed` widgets

The endpoint returns a JSON array. If the array sits inside an object, set `"data": { "dataKey": "path.to.articles" }` on the widget.

```json
[
  {
    "title": "Rates held steady",
    "date": "2026-03-04T09:30:00Z",
    "author": "A. Writer",
    "excerpt": "The committee left rates unchanged on Wednesday.",
    "body": "# Rates held steady\n\nThe committee left rates unchanged..."
  }
]
```

`title` and `body` are required for a useful article; `date` is an ISO 8601 string. `body` is markdown, shown in a dialog when the user opens the article, where they can also add it to the dashboard as a `markdown` widget. The user's search box filters by `title` and `excerpt`, so write an `excerpt` that says what the article covers.

## `pdf` widgets

The endpoint answers in one of three ways:

- `Content-Type: application/pdf` and the file as the body.
- `Content-Type: application/json` and `{ "data_format": { "data_type": "pdf", "filename": "report.pdf" }, "content": "<base64 of the file>" }`.
- `Content-Type: application/json` and `{ "data_format": { "data_type": "pdf", "filename": "report.pdf" }, "url": "<where the file can be fetched>" }`.

## What this spec does not cover

- Widget-level metadata fields — see `workspace://specs/widgets-json`.
- Param types and option sources — see `workspace://specs/widget-parameters`.
- Layout coordinates — see `workspace://specs/apps-json` and `workspace://specs/layout-grid`.
