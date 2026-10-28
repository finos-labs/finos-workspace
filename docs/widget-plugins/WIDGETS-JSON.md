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

A definition needs `name`, `description`, `endpoint` and `type`. It may have `method`, `category`, `subCategory`, `source`, `showTitle`, `params`, `gridData`, `staleTime`, `refetchInterval`, `dataUpdateDisplay`, `runButton`, `disableRetrievalForCopilot`, `exportable`, `mcp_tool` and `data` (`dataKey`, and for some types more, section 2). `html` and plugin types also take `raw` (4.11), and `iframe` takes `storage`.

The contract defines every key, at any depth, and bounds every string and list. A key it does not define is ignored: the web app loads the widget without it and lists the key, by its JSON pointer, under the backend's unrecognized fields. Any other problem leaves the widget out of the catalog, reported with its JSON pointer.

## 2. Types

| `type` | Renders | Methods | Params go in |
|---|---|---|---|
| `markdown`, `html`, `newsfeed`, `pdf` | The built-in widgets | `GET`, `POST` | the query, a header, the body |
| `iframe` | A page at the endpoint's URL | `GET` | the query |
| a plugin type | The plugin that handles it (README) | `GET`, `POST` | the query, a header, the body |

A plugin type exists for an organization when a plugin that handles it is enabled there; where two do, the organization admin's choice, else the lowest plugin id. A widget of a type nobody handles for the user is left out of their catalog.

A plugin type's own configuration lives in `data.<type>`: for a type `plotly`, the object at `data.plotly`. Its schema is the `definition` the plugin declares (AUTHORING 9), the plugin reads it as the `definition` trait, and a source refresh copies it, with `dataKey`, `rawDataKey` and `rawType`, onto widgets already on dashboards.

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

`backend-api/backend/scripts/generate_app_builder_specs.py` writes, from the kit, the type catalog (`specs/widget-types.md`), each type's response (`backend-contract.md`), the widget fields (`specs/widgets-json.md`), and the param fields and header-name rules (`specs/widget-parameters.md`), between `<!-- generated:<name> -->` markers, and copies the pages to Ines's MCP server (`agent/mcp-server/src/resources/app-builder/`). A pytest test fails when a page is stale. The pages list the built-in types; a plugin's types vary by organization, so they point to `workspace://specs/widgets-json-schema`, which the user's FINOS Workspace tab answers over the bridge with their organization's composed schema.

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
2. **Headers.** The backend connection's credentials, the headers the deployment adds (`X-Microsoft-Id-Token`, `X-Okta-Id-Token`, `X-Workspace-User`, when enabled), then each `in: "header"` param as `paramName: value`.
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
6. A header param's `paramName` is 1 to 64 characters of the HTTP token set. Not allowed: the names a browser forbids page script to set (`Accept-Charset`, `Accept-Encoding`, `Access-Control-Request-Headers`, `Access-Control-Request-Method`, `Connection`, `Content-Length`, `Cookie`, `Date`, `DNT`, `Expect`, `Host`, `Keep-Alive`, `Origin`, `Referer`, `Set-Cookie`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`, `Via`, and names starting `Proxy-` or `Sec-`), the names FINOS Workspace sets (`Authorization`, `Content-Type`, `Accept`, `X-Microsoft-Id-Token`, `X-Okta-Id-Token`, `X-Workspace-User`), and any header the backend connection's credentials use. A header value is printable ASCII of at most 1,024 characters.
7. Credentials belong to the backend connection, never in params: a param's value is saved with the dashboard and shown in the UI. A param named like one of the connection's query credentials is refused.

### 4.5 CORS

A header param, a JSON body or `POST` makes the browser send a preflight, so the backend answers `OPTIONS` with `Access-Control-Allow-Methods` including the method and `Access-Control-Allow-Headers` including `Content-Type` (with a body) and every header param name.

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

## 5. The MCP tool link

A widget may name one MCP tool of its own backend: the tool the agent uses to query that backend for what the widget shows. The key is `mcp_tool`, valid on every type.

### 5.1 Servers

A backend declares MCP servers on the templates of its `apps.json` (`mcpServers`: `name`, `description`, `url`, `authType`). Connecting the backend registers each declared server once, with the backend's header credentials as its headers, recording its declared name and the backend's id; the declared name cannot be edited, unlike the server's display name. The agent's tools are the enabled tools of the connected servers that the user's roles grant, sent when the agent has MCP tools on. The browser makes each call through `/app/mcp-proxy`, which checks the roles again for every `tools/call`.

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

1. **Opt-in.** A widget without `mcp_tool` has no linked tool. The link adds nothing to the agent's tool list: the server's tools are there when the server is registered, enabled and granted.
2. **Same backend.** A widget whose `mcp_server` names no server of its backend's `apps.json` is reported with `[mcp_tool/mcp_server]` and left out. The check runs only when `apps.json` loaded with no invalid app. A backend with no `apps.json` declares no server. One name for two servers (different URLs) in one backend makes the later app invalid.
3. **Identity.** A call is attributed to a widget only when the server was registered for the widget's backend, its declared name equals `mcp_server`, and the tool equals `tool_id`.
4. **Active.** The link is active when the tool is in the request's tool list: the server connected and enabled, the tool on, granted by the user's roles, and MCP tools on for the agent. Otherwise the widget behaves as if it had no link.
5. **Several widgets, one tool.** A call is cited to the widget whose literal `args` all equal the call's arguments, the one with the most literals first, then the first the backend declares.
6. **Not with `disableRetrievalForCopilot: true`**, which keeps the widget from the agent.
7. **Host-only.** A plugin's frame gets no trait for the link and has no command or permission to call the tool.
8. **`iframe`.** `storage.mcpUrl` binds a server of the iframe's own to the instance, without the backend's credentials. It does not use or conflict with `mcp_tool`.

### 5.4 What the web app and the agent do

1. **The agent is told.** Where the request is assembled (`lib/utils/mcpLink.ts`, used in `useAiFetchRequestInit.tsx`), a widget row gains `mcp_tool: { server_id, tool_name, args }` when the request's tools include the linked tool; `server_id` and `tool_name` come from that list, never from the widget's strings.
2. **Ines shows it.** Her `search_widgets` rows carry `mcp_tool: { tool, args }` with the tool named as the model calls it (`linkedToolName`, `agent/src/mcp/factory.ts`), and her prompt's widget lists tag the widget `[query tool: <name>]`. Nothing is routed by it: the model chooses.
3. **A call cites the widget** (`citeMcpCall`, used by `useMcpExecutor`). Only widgets of the server's own backend that name its declared name and the tool are candidates; `input_args` are built through the mapping in reverse, and arguments that map to no param go in the citation's `details`.
4. **The FINOS Workspace MCP** returns the link in `list_available_widgets` and `get_widget_schema`.

### 5.5 Security

- **The link grants nothing.** The call uses the user's own connection to the server, the roles decide (`RoleMcpAccess`), and the proxy checks every `tools/call`.
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
