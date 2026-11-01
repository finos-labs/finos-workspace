# The `widgets.json` contract

Files: [README](README.md) · [AUTHORING](AUTHORING.md) · **WIDGETS-JSON** · [SECURITY](SECURITY.md)

A backend's `widgets.json` is an object whose keys are widget ids and whose values are widget definitions. This file covers what a definition may contain, the schema that defines every accepted key and value, how the web app turns a definition into a request, the `raw` rows, and a widget's link to an MCP tool of its backend. The field-by-field reference that backend authors and the app-builder agent read is `workspace://specs/widgets-json` (`backend-api/backend/workspace_mcp/app_builder/resources/specs/widgets-json.md`), generated from the same source (3.9).

## Contents

1. [A definition](#1-a-definition)
2. [Types](#2-types)
3. [The schema](#3-the-schema)
4. [Requests](#4-requests)
5. [The MCP tool link](#5-the-mcp-tool-link)

## 1. A definition

A definition needs `name`, `description`, `endpoint` and `type`. It may have `method`, `category`, `subCategory`, `source`, `showTitle`, `params`, `gridData`, `staleTime`, `refetchInterval`, `dataUpdateDisplay`, `runButton`, `disableRetrievalForCopilot`, `exportable`, `mcp_tool` and `data` (`dataKey`, and for some types more, section 2). `html` and plugin types also take `raw` (4.11), and `iframe` takes `storage` and `requires_auth` (4.12).

The contract defines every key, at any depth, and bounds every string and list. A key it does not define is ignored: the web app loads the widget without it and lists the key, by its JSON pointer, under the backend's unrecognized fields. Any other problem leaves the widget out of the catalog, reported with its JSON pointer.

## 2. Types

| `type` | Renders | Methods | Params go in |
|---|---|---|---|
| `markdown`, `html`, `newsfeed`, `pdf` | The built-in widgets | `GET`, `POST` | the query, a header, the body |
| `iframe` | A page at the endpoint's URL; `requires_auth` opens it through the API with the connection's credentials (4.12) | `GET` | the query |
| a plugin type | The plugin that handles it (README) | `GET`, `POST` | the query, a header, the body |

A plugin type exists for an organization when a plugin that handles it is enabled there; where two do, the organization admin's choice, else the lowest plugin id. A widget of a type nobody handles for the user is left out of their catalog.

A plugin type's own configuration lives in `data.<type>`: for a type `plotly`, the object at `data.plotly`. Its schema is the `definition` the plugin declares (AUTHORING 9), the plugin reads it as the `definition` trait, and a source refresh copies it, with `dataKey`, `rawDataKey`, `rawType` and `streamEndpoint`, onto widgets already on dashboards.

A plugin type's widget can also have `data.streamEndpoint`, a path or an absolute URL with no `?` and no `#`, like `endpoint`. For a plugin that has the permission `core:data:stream` (AUTHORING 4.2.1), FINOS Workspace opens it as a WebSocket and passes the JSON messages to the plugin: the widget's params are query values, the backend connection's query credentials are added, and `http` and `https` become `ws` and `wss`. The path resolves against the backend's address when the backend is connected, like `endpoint`.

## 3. The schema

### 3.1 One schema per organization

The API composes one JSON Schema for each organization from the kit (the base keys, each built-in type's rules and the plugin-type rules, generated from the web app's Zod contract) and the `definition` of each plugin type the organization has enabled.

### 3.2 Closed

In the composed schema every object has `additionalProperties: false` or a defined value schema, every string a `maxLength`, `enum`, `const` or `pattern`, every array `maxItems`. The web app reads a failed `additionalProperties: false` as a key to ignore (section 1), unless it falls inside a `oneOf` or `anyOf` that no branch matched. A test walks the kit and fails on anything open. The same walk runs on a plugin's `definition` when the plugin is discovered: one that is not closed and bounded blocks the version, naming the offending node.

### 3.3 A plugin's fragment

A `definition` may use `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `pattern` (at most 256 characters, no backreferences), `minItems`, `maxItems`, `uniqueItems`, `oneOf`, `anyOf`, local `$defs` and `$ref`, and the annotations `title`, `description`, `default` and `examples`. It is at most 64 KiB and eight levels deep. The composer itself writes `if` and `then` where it needs them (4.9).

### 3.4 Shape

```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "urn:workspace:widgets-json:<etag>",
  "type": "object",
  "additionalProperties": { "$ref": "#/definitions/Widget" },
  "x-types": ["markdown", "html", "newsfeed", "pdf", "iframe", "<plugin type>"],
  "definitions": {
    "Widget": { "oneOf": [{ "$ref": "#/definitions/Widget_markdown" }, "..."] },
    "Widget_<type>": { "type": "object", "additionalProperties": false, "required": ["name", "description", "endpoint", "type"], "properties": { "type": { "const": "<type>" }, "data": { "$ref": "#/definitions/Data_<type>" }, "...": "..." } },
    "Data_<type>": { "type": "object", "additionalProperties": false, "properties": { "dataKey": {}, "<plugin type>": "the plugin's definition" } },
    "PluginConfig_<plugin type>": "the handler widget's settings, closed",
    "ParamDef": "one closed branch per param type",
    "McpTool": "5.6"
  }
}
```

Each `Widget_<type>` is complete on its own, so the schema works with any draft-7 validator. For readable errors, check `type` against `x-types` first and validate against that one branch.

### 3.5 Where it is built and served

- **Source.** `frontend/src/lib/types/widgetsContract.ts` (strict Zod objects, the header tables, each type's methods, locations and reserved query names). `widgetsSchemaKit.ts` turns it into the kit, and `node scripts/generate-widgets-schema.ts` (from `frontend/`) writes `backend-api/backend/api/widget_plugins/widgets_schema_kit.json`. A Vitest test fails when the committed kit is stale.
- **Composer.** `backend-api/backend/api/widget_plugins/widgets_schema.py`. `python -m scripts.compose_widgets_schema` prints a composition offline, and a pytest test fails when the web app's fixture `frontend/tests/mocks/widgets-schema.json` is not the composer's output.
- **Endpoint.** `GET /app/widget-plugins/widgets-schema`, for the signed-in user's organization (a superuser may pass `?entity=`), with an `ETag` and `304` for `If-None-Match`. With the feature off it has the built-in types only.

### 3.6 In the web app

The plugin list and the schema are fetched together, and the schema is handed to the worker that loads backends; a new `$id` validates the connected backends again. `validateWidgetDefinition` (`lib/utils/widgetsSchemaValidation.ts`, with `ajv`) checks a widget against its type's branch and returns messages with JSON pointers, then `contractProblems` (`lib/utils/widgetsContractChecks.ts`) runs the checks of 3.7.

### 3.7 Checks in code

What JSON Schema cannot state:

- every `{name}` in `endpoint` or `optionsEndpoint` names a declared param, and a param in a path placeholder declares no `in` and takes one value;
- `paramName` is unique, and a `$name` in `optionsParams` or `mcp_tool.args` names a declared param;
- a form's inputs are unique, and its placeholders name an input or a param;
- at most one param has the role `fileSelector`, and cron expressions are valid;
- a header param is not a header the backend connection uses for its credentials, and a query param not a query name it uses;
- `mcp_tool.mcp_server` names a server of the backend's `apps.json` (5.3).

### 3.8 The instance-level schemas

Creating or changing a widget through the FINOS Workspace MCP takes two argument objects, and `get_widget_schema` returns a closed schema for each (`frontend/src/lib/utils/widgetArgsSchema.ts`, checked with `ajv`):

- `data_args_schema`: one property per declared param. A param with static options takes an enum of them; a number also takes a numeric string; a date takes `YYYY-MM-DD` or `$currentDate` with a modifier; a `multiSelect` or `multiple` param takes a list or a comma-separated string. A value the schema refuses is ignored with a warning naming the key.
- `ui_args_schema`: `name`, `description`, `source`, and `innerTab` and `gridData` for `create_widget`, plus the keys of the component that renders the widget: `text` for markdown, `html` for HTML, and `config` for a plugin widget, from the plugin's settings and stored in `storage.plugin.config`. An undefined key or a wrong value refuses the whole call (`invalid_request`, naming each path), and a dry run returns `valid: false` with the problems.

Each param row also carries `in`: `path`, `query`, `header` or `body`. `get_widget_schema` returns the widget's `method` and `mcp_tool` too.

### 3.9 Generated spec pages

`backend-api/backend/scripts/generate_app_builder_specs.py` writes, from the kit, the type catalog (`specs/widget-types.md`), each type's response (`backend-contract.md`), the widget fields (`specs/widgets-json.md`), and the param fields and header-name rules (`specs/widget-parameters.md`), between `<!-- generated:<name> -->` markers, and copies the pages to the agent's MCP server (`agent/mcp-server/src/resources/app-builder/`). A pytest test fails when a page is stale. The pages list the built-in types; a plugin's types vary by organization, so they point to `workspace://specs/widgets-json-schema`, which the user's FINOS Workspace tab answers over the bridge with their organization's composed schema.

### 3.10 `apps.json` templates

A layout item's `state.storage.plugin.config` sets a plugin widget's configuration in a template. When a backend loads, an app whose layout item sets it for a widget of a built-in type, or with a value the plugin's settings refuse (`PluginConfig_<type>`), is reported with the path of each problem and left out. Opening the app merges the template's state into the widget's storage, where the plugin widget reads it.

## 4. Requests

The web app calls the backend from the browser. It builds every request in one place, `frontend/src/lib/utils/widgetRequest.ts`, for the widgets, the parameter bar's option lookups, forms, the Copilot's data and option requests, and the `iframe` page's URL.

| Key | On | Values | Default |
|---|---|---|---|
| `method` | the widget | `GET`, `POST` | `GET` |
| `in` | each param, except `form` params and params in a path placeholder | `query`, `header`, `body` | `query` |
| `optionsMethod` | `endpoint` params, and `endpoint` inputs of a `form` | `GET`, `POST` | `GET` |

### 4.1 The widget's request

1. **URL.** `endpoint` is a path on the backend or an absolute URL with no `?` and no `#`; a static query value is a param with a default and `show: false`. Path placeholders are filled (4.2), then each `in: "query"` param is appended.
2. **Headers.** The FINOS Workspace API makes the request. It adds the backend connection's credentials, `X-Workspace-User` (the signed-in user's email) and `X-Workspace-Identity` (a signed token, see "Who is calling"), and the browser sends none of them. Then each `in: "header"` param goes as `paramName: value`.
3. **Body.** With `POST`, the `in: "body"` params as one flat JSON object, with `Content-Type: application/json`. No body params, no body.
4. **Host params.** `theme` (`dark` or `light`) for `markdown`, `html`, `iframe` and plugin types, and `raw=true` when the host asks a widget for its rows (4.11), go in the query whatever the method. A change of the site's theme sends the request again.

A param whose value is undefined, null or an empty string is not sent; `0` and `false` are. A param's value is the one stored for it, else its default; only declared params are sent. When a request cannot be built, the widget shows the problems in place of its content, naming each param ("`team` needs a value"), an `iframe` shows them in place of the page, a form in a toast, and the Copilot gets them as the call's error.

### 4.2 Path params

A `{name}` placeholder in `endpoint` takes the value of the param named `name`, encoded as one path segment (`encodeURIComponent`). The param is sent nowhere else, declares no `in`, takes one value, and is required: with no value the request is not sent. A placeholder that names no param is an error.

### 4.3 Values

| Param | In the query, a header or the path | In the body |
|---|---|---|
| `text`, `tabs` | the string | a JSON string |
| `number` | the decimal string | a JSON number |
| `boolean` | `true` or `false` | a JSON boolean |
| `date` | `YYYY-MM-DD`, after `$currentDate` modifiers | a JSON string |
| `endpoint` | the option's value as a string | the option's value |
| with `multiSelect` or `multiple` | the values joined with commas (not in the path) | a JSON array; a default given as a comma-separated string is split |

### 4.4 Rules

1. `body` params need `method: "POST"`.
2. `paramName` is unique in a widget.
3. A `form` posts its `inputParams` as a JSON body to its own `endpoint` with its own method (`POST` or `PUT`); `in` is not accepted on it or its inputs.
4. `iframe`: `GET`, params in the query or the path.
5. `theme` is reserved as a query param name for `markdown`, `html`, `iframe` and plugin types, and `raw` for `html` and plugin types.
6. A header param's `paramName` is 1 to 64 characters of the HTTP token set. Not allowed: the names a browser forbids page script to set (`Accept-Charset`, `Accept-Encoding`, `Access-Control-Request-Headers`, `Access-Control-Request-Method`, `Connection`, `Content-Length`, `Cookie`, `Date`, `DNT`, `Expect`, `Host`, `Keep-Alive`, `Origin`, `Referer`, `Set-Cookie`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`, `Via`, and names starting `Proxy-` or `Sec-`), the names FINOS Workspace sets or reserves (`Authorization`, `Content-Type`, `Accept`, `X-Microsoft-Id-Token`, `X-Okta-Id-Token`, `X-Workspace-Identity`, `X-Workspace-User`), and any header the backend connection's credentials use. A header value is printable ASCII of at most 1,024 characters.
7. Credentials belong to the backend connection, never in params: a param's value is saved with the dashboard and shown in the UI. A param named like one of the connection's query credentials is refused.

### 4.5 CORS

A header param, a JSON body or `POST` makes the browser send a preflight, so the backend answers `OPTIONS` with `Access-Control-Allow-Methods` including the method and `Access-Control-Allow-Headers` including `Content-Type` (with a body) and every header param name. Every route answers `OPTIONS`: Validate Widgets (4.8) sends one to each and fails a route that does not answer.

#### Who makes the request

The browser asks the FINOS Workspace API (`POST /app/data-connectors/api-source/{id}/request`) to call the backend, sending only the connection's id, the URL, the method, the header params, the body and the `Accept` value. The API refuses a URL that is not on the connection's origin, a header the connection or the API sets, and a query name the connection's credentials use. Any HTTP method goes through, the connection's own headers are never overridden, redirects on the connection's origin are followed with the credentials, and the backend's response headers come back except cookies and hop-by-hop ones. It calls the backend with the stored credentials, `X-Workspace-User` and `X-Workspace-Identity`, and streams the answer back with the backend's status code. A refusal by the API carries the header `X-Workspace-Proxy-Error`, and a `429` or `503` carries `Retry-After`. The limits, per API process unless said otherwise: 128 requests open at once for one user and 2,000 for the process; 1,200 requests a minute for one user (a framed page's own requests have a separate 6,000 a minute, 120 grants and 120 sockets a minute); 50 seconds for the backend to start its answer, 120 seconds without a byte, an hour for one response, and an error, not a short answer, past 256 MB (a framed page has no size limit); request bodies of 2 MiB, or 10 MiB for a framed page, checked before they are read. The API holds no database connection while it waits for or streams a backend's answer, reuses connections to administrators' backends, does not compress what it relays, and counts requests in the shared rate limiter, which it skips for 30 seconds when that store does not answer. A process lets at most 512 requests wait at the same moment for the first byte of one backend and answers the others with `503` and `Retry-After`; after five failures in a row to reach a backend (no answer in time, or no connection) it refuses requests to that backend with `503` for ten seconds and then lets one try, and any answer from the backend ends the refusal; a request whose browser has gone away is cancelled and gives its place back. The grant reads a connection's `widgets.json` once a minute for all its grants, and a framed page's requests check the user's access at most every 30 seconds. The web app sends at most 6 of these requests at a time, gives up on one that has not started to answer after 60 seconds, waits as `Retry-After` says, and does not check a connection that it checked successfully in the last 30 minutes unless the connection changed or the user chose Refresh. A connection kept by a superuser, or added for an organization (`POST /entity/data-backends/{entity_uuid}`), may be a private or plain `http` address. Any other user's connection can only be a public `https` address, except on a developer's own machine (`MODE=local`), where it may be private or plain `http` too. Credentials are stored encrypted on the server and never reach the browser: a listing of connections names each header and whether it is a header or a query value, and saving a blank value keeps the stored one. A request to another origin than the connection's goes from the browser with no credentials.

#### Who is calling

Every call the API makes to a backend connection or an agent for a user carries who that user is, in two ways that need nothing from the browser.

`X-Workspace-User` is the user's email. `X-Workspace-Identity` is a JWT that the API signs with ES256 and that is valid for five minutes. Its `iss` is the API's address (`SELFURL`), its `aud` is the connection's origin (scheme, host and port, in lower case, without a path or credentials), its `sub` is the user's UUID and its `email` is the user's email. A backend verifies it with the public keys at `GET <API address>/.well-known/jwks.json`, which anyone may read without a session and which are cached for five minutes. It checks the signature, `exp`, `iss` and `aud`; a backend that skips `aud` accepts a token that was made for another backend. The API signs with a key it creates when it needs one, keeps the private key encrypted in its database, signs with a key for 30 days, and publishes a key for one day more, so a backend that reads the keys again when it meets an unknown `kid` never fails a rotation.

When the administrator sets `AUTHENTICATION_SEND_MICROSOFT_IDTOKEN` or `AUTHENTICATION_SEND_OKTA_IDTOKEN` to `true`, the API also sends the signed-in user's ID token from that provider, as `X-Microsoft-Id-Token` or `X-Okta-Id-Token`, so that a backend or an agent that verifies tokens with Microsoft Entra or Okta keeps working. The browser never holds that token. The user signs in on the server (the API redirects the browser to the provider and receives the authorization code itself, with PKCE), asks the provider for `offline_access`, and the API keeps the ID token and the refresh token encrypted, ties them to the session, renews the ID token before it expires (one renewal at a time for a session, whichever API process asks), replaces the refresh token whenever the provider rotates it, and deletes both as soon as the session ends, whether by sign-out, expiry, a password reset, the removal of the user or a new sign-in: sign-out deletes them at once, and any other end is found within a minute. Each time it also revokes the refresh token at the provider when the provider offers a revocation endpoint (Okta does; Microsoft Entra offers none, so the API only deletes its copy and Entra expires the token itself). A refresh token that the provider refuses ends the session, and the user signs in again. If the provider cannot be reached, the call goes without the provider's token. The token goes to every saved connection and agent the user can call, so turn the setting on only when all of them are to be trusted with it; a connection or an agent that is only being tried before it is saved gets the signed identity but never the provider's token.

### 4.6 Caching

A widget request's cache key has the method, the URL with its query, the values of its header params and its body. Credential values stay out of it.

### 4.7 Option lookups

An `endpoint` param loads its choices from `optionsEndpoint` with `optionsMethod`. Placeholders are filled from `optionsParams` as in 4.2; the other `optionsParams` go in the query for `GET` or a flat JSON body for `POST`. An `optionsParams` value is a string, number or boolean, and a string starting with `$` is the current value of the widget's param of that name. Empty values are not sent. The answer is a JSON array of strings or `{ label, value }` objects.

### 4.8 Other requests

- **Validate Widgets** (the Apps form) checks routes without running any: one plain `OPTIONS` with no credentials, query, headers or body per distinct route (every widget `endpoint`, `optionsEndpoint` and form `endpoint`), six at a time, with placeholders filled from defaults. A `404`, or no answer, fails the route. It first sends `OPTIONS` to a path that cannot exist, and when that is not a `404` (a backend that answers every `OPTIONS`) it reports that the routes cannot be checked this way. A route with a placeholder that has no default, or on another origin than the backend's, is reported as not checked.
- **The Copilot** builds its data and option requests with the same builder, so the agent gets what the widget gets. `input_args` that name no param of the widget are refused with the list of its params.

### 4.9 In the schema

`method` is an enum on every branch (`GET` only for `iframe`), `in` on every param branch but `form`, `endpoint` and `optionsEndpoint` match `^[^?#]+$`, and `optionsParams` values are strings, numbers or booleans. Per branch the composer adds: a body param requires `POST`; for `html` and plugin types, `data.rawDataKey` or `data.rawType` requires `"raw": true`; `disableRetrievalForCopilot: true` excludes `mcp_tool`. Header names are checked against the forbidden list from the same table the code uses.

An example:

```json
{
  "team_report": {
    "name": "Team report",
    "description": "Report for one team and period",
    "type": "markdown",
    "method": "POST",
    "endpoint": "/teams/{team}/report",
    "params": [
      { "paramName": "team", "type": "endpoint", "label": "Team",
        "optionsEndpoint": "/teams/search", "optionsMethod": "POST", "optionsParams": { "active": true } },
      { "paramName": "period", "type": "text", "label": "Period", "value": "month" },
      { "paramName": "X-Region", "type": "text", "label": "Region", "value": "eu", "in": "header" },
      { "paramName": "filters", "type": "text", "label": "Filters", "value": "active", "in": "body" }
    ]
  }
}
```

With `team` set to `platform`, the request is `POST <backend>/teams/platform/report?period=month&theme=dark` with `X-Region: eu`, `Content-Type: application/json` and the body `{"filters":"active"}`. The choices for `team` come from `POST <backend>/teams/search` with `{"active":true}`.

### 4.10 In the code

`buildWidgetRequest`, `buildOptionsRequest`, `buildFormRequest`, `requestInit` and `requestKey` in `widgetRequest.ts`. A backend widget's catalog entry and the widget made from it carry `endpoint` as `{ url, method }`.

### 4.11 The rows: `raw`

A widget whose view is made from data, such as an html page or a plugin's chart, can also answer with that data as rows, so that the AI Agent, MCP clients and the user can read what it shows. `raw` is a key of `html` and of every plugin type:

```json
{
  "monthly_sales": {
    "name": "Monthly sales",
    "description": "Sales per month, by series",
    "type": "plotly",
    "endpoint": "/charts/monthly-sales",
    "raw": true,
    "data": { "dataKey": "results.chart", "rawDataKey": "results.records" }
  }
}
```

- **The request** is the widget's own, with its current params and `raw=true` in the query.
- **The rows** are at `data.rawDataKey`, a path like `dataKey`; without it, the response's `results`, else the whole response. One endpoint can answer both with `{"results": {"chart": {...}, "records": [...]}}`.
- **Who gets them.** When `raw` is set, the AI Agent and MCP clients get the rows, never the HTML or the chart: the widget's data in the Copilot, `get_widget_data` and `read_widget`. The agent loads a list of objects as a table it can query.
- **The rows view.** The card's database button switches between the widget's view and its rows, and the choice is kept with the widget. The plugin of `data.rawType` shows the rows when the user may use that type; otherwise an `html` widget shows them as a table, and a plugin type's own plugin shows them (AUTHORING 4.2).
- **Rules.** `data.rawDataKey` and `data.rawType` only with `"raw": true`; `rawType` is a type name (`^[a-z][a-z0-9_-]{1,31}$`); `raw` is a reserved query param name for these types.
- **Code.** `rowsOf` (`lib/utils/rawRows.ts`) reads the rows for every caller; `useRawRows`, `RowsToggle` and `RowsTable` (`components/Widgets/Helpers/RawRows.tsx`) serve the html and plugin widgets; `useRowsPlugin` (`plugins/registry.ts`) finds the plugin of `rawType`; `getCustomWidgetsData` asks a widget with `raw` for its rows.
### 4.12 The iframe protocol

An `iframe` widget opens the page at its endpoint, and the page can offer subwidgets and data to the host over `postMessage`. The host never asks the backend for that data itself: it asks the page, and the page gets it from its own backend. The code is `types/iframeProtocol.ts`, `useIframeProtocol` and `Iframe.tsx`; the tests are in `useIframeProtocol.test.ts`.

| Direction | Message | Carries |
|---|---|---|
| page to host | `workspace-connect` | `widgets`: the subwidgets (`widgetId`, `name`, `description`, `category`, `dataType` of `table` or `markdown`); `params`: the page's param definitions (`paramName`, `label`, `type` of `text`, `number`, `date` or `boolean`, `value`, `options`, `min`, `max`, `step`) |
| page to host | `workspace-data` | `widgetId`, `dataType`, `data` (rows or text) and `columns`: the answer to a `workspace-request` |
| page to host | `workspace-error` | `widgetId`, `error`: the failure of a `workspace-request` |
| page to host | `aiData` | `data`: what the page gives the AI Agent on its own |
| page to host | `workspace:params:update`, `workspace:widget-params:update` | `params`, or `paramName` and `value`: the page changes the widget's params |
| host to page | `workspace-request` | `widgetId`: asks for one subwidget's data, answered within 10 seconds |
| host to page | `workspace-params-update` | `params`: the widget's current params; also how the AI Agent's `update_widget` reaches the page |
| host to page | `workspace-auth` | `headers`: the headers the browser may hold, `X-Workspace-User` when `AUTHENTICATION_SEND_USER_EMAIL_AS_HEADER` is on. Sent once after `workspace-connect`, only to the page's own origin. It never carries the backend connection's credentials |

The host trusts a message because it came from the iframe's own window, not because of its origin, and it answers to the origin of `workspace-connect`, or to any origin when the page has none (the sandbox below). The subwidgets in `workspace-connect` are the widgets a user or the AI Agent can add from the page.

#### Pages that need the connection's credentials

A page that calls its backend with the connection's key cannot be given the key: the browser never holds it. Declare `"requires_auth": true` on the `iframe` widget instead, and only for a page you trust:

```json
{
  "dashboard": {
    "name": "Dashboard",
    "type": "iframe",
    "endpoint": "/dash/index.html",
    "requires_auth": true
  }
}
```

- **The grant.** The web app asks the API (`POST /app/data-connectors/api-source/{id}/frame`). The API reads the connection's own `widgets.json` and grants only a widget that is an `iframe` with `requires_auth: true` and whose endpoint is on the connection's origin. The widget saved in a dashboard is not trusted for this.
- **The token** is signed, valid for an hour, and limited to the user, the connection, the widget and the endpoint's directory. It is a `ws_frame_` string in the address the browser opens, `/app/data-connectors/frame/<token>/<path>`, and it opens nothing outside that directory. It stops working when the user can no longer use the connection, is removed, or signs out of the session that asked for it, checked at most every 30 seconds for pages and every minute for sockets. The web app asks for a new one every 50 minutes, which reloads the page.
- **The page** is fetched by the API with the connection's credentials, `X-Workspace-User` and `X-Workspace-Identity`, and runs in a sandbox without `allow-same-origin`. It has no `localStorage`, `sessionStorage`, `IndexedDB` or cookies, and cannot use the user's session. Every response carries `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-downloads` and `Referrer-Policy: no-referrer`; the backend's own `Set-Cookie` is dropped.
- **WebSockets** work. A page opens `new WebSocket(...)` on a URL below its own directory, for example `new URL('./stream', location.href)` with `http` replaced by `ws`, and the API opens the socket to the backend with the connection's credentials, `X-Workspace-User`, `X-Workspace-Identity` and the connection's own origin as `Origin`, and relays text and binary messages both ways with the subprotocol the backend chooses. The backend's close code reaches the page. The API refuses the handshake for a bad or expired token, a path outside the directory, and an unreachable backend, and ends the socket when the token expires or the user can no longer use the connection (checked every minute). A message may be 8 MB. A user may have 32 sockets open on one API process, and a process 1,000; past that the API closes the socket with code 1013 (try again). The backend has 15 seconds to answer the upgrade, a redirect of the upgrade is refused, and the API pings the backend every 30 seconds. A failed or slow access check, such as a database that does not answer, does not close a socket; only a refusal does.
- **What it needs from the page.** Relative URLs below the endpoint's directory (a page that loads `/static/app.js` or opens a socket at `/_stcore/stream` asks the API's root, and fails); plain HTTP, server-sent events (streamed without a size limit) and WebSockets; no use of browser storage, which throws a `SecurityError`.
- **Logs.** The API masks the token in its own logs. A load balancer or ingress logs the address too: mask the `ws_frame_` segment of the path in its access-log format.
- **Without `requires_auth`** the page opens directly, in a sandbox with `allow-same-origin`, and signs in with its own session; storage and cookies are the page's own.


## 5. The MCP tool link

A widget may name one MCP tool of its own backend: the tool the agent uses to query that backend for what the widget shows. The key is `mcp_tool`, valid on every type.

### 5.1 Servers

A backend declares MCP servers on the templates of its `apps.json` (`mcpServers`: `name`, `description`, `url`, `authType`). Connecting the backend registers each declared server once, recording its declared name and the backend's id, without the backend's credentials, which the browser does not hold; the declared name cannot be edited, unlike the server's display name. The agent's tools are the enabled tools of the connected servers that the user may use, sent when the agent has MCP tools on. A user may use every server that one of their roles grants and every server declared by a backend they can use: the `mcpServers` of its `apps.json` and the `storage.mcpUrl` of its `iframe` widgets. Using the backend is the approval; no server is granted one by one. The browser makes each call through `/app/mcp-proxy`, which checks the same access again for every `tools/call`.

### 5.2 The key

```jsonc
"mcp_tool": {
  "mcp_server": "<name of a server in the same backend's apps.json mcpServers>",
  "tool_id": "<the tool's name on that server>",
  "args": { "<tool argument>": "$<paramName>" }
}
```

| Key | |
|---|---|
| `mcp_server` | Required. The `name` of a server the same backend's `apps.json` declares, compared exactly. Not a URL. |
| `tool_id` | Required. The tool's name on that server, compared exactly. |
| `args` | Optional. How the widget's params fill the tool's arguments: a key is a tool argument, a value is `$<paramName>` or a literal string, number or boolean. Absent, every param whose name is a property of the tool's input schema fills that argument. Present, it is the whole mapping. |

### 5.3 Rules

1. **Opt-in.** A widget without `mcp_tool` has no linked tool. The link adds nothing to the agent's tool list: the server's tools are there when the server is registered, enabled and allowed.
2. **Same backend.** A widget whose `mcp_server` names no server of its backend's `apps.json` is reported with `[mcp_tool/mcp_server]` and left out. The check runs only when `apps.json` loaded with no invalid app. A backend with no `apps.json` declares no server. One name for two servers (different URLs) in one backend makes the later app invalid.
3. **Identity.** A call is attributed to a widget only when the server was registered for the widget's backend, its declared name equals `mcp_server`, and the tool equals `tool_id`.
4. **Active.** The link is active when the tool is in the request's tool list: the server connected and enabled, the tool on, the server allowed to the user, and MCP tools on for the agent. Otherwise the widget behaves as if it had no link.
5. **Several widgets, one tool.** A call is cited to the widget whose literal `args` all equal the call's arguments, the one with the most literals first, then the first the backend declares.
6. **Not with `disableRetrievalForCopilot: true`**, which keeps the widget from the agent.
7. **Host-only.** A plugin's frame gets no trait for the link and has no command or permission to call the tool.
8. **`iframe`.** `storage.mcpUrl` binds a server of the iframe's own to the instance, without the backend's credentials. It does not use or conflict with `mcp_tool`. The backend that declares it is the approval: whoever can use the backend can use the server's tools, and a changed URL needs no new approval.

### 5.4 What the web app and the agent do

1. **The agent is told.** Where the request is assembled (`lib/utils/mcpLink.ts`, used in `useAiFetchRequestInit.tsx`), a widget row gains `mcp_tool: { server_id, tool_name, args }` when the request's tools include the linked tool; `server_id` and `tool_name` come from that list, never from the widget's strings.
2. **The agent shows it.** Its `search_widgets` rows carry `mcp_tool: { tool, args }` with the tool named as the model calls it (`linkedToolName`, `agent/src/mcp/factory.ts`), and its prompt's widget lists tag the widget `[query tool: <name>]`. Nothing is routed by it: the model chooses.
3. **A call cites the widget** (`citeMcpCall`, used by `useMcpExecutor`). Only widgets of the server's own backend that name its declared name and the tool are candidates; `input_args` are built through the mapping in reverse, and arguments that map to no param go in the citation's `details`. An answer cites a widget once, however many calls cited it: the first citation of a widget is kept, for the calls of a linked tool and for those of an `iframe` widget's own server.
4. **The FINOS Workspace MCP** returns the link in `list_available_widgets` and `get_widget_schema`.

### 5.5 Security

- **The owner reports the declared servers.** The web app sends the URLs a backend declares to `PUT /app/data-connectors/api-source/{source_uuid}/mcp-servers` whenever it loads the backend. The API accepts the report from the backend's owner, and from a superuser for an entity backend; anyone else gets 404. The API grants the reported servers, with every tool, to the users who can read the backend: the entity's backends, the backends a role of the user approves, and the user's own backends when the account type may add connections.
- **The link grants nothing.** The call uses the user's own connection to the server, the user's roles (`RoleMcpAccess`) and the backends the user can use decide, and the proxy checks every `tools/call`.
- **`args` is a mapping, not a policy.** The model chooses the arguments and the server decides what a call may do.
- **Only the backend's own servers.** The name resolves against the same backend's declarations, so a widget cannot have another backend's results cited as its own, or point the backend's credentials at a host the backend did not declare.
- **No tool call at validation.** Validate Widgets never calls a tool.

### 5.6 In the schema

```jsonc
"mcp_tool": {
  "type": "object", "additionalProperties": false, "required": ["mcp_server", "tool_id"],
  "properties": {
    "mcp_server": { "type": "string", "minLength": 1, "maxLength": 128 },
    "tool_id":    { "type": "string", "minLength": 1, "maxLength": 128 },
    "args": { "type": "object", "maxProperties": 32,
              "additionalProperties": { "type": ["string", "number", "boolean"], "maxLength": 256 } }
  }
}
```

### 5.7 Example

A backend's `apps.json` declares the server:

```json
[{ "name": "Teams", "tabs": {}, "mcpServers": [{ "name": "Team data", "url": "https://<mcp-host>/mcp", "authType": "token" }] }]
```

The `team_report` widget of 4.9 opts in:

```json
"mcp_tool": { "mcp_server": "Team data", "tool_id": "get_team_report", "args": { "team_id": "$team", "period": "$period" } }
```

The agent's row for the widget names `get_team_report` and the mapping. A call with `{ "team_id": "platform", "period": "month" }` is cited as `team_report` with the `input_args` `{ "team": "platform", "period": "month" }`. The same call on a widget of another backend that names `Team data` does not match.
