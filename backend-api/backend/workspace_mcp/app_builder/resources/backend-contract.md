---
title: Backend Contract
uri: workspace://contract/backend
use_when: You need to understand what a FINOS Workspace backend must expose, regardless of language or framework.
language_specific: false
related:
  - workspace://specs/widgets-json
  - workspace://specs/apps-json
  - workspace://examples/generic-http/minimal
  - workspace://examples/python-fastapi/minimal
---

# Backend Contract

A FINOS Workspace backend is an **HTTP service** that returns JSON. FINOS Workspace fetches metadata and data from your backend over HTTP; it does not import your code, run your runtime, or care which language you use.

Any framework that can serve JSON over HTTP works: FastAPI, Flask, Django, Express, Fastify, Hono, Spring, Actix, ASP.NET, Go's `net/http`, etc. The contract below is identical for all of them.

## Required endpoints

| Method | Path | Returns | Required? |
|--------|------|---------|-----------|
| `GET`  | `/widgets.json` | JSON **object** keyed by widget id | Yes |
| `GET`  | `/apps.json`    | JSON **array** of app templates    | Optional, but required for app templates |
| The widget's `method`: `GET` (the default) or `POST` | One per widget | The response that widget's `type` expects | One per widget referenced from `widgets.json` |

The widget data endpoint URL is whatever each widget declares in `widgets.json` under `endpoint`. It can be any path on the same backend, with `{name}` placeholders that the widget's params fill, and no `?` or `#`. How the params reach it (path, query, headers or a JSON body) is in `workspace://specs/widgets-json` under "The request".

## Data endpoint response expectations

The shape FINOS Workspace expects is determined by the widget's `type`:

<!-- generated:returns -->
| Widget `type` | Endpoint returns |
|---|---|
| `markdown` | A markdown string, as text or as JSON with the string at `data.dataKey` |
| `html` | An HTML document as text |
| `newsfeed` | A JSON array of articles, or JSON with the array at `data.dataKey` |
| `pdf` | The PDF (`application/pdf`), or JSON with its `data_format` and a base64 `content` or a `url` |
| `iframe` | Nothing: the endpoint is the page's URL, which the browser opens |
<!-- /generated:returns -->

An `html` widget that sets `raw` also answers `raw=true` with the underlying rows as JSON. A `newsfeed` article is `{title, date, author, excerpt, body}`, with `body` in markdown. A plugin type's response is what its plugin describes.

See `workspace://specs/widget-types` for type guidance and `workspace://specs/widgets-json` for the metadata shape that wires endpoints to widget types.

## CORS

FINOS Workspace runs in a browser. Your backend MUST allow CORS from the origin the FINOS Workspace is served from: the address in the browser's address bar, for example `https://<your-workspace-host>`, and `http://localhost:1420` for a local development server.

A widget whose request carries a header param, a JSON body or `POST` makes the browser send a preflight `OPTIONS` first, and the Validate Widgets check sends a plain `OPTIONS` to every route and fails the route that does not answer. The backend must answer it for that route with:

- `Access-Control-Allow-Methods` including the widget's method, and the `optionsMethod` of its option lookups;
- `Access-Control-Allow-Headers` including `Content-Type` when there is a body, and every header param's name, plus the headers of the backend connection's credentials.

Most CORS middleware does this when configured with the methods and headers.

The FINOS Workspace API adds the backend connection's credentials, `X-Workspace-User` (the signed-in user's email) and `X-Workspace-Identity` (a signed token, described under Authentication) when it calls the backend.

Production browsers also block mixed content, so a backend used from an HTTPS FINOS Workspace must serve over HTTPS. Local development over HTTP is fine for `http://localhost`.

## Authentication

Auth is the backend's responsibility, not FINOS Workspace's. Common patterns:

- Custom request header (e.g. `X-API-KEY`) configured on the backend connection in FINOS Workspace, stored encrypted on the server and added by the API.
- Query parameter (e.g. `?api_key=...`) configured on the backend connection in FINOS Workspace, added by the API the same way.
- The signed identity token. The API sends `X-Workspace-Identity`, a JWT signed with ES256 that is valid for five minutes. Verify it with the public keys at `<API address>/.well-known/jwks.json`, which anyone may read. Its `iss` is the API's address, its `aud` is the origin of the backend connection, its `sub` is the user's UUID and its `email` is the user's email. A backend that does not check `aud` accepts a token that was made for another backend.
- The identity provider's ID token. When the administrator turns on `AUTHENTICATION_SEND_MICROSOFT_IDTOKEN` or `AUTHENTICATION_SEND_OKTA_IDTOKEN` and the user signed in with that provider, the API also sends the user's Microsoft Entra ID token as `X-Microsoft-Id-Token` or the user's Okta ID token as `X-Okta-Id-Token`, so that a backend can verify it with the provider. The API keeps the token and its refresh token on the server, renews the token before it expires, and never gives either to the browser.
- No auth at all (local dev, internal trusted network).

Header-based auth is preferred — keys stay out of URLs and access logs. FINOS Workspace lets users register backend connections with header or query-string credentials. The browser never holds their values.

## Optional endpoints and behaviors

- `GET /` — A friendly root response. Helpful for sanity checks but not required.
- `GET /thumbnails/{name}` — A simple way to serve app gallery SVG/PNG thumbnails referenced by `apps.json` `img`, `img_dark`, and `img_light`.
- A `theme` query parameter — FINOS Workspace sends `theme=dark|light` with `markdown`, `html`, `iframe` and plugin-type requests, so the response can match the user's UI theme. It asks again when the user switches the theme.
- A `raw` query parameter — Endpoints of `html` widgets that set `raw` can accept `raw=true` to return the underlying rows as JSON instead of the HTML, so AI agents can work with the data.

## Encoding

Always serve UTF-8. If your backend reads JSON files from disk to serve them, open those files explicitly as UTF-8. Defaulting to the OS locale will mangle non-ASCII content (Greek letters, em-dashes, emoji) on systems whose default isn't UTF-8.

## Language and framework neutrality

Nothing on this page is Python-specific. The fastest documented starter is FastAPI (see `workspace://examples/python-fastapi/minimal`), but `workspace://examples/generic-http/minimal` shows the same contract framework-neutrally. Pick whatever your project already uses.
