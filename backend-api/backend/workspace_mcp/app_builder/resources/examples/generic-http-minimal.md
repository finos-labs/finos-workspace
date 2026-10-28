---
title: Minimal Backend (Generic HTTP)
uri: workspace://examples/generic-http/minimal
use_when: You want a framework-neutral picture of what a FINOS Workspace backend looks like, before committing to a specific language.
language_specific: false
related:
  - workspace://contract/backend
  - workspace://specs/widgets-json
  - workspace://specs/apps-json
  - workspace://examples/python-fastapi/minimal
---

# Minimal Backend — Generic HTTP

FINOS Workspace doesn't care which language or framework you use. This example shows the **HTTP shape** of a minimal backend so you can implement it in whatever stack you already have.

If you're already on Python and want a runnable starting point, see `workspace://examples/python-fastapi/minimal` instead.

## Routes

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/widgets.json` | JSON object keyed by widget id |
| `GET` | `/apps.json` | JSON array of app templates (optional) |
| `GET` | `/summary?team=platform` | A markdown string for the summary widget |
| `GET` | `/teams` | JSON array of `{label, value}` options for the `team` param |

That's it. Add more data routes for each widget you expose.

## Response shapes

### `GET /widgets.json`

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
        "description": "Team to summarize", "optionsEndpoint": "/teams", "value": "platform" }
    ]
  }
}
```

### `GET /apps.json`

```json
[
  {
    "name": "Team Summary",
    "description": "Weekly summary of a team",
    "img": "", "img_dark": "", "img_light": "",
    "allowCustomization": true,
    "tabs": {
      "": {
        "id": "", "name": "",
        "layout": [
          { "i": "weekly_summary", "x": 0, "y": 0, "w": 40, "h": 12, "groups": ["Group 1"] }
        ]
      }
    },
    "groups": [
      {
        "name": "Group 1",
        "type": "endpointParam",
        "paramName": "team",
        "widgetIds": ["weekly_summary"],
        "defaultValue": "platform"
      }
    ],
    "prompts": []
  }
]
```

### `GET /summary?team=platform`

```text
## Platform: week 17

- Shipped the new importer.
- Two incidents, both resolved within the hour.
```

### `GET /teams`

```json
[
  { "label": "Platform", "value": "platform" },
  { "label": "Support",  "value": "support" }
]
```

## CORS

Allow the origin the FINOS Workspace is served from, and `http://localhost:1420` for local development, on every route:

```text
Access-Control-Allow-Origin: <the origin of your FINOS Workspace>
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: *
```

In practice, send the matching origin from the request rather than echoing a list. Most frameworks have a CORS plugin for this.

## Auth (optional)

If the backend requires auth, accept either:

- A custom header (e.g. `X-API-KEY: <key>`), or
- A query string parameter (e.g. `?api_key=<key>`).

FINOS Workspace lets users register the backend connection with header or query-string credentials, which it then attaches to every widget request. Header is preferred — keys stay out of URLs and access logs.

## Encoding

Serve UTF-8 on every response. If you read JSON files from disk, open them explicitly as UTF-8 — defaulting to the OS locale will mangle non-ASCII content (Greek letters, em-dashes, emoji) on systems whose default isn't UTF-8.

## Picking a stack

Anything that can do the above works. Concrete starting points by ecosystem:

- Python — FastAPI, Flask, Starlette, Django REST.
- Node — Express, Fastify, Hono.
- Go — `net/http`, Echo, Gin, Chi.
- Rust — Axum, Actix-web.
- Java/Kotlin — Spring Boot, Ktor.
- C# — ASP.NET Core minimal APIs.

If you want a runnable Python sample to copy from, see `workspace://examples/python-fastapi/minimal`.
