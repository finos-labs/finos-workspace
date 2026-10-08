---
title: Backend Contract
uri: workspace://contract/backend
use_when: You need to understand what an Workspace backend must expose, regardless of language or framework.
language_specific: false
related:
  - workspace://specs/widgets-json
  - workspace://specs/apps-json
  - workspace://examples/generic-http/minimal
  - workspace://examples/python-fastapi/minimal
---

# Backend Contract

An Workspace backend is an **HTTP service** that returns JSON. Workspace fetches metadata and data from your backend over HTTP; it does not import your code, run your runtime, or care which language you use.

Any framework that can serve JSON over HTTP works: FastAPI, Flask, Django, Express, Fastify, Hono, Spring, Actix, ASP.NET, Go's `net/http`, etc. The contract below is identical for all of them.

## Required endpoints

| Method | Path | Returns | Required? |
|--------|------|---------|-----------|
| `GET`  | `/widgets.json` | JSON **object** keyed by widget id | Yes |
| `GET`  | `/apps.json`    | JSON **array** of app templates    | Optional, but required for app templates |
| `GET` (or `POST`) | One per widget | The response that widget's `type` expects | One per widget referenced from `widgets.json` |

The widget data endpoint URL is whatever each widget declares in `widgets.json` under `endpoint`. It can be any path on the same backend.

## Data endpoint response expectations

The shape Workspace expects is determined by the widget's `type`:

| Widget `type` | Endpoint should return |
|---------------|-------------------------|
| `markdown` | A markdown string (or JSON with the string at the widget's `data.dataKey`) |
| `html` | An HTML document as text (and, when the widget sets `raw`, the underlying rows as JSON for `raw=true`) |
| `newsfeed` | A JSON array of articles `{title, date, author, excerpt, body}` (or JSON with the array at the widget's `data.dataKey`); `body` is markdown |
| `pdf` | The PDF (`application/pdf`), or JSON with a base64 `content` or a `url` |
| `iframe` | Nothing: the widget's `endpoint` is the URL of the page to embed |

See `workspace://specs/widget-types` for type guidance and `workspace://specs/widgets-json` for the metadata shape that wires endpoints to widget types.

## CORS

Workspace runs in a browser. Your backend MUST allow CORS from the origin the Workspace is served from: the address in the browser's address bar, for example `https://<your-workspace-host>`, and `http://localhost:1420` for a local development server.

Production browsers also block mixed content, so a backend used from an HTTPS Workspace must serve over HTTPS. Local development over HTTP is fine for `http://localhost`.

## Authentication

Auth is the backend's responsibility, not Workspace's. Common patterns:

- Custom request header (e.g. `X-API-KEY`) configured on the backend connection in Workspace.
- Query parameter (e.g. `?api_key=...`) configured on the backend connection in Workspace.
- No auth at all (local dev, internal trusted network).

Header-based auth is preferred — keys stay out of URLs and access logs. Workspace lets users register backend connections with header or query-string credentials.

## Optional endpoints and behaviors

- `GET /` — A friendly root response. Helpful for sanity checks but not required.
- `GET /thumbnails/{name}` — A simple way to serve app gallery SVG/PNG thumbnails referenced by `apps.json` `img`, `img_dark`, and `img_light`.
- A `theme` query parameter — Workspace sends `theme=dark|light` with `markdown` and `html` requests, so the response can match the user's UI theme.
- A `raw` query parameter — Endpoints of `html` widgets that set `raw` can accept `raw=true` to return the underlying rows as JSON instead of the HTML, so AI agents can work with the data.

## Encoding

Always serve UTF-8. If your backend reads JSON files from disk to serve them, open those files explicitly as UTF-8. Defaulting to the OS locale will mangle non-ASCII content (Greek letters, em-dashes, emoji) on systems whose default isn't UTF-8.

## Language and framework neutrality

Nothing on this page is Python-specific. The fastest documented starter is FastAPI (see `workspace://examples/python-fastapi/minimal`), but `workspace://examples/generic-http/minimal` shows the same contract framework-neutrally. Pick whatever your project already uses.
