# Widget plugins: the `widgets.json` contract and the dynamic schema

Status: proposal, 2026-10-09.

Files: [README](README.md) · [DESIGN](DESIGN.md) · [GUEST-CONTRACT](GUEST-CONTRACT.md) · **WIDGETS-JSON** · [SERVER-SIDE](SERVER-SIDE.md) · [SECURITY](SECURITY.md) · [PLAN](PLAN.md) · [SPIKE](SPIKE.md) · [AUTHORING](AUTHORING.md)

Four questions: how plugins change the `widgets.json` contract, whether a dynamic schema can define every accepted key and value, how a widget declares the HTTP method and where each parameter goes in the request, and how a widget opts in to an MCP tool of the same backend that the agent uses to query it.

**Short answers.** Plugins change the contract in two places, `type` and `data`, and nowhere else. A dynamic schema can define everything: one closed schema per deployment and entity, composed from the Zod base, the built-in types and the enabled plugins' fragments, provided plugin fragments are themselves closed, live under one namespace (`data.<type>`), and are linted when a plugin is discovered. The contract gains three keys: `method` (`GET` or `POST`) on the widget, `in` (`query`, `header` or `body`) on each param, and `optionsMethod` (`GET` or `POST`) on `endpoint` params, with the rules of section 4. Path parameters stay what they are: `{param}` placeholders in `endpoint`. And `mcp_tool`, which is accepted silently today and matched by name across all backends, is defined as the widget's opt-in to one MCP tool of its own backend: it names a server that backend declares in its `apps.json`, it maps the widget's params to the tool's arguments, and the agent is told which tool answers for which widget (section 5). Making the contract complete also means closing the places where it is open today; section 1 lists them, and they are worth fixing with or without plugins.

## Contents

1. [The contract today](#1-the-contract-today)
2. [What plugins change](#2-what-plugins-change)
3. [The dynamic schema](#3-the-dynamic-schema)
4. [Request mapping: method and parameter location](#4-request-mapping-method-and-parameter-location)
5. [The MCP tool opt-in](#5-the-mcp-tool-opt-in)
6. [Changes to existing code](#6-changes-to-existing-code)
7. [Decisions](#7-decisions)

## 1. The contract today

`widgets.json` is a JSON object. Its keys are widget ids and its values are widget definitions (`workspace://specs/widgets-json`). The SPA validates it in `frontend/src/lib/utils/validateBackend.ts` against `specificationSchema` (`frontend/src/utils/zodForms.ts:171`), a Zod record of `widgetSchema`, and then partitions the widgets by `type` (`partitionSupportedWidgets`, line 102).

A definition accepts these keys (`widgetShapeDefinition`, `zodForms.ts:90-130`): `name`, `description` and `endpoint` (all required by the schema), `type`, `category`, `subCategory`, `source`, `showTitle`, `groupById`, `params`, `data` (only `{ dataKey }`), `gridData` (only `{ w, h }`), `staleTime`, `refetchInterval`, `dataUpdateDisplay`, `runButton`, `disableRetrievalForCopilot`, `copilotParseAs`, `raw`, `exportable` and `storage`. Three more should not be in a backend contract at all: `widgetId`, `widgetType` and `defaultViz` (the docs say never to emit the last one). There is no `method`.

**Where the contract is open today**

| # | Where | Today |
|---|---|---|
| 1 | `type` | A closed enum of five (`lib/types/app.ts:297`). The schema makes it optional and the docs say it is required. A widget without one is left out of the catalog. |
| 2 | `data` | The schema knows `{ dataKey? }` and does not reject another key. The widget is stored as sent, so a catalog entry keeps `data.table`. A new instance copies `data` whole from the catalog entry (`lib/utils/app.ts:1512`), but a source refresh takes only `data.dataKey` from the definition (`components/DataConnectors/common/helpers.ts:263`), so a changed `data.<type>` never reaches an instance that exists. |
| 3 | Unknown top-level keys | Only a warning (`detectUnrecognizedKeys`, `zodForms.ts:215`), and the key is kept: `validateWidgetItems` returns the object as sent, not the parsed copy (`validateBackend.ts:195`), and the catalog entry spreads it (`convertAdvancedBackend`, `lib/utils/widget.ts:155`). An instance copies only the fixed list of fields in `lib/utils/app.ts:1502` and `helpers.ts:252`. `mcp_tool` and `searchCategory` are left out of the warning. The spec page says unknown keys are "tolerated by some Workspace builds and ignored by others". |
| 4 | Unknown nested keys | Dropped silently inside `params[]` entries, `options[]` and `style` included, because `params` is replaced by the parsed copy (`createParamDefs`, `lib/utils/widgetParams.ts:254`). Neither checked nor removed in `gridData`, `data` and `storage`. |
| 5 | Unbounded values | `ParamDef.description` is `unknown`; an `endpoint` param's `value` and its `optionsParams` values are `unknown`; `storage` is a free map; `multiple` is accepted on every param type and refused for non-text types by a later check. |
| 6 | The schema and the docs disagree | `description` is required by the schema and "recommended" in the docs; `type` is the other way round. |
| 7 | No published schema | Only `apps-schema.json` is generated (`scripts/generate-apps-schema.ts`). The call that would print the schema of `widgets.json` is commented out (`zodForms.ts:184`). |
| 8 | Hand-written docs | At least eight spec and guide pages list the five types, in two copies (`backend-api/backend/workspace_mcp/app_builder/resources` and `ines/mcp-server/src/resources/app-builder`) that have already drifted apart. |
| 9 | Creating a widget through MCP | `get_widget_schema` returns params and grid data only (`useWorkspaceBridgeCommandHandler.ts:468`). `ui_args` accepts any key and writes it to the widget's storage (`workspace.api.ts:498`). |
| 10 | `apps.json` | A layout item's `state.storage` is a loose object (`lib/types/app.ts:316`). |
| 11 | The HTTP method | Not a `widgets.json` key. `createWidgetEndpoint` forces `GET` (`lib/utils/widgetParams.ts:288`), and so does the conversion of a backend's widgets in `components/DataConnectors/common/helpers.ts` (line 86, and the calls at 226 and 243), although the widget type and `useJsonData` already carry `method` and `body`. The docs say a widget may be `POST`. |
| 12 | Where a param goes | Always the query string, after `{name}` placeholders in the endpoint are filled (`parseMarkdownParams`, `widgetParams.ts:127`). The value is inserted as is, with no encoding, so a value containing `/`, `?` or `#` changes the URL's structure. A value that is empty, `0` or `false` becomes an empty path segment. A placeholder that names no param also becomes empty. There is no header or body param. The docs call `paramName` the "Query/body key". |
| 13 | A `?` in `endpoint` | `cleanSearchParams` appends no query parameters at all when the URL already contains a `?` (`widgetParams.ts:165`). The same function serves `optionsEndpoint`. |
| 14 | Headers | Only the backend connection's `endpointHeaders` (`key`, `value`, `location` of `headers` or `query`) and a few that deployment flags add (`addExtraHeaders`). Never per widget or per param. |
| 15 | Bodies | Only form params send one: JSON, `POST` or `PUT` (`components/DraggableCard/FormParamDef.tsx:65`). |
| 16 | Option lookups | Always `GET`, with `optionsParams` in the query (`getEndpointParamRequestArgs`, `lib/utils/app.ts:681`). The options cache key already carries a method and a body (`_getEndpointParamRequestCacheKey`), but nothing sets them. |
| 17 | Other request builders | The endpoint probe sends a real `GET`, with the backend's credentials, to every widget (`validateBackend.ts:68`), so it runs each widget's handler, and it counts a 405 or 422 as fine (line 79), so a `POST` endpoint is never checked. The Copilot's data and option retrieval (`getRequest` in `components/AI/hooks/useFunctionCall.tsx`) is `GET` too. |
| 18 | `mcp_tool` | Accepted silently, documented in no spec page, and matched by server name across every backend (section 5.1). |

## 2. What plugins change

1. **`type` becomes an open set.** It is the built-in types plus the viz types handled by plugins that are available to the entity. A type nobody handles stays unsupported, and the message can name the discovered plugin that would handle it.
2. **`data` becomes type-specific.** `data.dataKey` stays shared and generic, as the host already applies it. A plugin-handled type adds its own configuration under `data.<type>`: for a type `table`, the object at `data.table`. The plugin declares that object's schema in its manifest. One namespace means a plugin can never add a top-level key or collide with the base keys.
3. **The plugin reads that object through the model.** A new binding, `definition`, carries the widget definition's `data.<type>` object into the frame, read-only (GUEST-CONTRACT 3.1). User settings stay in `config`, admin settings in `adminSettings`. For the binding to be current, a source refresh must update `data.<type>` on existing instances, which it does not today (section 1, row 2; section 6).
4. **The generated schema replaces hand-written type lists** (sections 3.9 and 6).
5. **An update can change the contract.** A new version that changes a type's `definition` changes what backends may write. The update review shows the schema diff (DESIGN 8.2).
6. **Request mapping and the MCP link apply to every type, plugin types included** (sections 4 and 5). The host builds the request and pushes the data in; the plugin never sees the wire. The MCP link is read by the host and the agent only: it is not a binding in the model, and there is no permission that lets a plugin call the tool.
7. **Nothing else changes.** Widget ids, `endpoint`, `gridData`, the layout in `apps.json` and the five built-in types' behavior stay as they are. A backend that only uses the built-ins sees no difference, apart from the strictness decision (C1).

## 3. The dynamic schema

### 3.1 One closed schema per deployment and entity

The schema in force for an entity is composed from three kinds of input:

1. The **base**: the keys every widget definition accepts, generated from the Zod source.
2. The **built-in types**: each with its own `data` (and, where a built-in reads one, its `storage` keys), also generated from Zod.
3. The **plugin fragments**: for each viz type handled by an enabled plugin for the entity (the chosen handler where two plugins claim the same type), the `definition` that plugin declared for it.

It is per entity because availability is: enablement, roles' scoping and the entity's handler choice decide which types exist.

### 3.2 What "closed" means

For every object in the composed schema:

1. `additionalProperties` is `false`, or the object is a map whose value schema is defined.
2. Every property has a type. Every string is bounded by `maxLength`, `enum` or `pattern`. Every array has `maxItems`. Numbers have ranges where the meaning has one.
3. Enumerations are explicit, and required keys are listed.

The top level is an object that allows `$schema` and `$id` (strings) and treats every other key as a widget id. A unit test walks the generated schema and fails on any object, string or array that breaks these rules. **The same walker lints a plugin's fragment when the plugin is discovered**: a fragment that is not closed and bounded blocks that version, with the path of the offending node.

### 3.3 The plugin fragment

`handles` in the manifest is a list of objects, one per viz type the widget renders:

```jsonc
"handles": [
  {
    "type": "<viz-type>",
    "definition": {                       // closed JSON Schema for data.<viz-type> in a widgets.json entry
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "<key>": { "type": "string", "maxLength": 128 },
        "<key>": { "enum": ["<value>", "<value>"] },
        "<key>": { "type": "array", "maxItems": 200, "items": { "type": "object", "additionalProperties": false,
                    "properties": { "<key>": { "type": "boolean" } } } }
      }
    },
    "response": {                         // what the endpoint must return: documentation, and optional sample validation
      "accepts": "json",
      "description": "<what the endpoint returns>",
      "schema": {}
    }
  }
]
```

The allowed subset of JSON Schema is small on purpose: `type`, `properties`, `required`, `additionalProperties` (`false`, or a defined value schema for maps), `items`, `enum`, `const`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `pattern` (length-capped, no backreferences), `minItems`, `maxItems`, `uniqueItems`, `oneOf` and `anyOf` over closed objects, local `$defs` and `$ref`, and the annotations `title`, `description`, `default`, `examples`. Not allowed: remote `$ref`, `patternProperties`, `unevaluatedProperties`, `if`, `then`, `else`, `dependentSchemas`. A fragment is at most 64 KiB and eight levels deep. The restriction applies to plugin fragments only: the platform's own composer writes `if` and `then` where it needs them (section 4.9).

### 3.4 Composition

For each type `T` available to the entity, the composer writes `definitions.Widget_T`: a complete, closed object with the base properties copied in, `type: { "const": "T" }`, `data` pointing at `definitions.Data_T`, and the required keys. `Data_T` is a closed object with `dataKey` and, for a plugin type, `T` set to the plugin's `definition`. Each branch is complete on its own, so the schema needs no `unevaluatedProperties` and works with any draft-7 validator and editor.

```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "<id that includes the etag>",
  "type": "object",
  "properties": { "$schema": { "type": "string" }, "$id": { "type": "string" } },
  "additionalProperties": { "$ref": "#/definitions/Widget" },
  "x-types": ["markdown", "html", "newsfeed", "pdf", "iframe", "<plugin-type>"],
  "definitions": {
    "Widget": { "oneOf": [ { "$ref": "#/definitions/Widget_markdown" }, "...", { "$ref": "#/definitions/Widget_<plugin-type>" } ] },
    "Widget_<plugin-type>": {
      "type": "object", "additionalProperties": false,
      "required": ["name", "description", "type", "endpoint"],
      "properties": {
        "name": { "type": "string" }, "description": { "type": "string" },
        "endpoint": { "type": "string", "pattern": "^[^?#]+$" },
        "method": { "enum": ["GET", "POST"] },
        "type": { "const": "<plugin-type>" },
        "data": { "$ref": "#/definitions/Data_<plugin-type>" },
        "params": { "type": "array", "items": { "$ref": "#/definitions/ParamDef" } }
      }
    },
    "Data_<plugin-type>": {
      "type": "object", "additionalProperties": false,
      "properties": { "dataKey": { "type": "string" }, "<plugin-type>": { "...the plugin's definition..." } }
    },
    "ParamDef": { "oneOf": [ "...one closed branch per param type..." ] }
  }
}
```

(Abbreviated. The base properties are all listed in every branch.)

For readable errors a validator checks `type` first against `x-types`, picks `definitions.Widget_<type>` and validates against that one branch. A top-level `oneOf` alone reports every branch's failures.

### 3.5 Where it is built and served

- **Source of truth: Zod.** The base and the built-in types stay in `frontend/src/utils/zodForms.ts` and `lib/types/app.ts`, because the TypeScript types and the normalization (defaults, `refetchInterval`) come from them. A script, `scripts/generate-widgets-schema.ts` (the commented-out call becomes real), writes a **kit**: the shared `definitions`, the base widget (`properties`, `required`) and one entry per built-in type. The kit is committed under the backend, and a frontend test fails when it is stale. The repo already keeps generated and hand-kept pairs in step this way (`scripts/check-runtime-config.ts`).
- **Composer: the API.** `api/plugin_schema.py` takes the kit and the enabled plugins' fragments and returns the composed schema. It is the only implementation. The consumers are the SPA, Ines and the Workspace MCP, `workspace-admin`, CI for backend authors. Only the API knows which plugins an entity has.
- **Endpoint.** `GET /app/widget-plugins/widgets-schema` for the signed-in user's entity (a superuser may pass `?entity=`), with an `ETag`. It answers even when the feature is off, with the built-in types only. It requires a session, because it names the installed plugins' types.
- **Cache.** The composed schema is cached per entity and rebuilt when anything it depends on changes: a plugin approved, revoked, updated or narrowed, an entity's enablement or handler choice, a role grant that changes what is available.
- **Alternative.** Compose in the SPA with `z.fromJSONSchema` (Zod 4.4.3 has it, described as "semi-experimental"). That gives the SPA a path without the API, but every other consumer still needs the API's version, so there would be two implementations.
- **As built.** The contract is its own module, `frontend/src/lib/types/widgetsContract.ts` (strict Zod objects, the header tables, the bounds and each built-in type's methods, locations and reserved query names). `frontend/src/lib/types/widgetsSchemaKit.ts` turns it into the kit and `node scripts/generate-widgets-schema.ts` (from `frontend/`) writes it to `backend-api/backend/api/widget_plugins/widgets_schema_kit.json`; a Vitest test fails when the committed kit is stale. The composer is `backend-api/backend/api/widget_plugins/widgets_schema.py`, with `scripts/compose_widgets_schema.py` to print a composition offline. A pytest test fails when the SPA's fixture (`frontend/tests/mocks/widgets-schema.json`) is not the composer's output. Besides `widgetId`, `widgetType` and `defaultViz` (C6), four keys left the contract because nothing reads what a backend declares for them: `copilotParseAs` (read by nothing), the widget's `groupById` (computed from its first `endpoint` param), a param's `hidden` (state the parameters dialog writes; `show` decides what is shown) and an `endpoint` param's `groupById` (computed from its `optionsEndpoint`).

### 3.6 Validation in the SPA

1. Fetch the composed schema with the plugin listing and pass it to the worker (`apiSource.worker.ts` cannot read the registry).
2. Validate the raw `widgets.json` against it, two-step as in 3.4, and report every problem with its JSON pointer. This subsumes `detectUnrecognizedKeys`, which only sees top-level keys of each entry.
3. Normalize with the existing Zod `widgetSchema` (defaults, `refetchInterval`).

The validator needs a JSON Schema engine. `ajv` is in `package.json` only as an override of a transitive dependency; making it a direct dependency is one line. `z.fromJSONSchema` is the other route (decision C4).

**As built.** `ajv` is a direct dependency. The registry sync fetches the schema with the plugin listing and hands it to the worker; a new `$id` revalidates the connected backends. `validateWidgetDefinition` (`lib/utils/widgetsSchemaValidation.ts`) checks one widget against its type's branch and returns readable messages with JSON pointers, and `contractProblems` (`lib/utils/widgetsContractChecks.ts`) runs the checks of 3.7 on a definition the schema accepted. There is no separate Zod normalization step: the params are normalized by `ParamsSchema` (`lib/types/app.ts`) when the widget is created, as before.

### 3.7 What JSON Schema cannot say

These stay as code: widget ids referenced by `groups[].widgetIds` and `layout[].i` exist; `groupById` names a real param; at most one param has the role `fileSelector`; `optionsEndpoint` answers; cron strings are valid; every `{name}` placeholder in `endpoint` and `optionsEndpoint` names a declared param, and a param used in a placeholder declares no `in` (4.2); `paramName` is unique in a widget; a `$name` in `optionsParams` names a declared param; a header param does not collide with a header the backend connection uses, nor a query param with a query value it uses; an `mcp_tool` names a server that the same backend's `apps.json` declares, the server names are unique, and a `$name` in its `args` names a declared param (5.3); and the endpoint returns what the type's `response` describes. The last one can be checked against `response.schema` on a sample when the app-builder agent calls the endpoint. Endpoint-driven param options are dynamic and are marked as lookups, as `get_widget_schema` already does with `requires_options_lookup`.

### 3.8 The instance-level schema

Creating or changing a widget through the Workspace MCP uses two argument objects, and both get a schema:

- `data_args` is checked against the widget's declared params (`computeWidgetParamUpdates` already collects dropped and invalid keys). `get_widget_schema` returns it as a closed JSON Schema built from the params: each param's type, enum from its options, range, `additionalProperties: false`, and where it goes in the request (`in`, or the path).
- `ui_args` stops being open. Today every key other than `name`, `description` and `source` is written to the widget's storage. The schema for it is `name`, `description`, `source` and, for a plugin widget, `config`, the plugin's `settings.schema`. For a built-in type, the keys it reads (a markdown widget's `text`, an HTML widget's `html`). A key the schema does not define is rejected with its path instead of being stored.

`get_widget_schema` then returns `data_args_schema` and `ui_args_schema` next to the params it returns today, the widget's `method`, and its `mcp_tool` link (section 5), so an agent that builds dashboards through the Workspace MCP sees which widgets have a query tool.

**As built.** `frontend/src/lib/utils/widgetArgsSchema.ts` builds both schemas and checks arguments against them with `ajv`.

- `data_args_schema` has one property per declared param. A param with static options takes an enum of them (an `endpoint` param's options come from its lookup, so it does not). A number also takes a numeric string, a date takes `YYYY-MM-DD` or `$currentDate` with a modifier, and a `multiSelect` or `multiple` param takes a list or a comma-separated string: what the request builder accepts (4.3). A value the schema refuses is ignored with a warning naming the key, as an undeclared key already was.
- `ui_args_schema` has `name`, `description`, `source`, and `innerTab` and `gridData` for `create_widget` (`update_widget` refuses layout keys, as before). It also has the keys of the component that renders the widget, picked as the dashboard picks it: `text` for markdown (a Copilot note is a `custom` widget rendered by the id `markdown`), `html` for HTML, and `config` for a plugin widget, closed, from the plugin's settings schema and stored in `storage.plugin.config`. An undefined key or a wrong value refuses the whole call (`invalid_request`, naming each path), and a dry run returns `valid: false` with the problems. Before, such keys were written to the widget's storage.
- Each param row also carries `in`: `path`, `query`, `header` or `body`.
- The Workspace MCP's tool descriptions say what the schemas and `in` are (`workspace_mcp/server/tools/widgets.py`, with the surface fixture regenerated).
- Checked live with an MCP client over HTTP against the compose stack and a signed-in tab: `get_widget_schema` for the 4.9 example returns `POST`, the places `path`, `query`, `header` and `body`, and both closed schemas; a `create_widget` dry run with an undefined `ui_args` key returns `valid: false` with the problem and a warning for an undeclared `data_args` key; `workspace://specs/widgets-json-schema` returns the entity's schema with its plugin types. The check found that the API's bridge refused any browser reply that carried warnings (its copy of the result model in `routers/app/workspace_mcp/schemas.py` had no `warnings`), which closed the bridge; it now accepts them.

### 3.9 Generated docs

The type catalog and the field tables in the spec pages are generated from the composed schema, so there is one list of types and keys: `workspace://specs/widget-types`, `workspace://specs/widgets-json`, `workspace://specs/widget-parameters`, and the schema itself as a new resource, `workspace://specs/widgets-json-schema`. The hand-written prose stays; the lists come out of it. This also removes the two drifting copies.

**As built.**

- `backend-api/backend/scripts/generate_app_builder_specs.py` writes, from the kit, the type catalog (`specs/widget-types.md`), the per-type responses (`backend-contract.md`), the widget fields (`specs/widgets-json.md`), and the param fields and header-name rules (`specs/widget-parameters.md`). Each list sits between `<!-- generated:<name> -->` markers, and a pytest test fails when a page is stale. The notes come from the descriptions in the Zod contract, which now describes every field. A plugin's types vary by organization, so the pages list the built-in types and point to the schema resource.
- `workspace://specs/widgets-json-schema` is answered by the user's Workspace tab over the bridge (`get_widgets_schema`), so it is the composed schema for their organization, plugin types included. It is tagged `live`, so the surface fixture lists it without a body. Without a connected browser, reading it fails with the bridge's message.
- The pages' prose now follows the contract: unknown keys are refused, the request mapping of section 4 (with the 4.9 example), the CORS preflight, how values are written, the header rules, and the new validation messages in `validation/common-errors.md`.
- Ines's MCP server serves the same pages from its own copy (`ines/mcp-server/src/resources/app-builder/`), which the generator writes from these and `--check` compares, so the two cannot drift; it serves `workspace://specs/widgets-json-schema` from the connected browser as well (`resources/widgets-schema.ts`, the bridge's `get_widgets_schema`). Its bridge keeps a result's `warnings`, and its widget tools describe `data_args_schema`, `ui_args_schema`, `in` and `mcp_tool` as the Workspace MCP's do.

### 3.10 `apps.json`

`apps-schema.json` is already generated, but a layout item's `state.storage` is loose. A plugin widget's template state is `plugin.config`, validated by its `settings.schema`. The composer emits the apps schema the same way, so a template can set a plugin widget's configuration and have it checked.

**As built.** Which settings apply depends on the type of the widget a layout item names, which is in `widgets.json`, so the check is code over the composed schema rather than a second composed document:

- The composer adds `PluginConfig_<type>` to the composed schema for each plugin type: the handler widget's settings, closed (a handler with no settings takes no configuration). The SPA therefore has it wherever it has the schema, the worker included. `scripts/compose_widgets_schema.py` takes `--settings <type>=<settings.json>`.
- A layout item's `state.storage` defines `plugin: { config }` (`lib/types/app.ts`, `apps-schema.json` regenerated). When a backend loads, an app whose layout item sets `plugin.config` for a widget of a built-in type, or a value its plugin's settings refuse, is reported with the path of each problem and left out, like any invalid app. A template's state is merged into the widget's storage when the app is opened, so the configuration lands in `storage.plugin.config`, where the plugin widget reads it.
- The rest of `state.storage` stays as loose as before.

## 4. Request mapping: method and parameter location

A widget has to say how it calls the backend. Three keys are added. Their defaults equal what happens today, so a definition that uses none of them behaves as it does now.

| Key | On | Values | Default |
|---|---|---|---|
| `method` | the widget definition | `"GET"`, `"POST"` | `"GET"` |
| `in` | each param, except `form` params and params used in a path placeholder | `"query"`, `"header"`, `"body"` | `"query"` |
| `optionsMethod` | each `endpoint` param, and `endpoint` inputs of a `form` param | `"GET"`, `"POST"` | `"GET"` |

Path parameters are not a location. They stay what they are today: a `{param}` placeholder in `endpoint` (section 4.2).

### 4.1 How the host builds the request

For a widget definition and the current param values the host builds one request, in one function that every request site calls (section 6):

1. **URL.** `endpoint` is a path on the backend, or an absolute URL, with **no `?` and no `#`**: a `?` or `#` is an error, and a static query value is a param with a default value and `show: false`. Placeholders are filled as in 4.2. Each `in: "query"` param is then appended as `name=value`.
2. **Headers.** The backend connection's credentials, then the headers the deployment adds (`X-Microsoft-Id-Token`, `X-Okta-Id-Token`, `X-Workspace-User`, when enabled), then every `in: "header"` param as `paramName: value`.
3. **Body.** With `method: "POST"`, the `in: "body"` params as one JSON object, `{ "<paramName>": <value> }`, sent as `Content-Type: application/json`. With no body params there is no body.
4. **Host parameters.** `theme` (`dark` or `light`, for `markdown`, `html` and plugin-handled types) and `raw=true` (the raw data view) are added to the query string by the host, whatever the method. They are reserved names. A change of the site's theme sends the request again.

A param whose value is undefined, null or an empty string is not sent, in any location. `0` and `false` are sent, as today for query params.

### 4.2 Path parameters

A `{name}` placeholder in `endpoint` takes the value of the param whose `paramName` is `name`. This is how it works today; what changes is that the rules are written down and enforced.

- Every placeholder names a declared param of the widget. A placeholder that names none is an error. Today it silently becomes an empty string.
- A param used in a placeholder is a path param. It is substituted into the path and sent nowhere else, so it declares no `in`.
- The value is URL-encoded as one path segment (`encodeURIComponent`). Today it is inserted as is, so a value containing `/`, `?` or `#` changes the structure of the URL.
- The value is required. With none the request is not sent, and the param is shown as required. Today an empty value, and also `0` and `false`, becomes an empty segment.
- A path param takes one value, so a `multiSelect` or `multiple` param cannot be a path param.
- `optionsEndpoint` has the same placeholders, filled from `optionsParams` (4.7).

### 4.3 Values

| Param type | In the query, a header or the path | In the body |
|---|---|---|
| `text`, `tabs`, `ticker` | the string | a JSON string |
| `number` | the decimal string | a JSON number |
| `boolean` | `true` or `false` | a JSON boolean |
| `date` | the resolved date, `YYYY-MM-DD`, after `$currentDate` modifiers | a JSON string in the same format |
| `endpoint` | the option's value as a string | the option's value |
| `multiSelect`, `multiple` | the values joined with commas (not allowed in the path) | a JSON array of the values; a default given as a comma-separated string is split on commas |

### 4.4 Rules

Closed rules, enforced by the schema where JSON Schema can state them and by code otherwise:

1. `body` params require `method: "POST"`.
2. `paramName` is unique in a widget. Storage and parameter groups key on it, so the location is a property of the param, not part of its identity.
3. `in` is not accepted on a `form` param, on its `inputParams`, or on a param used in a path placeholder. A form posts its `inputParams` as a JSON body to its own `endpoint`, with its own `method` (`POST` or `PUT`), as today.
4. `iframe`: `method` is `GET` and params are in the query or the path. Its `endpoint` is a page URL that the browser navigates to.
5. `theme` is reserved as a query param name for `markdown`, `html`, `iframe` and plugin-handled types, and `raw` for `html`. The host adds them (4.1); the `iframe` page gets the theme in its URL.
6. **Header params.** `paramName` is the header name: 1 to 64 characters from the HTTP token set (letters, digits and ``! # $ % & ' * + . ^ _ ` | ~ -``). Not allowed:
   - the names a browser forbids page script to set, which `fetch` drops silently: `Accept-Charset`, `Accept-Encoding`, `Access-Control-Request-Headers`, `Access-Control-Request-Method`, `Connection`, `Content-Length`, `Cookie`, `Date`, `DNT`, `Expect`, `Host`, `Keep-Alive`, `Origin`, `Referer`, `Set-Cookie`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`, `Via`, and the prefixes `Proxy-` and `Sec-`;
   - the names the host sets or reserves: `Authorization`, `Content-Type`, `Accept`, `X-Microsoft-Id-Token`, `X-Okta-Id-Token`, `X-Workspace-User`;
   - checked when the backend is connected: any header name the connection's credentials use.

   A header value is printable ASCII of at most 1,024 characters (a proposed bound). Anything else stops the request and shows the param as invalid, instead of sending a changed value.
7. **Credentials do not go in params.** A param's value is saved with the dashboard and shown in the UI. Credentials belong to the backend connection.
8. Body params are top-level keys of a flat JSON object. Nested bodies are out of scope.

### 4.5 CORS

The SPA calls the backend directly from the browser. A header param, a JSON body or `POST` makes the browser send a CORS preflight, so the backend must answer `OPTIONS` with `Access-Control-Allow-Methods` including the widget's method (and the option lookups' method) and `Access-Control-Allow-Headers` including `Content-Type` (when there is a body) and every header param name. The generated docs say so (3.9).

### 4.6 Caching and re-fetching

The query key of a widget request includes the method, the URL with its query, the **values** of param-derived headers and the body. Today `useJsonData` includes only the *names* of the headers (`lib/api.tsx`, `headerKeys`), which would leave a changed header param value serving stale data. Credential header values stay out of the key.

### 4.7 Option lookups

An `endpoint` param loads its choices from `optionsEndpoint`. `optionsMethod` says how.

- `optionsMethod` is `GET` (the default) or `POST`.
- The URL is `optionsEndpoint` with its `{name}` placeholders filled from `optionsParams[name]`, under the rules of 4.2, and with no `?` and no `#`.
- The other `optionsParams` go in the query for `GET`, or in a flat JSON body (`Content-Type: application/json`) for `POST`.
- An `optionsParams` value is a string, a number or a boolean. A string that starts with `$` refers to the current value of the widget's param of that name, which must be declared, and is serialized as in 4.3 for the chosen location. Every other value is a literal. Today these values are `unknown`.
- A value that is empty is not sent.
- Headers are the backend connection's credentials, as today. Option requests have no per-param headers.
- The response is a JSON array of strings or `{ label, value }` objects, as today.
- The same applies to an `endpoint` input inside a `form` param.
- The options cache key already carries the method and the body (`_getEndpointParamRequestCacheKey`), so it needs no change.

### 4.8 Other requests

- **The endpoint probe** (`validateBackendEndpoints` in `validateBackend.ts`) is a route check, and it runs no widget. It runs when a user validates a backend (the "Validate Widgets" option of the Apps form). It used to send a real `GET`, with the backend's credentials, to every widget, which ran each handler. It is now a preflight-style check (built; see "As built" below):
  - **What it sends.** A plain `OPTIONS` request, with no credentials, query, headers or body, once per distinct route: every widget `endpoint`, every `optionsEndpoint`, and the `endpoint` of every `form` param, which a `GET` could never check because it writes. A `{param}` placeholder is filled with the param's default, and a route whose placeholder has none is skipped and reported as not checked. It sends no credentials.
  - **Why not a true preflight.** Page script cannot send one. `Access-Control-Request-Method` and `Access-Control-Request-Headers` are forbidden header names, which the browser drops, and it sends its own preflight only as the first half of a real request. A script `OPTIONS` is a real request that the browser precedes with its own preflight for `OPTIONS`. No handler runs. (Checked in Chromium.)
  - **Verdicts.** `404`: no such route. No response at all: the backend is unreachable, or its CORS settings do not allow `OPTIONS` from this origin; the browser does not say which, and the documented settings allow it. Any other status: the backend answered for that route.
  - **Calibration.** Starlette's CORS middleware answers every preflight with `200`, whatever the path, so against the documented FastAPI settings only the plain `OPTIONS` that follows says anything: `404` for a missing route, `405` for one that exists (checked on FastAPI 0.143 and Starlette 1.7). A backend that answers every `OPTIONS` itself makes every route look valid, as Express with `cors()` does (checked on Express 5.2 and cors 2.8). So the probe first sends `OPTIONS` to a path that cannot exist, and if that is not a `404` it reports that this backend's routes cannot be checked this way, instead of reporting them valid.
  - **What it cannot tell.** The `Allow` header, which lists a route's methods, is not readable by script unless the backend exposes it. A widget that declares `POST` for a route that accepts only `GET` is therefore not caught here, and fails when it runs. Whether the browser lets the widget's method and headers through (4.5) is also seen only when it runs.
  - **As built.** The query and fragment of an endpoint are dropped, since only the path is a route. A route on another origin than the backend's is reported as not checked, so the probe never sends anything to a third party (an `iframe` page, for example). Requests run six at a time. A `404` or no response for a route fails it, as a failed endpoint did before; the routes not checked, and why, are shown as a warning in the Apps form. Checked in Chromium through that form: against FastAPI with the documented CORS settings, one `OPTIONS` per distinct route plus the canary, a missing route reported, a route whose placeholder has no default skipped, and no handler run; against a backend that answers every `OPTIONS` with `204`, only the canary sent and the routes reported as not checked.
- **Copilot and agents.** Data and option retrieval built their own requests (`getRequest` and `getParamOptions` in `useFunctionCall.tsx`, `GET` only). They now call the same builder, so an agent gets what the widget gets (4.10).
- **Plugins.** Nothing changes for plugin-handled types. Declarative proxies (SERVER-SIDE 3) are a different contract, in the plugin's manifest, and place their arguments by template.

### 4.9 In the schema

- `method`: `{ "enum": ["GET", "POST"] }` on every widget branch (for `iframe`, `{ "const": "GET" }`).
- `in`: `{ "enum": ["query", "header", "body"] }` on every param branch except `form`.
- `endpoint` and `optionsEndpoint`: `{ "type": "string", "pattern": "^[^?#]+$" }`, with a length bound.
- `optionsMethod`: `{ "enum": ["GET", "POST"] }` on the `endpoint` param branch. `optionsParams`: an object whose values are `string`, `number` or `boolean`, with `maxProperties`.
- Per widget branch the composer writes the rule JSON Schema can state: if any param has `in: "body"`, then `method` is `POST` (an `if` with `contains`, and a `then`).
- Per param branch: if `in` is `header`, `paramName` matches the header-name pattern and does not match the forbidden-name pattern. The composer builds the case-insensitive forbidden list from one table in code, so the schema and the code check cannot differ.
- Stays as code: the placeholder rules, unique `paramName`, `$name` references, and header names against the connection's credential headers (3.7).

An example, with the requests it produces:

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

With `team` set to `platform`, the widget's request is `POST <backend>/teams/platform/report?period=month&theme=dark`, with the header `X-Region: eu`, `Content-Type: application/json` and the body `{"filters":"active"}`. The `team` choices come from `POST <backend>/teams/search` with the body `{"active":true}`. `team` is a path param, so it declares no `in`; `period` has no `in`, so it goes in the query.

### 4.10 As built

- **The builder** is `frontend/src/lib/utils/widgetRequest.ts`: `buildWidgetRequest` (a widget's data request, with the host's `theme` or `raw`), `buildOptionsRequest` (4.7), `buildFormRequest` (a form's submission), `requestInit` (what `fetch` takes: the credentials, the deployment's headers, the header params, the JSON body) and `requestKey` (4.6). The result is the request, or the problems that keep it from being sent.
- **Where it is called.** The markdown, HTML (and its raw view), newsfeed, PDF and plugin widgets, through `useJsonData`; the parameter bar's option lookups and the dependent-param updates (`endpointOptionsRequest` in `lib/utils/app.ts`); a form's submission and its `endpoint` inputs' option lookups; the Copilot's data and option requests; the Excel export; and the `iframe` page, whose `{name}` placeholders it fills. `cleanSearchParams`, `parseMarkdownParams` and `useMultipleQueries` are gone.
- **Values.** A param's value is the one stored for it, else its default, so the agent and a param added by a source refresh get the default too. Only declared params are sent.
- **When it is not sent.** A widget shows the problems in place of its content, naming each param (for example "`team` needs a value"), and the query is not retried. An `iframe` widget shows them in place of the page, a form in a toast. The Copilot gets them as the call's error, and `input_args` that name no param of the widget are refused with the list of its params.
- **Credentials.** The connection's query credentials are set on the URL before the params, and a param named like one is refused, at load (3.7) and when the request is built. Before, a widget's params could overwrite them.
- **Forms.** A form's `{name}` and its inputs' `$name` refer to its inputs (with the values entered) and then the widget's params. The inputs keep `optionsEndpoint`, `optionsMethod` and `optionsParams`; the param schema used to drop them, so a form's `endpoint` input loaded nothing.
- **The catalog and the instance.** A backend widget's catalog entry and the widget made from it carry `endpoint` as `{ url, method }`. `createWidgetEndpoint` keeps the method, and a source refresh reads `method` from the definition. `defaultViz` and `endpointMethod` are removed.
- **Checked.** Vitest covers the builder (`tests/unit/lib/utils/widgetRequest.test.ts`). Playwright `tests/e2e/request-mapping.spec.ts` runs the example of 4.9 against an echo backend (`tests/e2e/echoBackend.ts`) on the compose stack: `POST /teams/platform/report?period=month&theme=…` with `X-Region: eu` and the body `{"filters":"active"}`, the browser's preflight asking for `POST` and `content-type,x-region`, the option lookup `POST /teams/search` with `{"active":true,"region":"eu"}`, and `data/science` sent as one segment, `data%2Fscience`.

## 5. The MCP tool opt-in

A widget may opt in to one MCP tool of its own backend: the tool the agent uses to query that backend for what the widget shows. The key is `mcp_tool`. It exists today, but nothing defines it and it is matched by name across all backends. This section defines it, binds it to the widget's backend and gives it an argument mapping. It applies to every widget type.

### 5.1 How it works today

1. **Declaring a server.** A backend lists MCP servers on the templates of its `apps.json` (`mcpServers`: `name`, `description`, `url`, `authType`; `lib/types/app.ts:386`). Connecting the backend registers them, with the backend's header credentials as the server's headers and the backend's source id on the server (`autoRegisterMcpForSource`, `lib/state/backendConnector.ts:50`).
2. **The agent's tools.** They are the enabled tools of the connected servers that the user's roles grant (`getEnabledToolsForAgent`, `lib/state/mcpTools.ts:485`, filtered with `isMcpToolAllowed`), and they go in the request only when the agent has MCP tools turned on (`components/AI/hooks/useAiFetchRequestInit.tsx:263`). The agent opens no connection. It emits an `executeAgentTool` event, the browser calls the tool (`components/AI/hooks/mcp/useMcpExecutor.ts`) through `/mcp-proxy`, and the proxy checks the roles again for every `tools/call` (`check_mcp_tool_calls`, `routers/app/index.py:1346`).
3. **The link.** A widget may carry `mcp_tool: { mcp_server, tool_id }` (`components/types.ts:145`). The unknown-key warning skips it (`IGNORE_KEYS`, `zodForms.ts:201`) and nothing else checks it. Its one reader is `findEquivalentWidget` (`useMcpExecutor.ts:33`): after the agent calls a tool, it searches the widgets of every backend for one whose `mcp_server` equals the server's `clientName` (its `name` when there is none) and whose `tool_id` equals the tool, both trimmed and lowercased, and cites that widget with the tool's arguments as its `input_args`.

What is wrong with that for a link the agent relies on:

- **The match is by name across backends.** A widget of backend A that names backend B's server and tool is cited as the source of B's results. `clientName` is the OAuth client label a user can edit in the server dialog, so it is not an identity either.
- **It acts after the call.** Nothing tells the agent which tool answers for which widget.
- **The arguments are taken as they are.** `components/AI/Citation.tsx` compares a citation's `input_args` with the widget's saved params to find the widget on the dashboard (line 173), which works only when every argument is named like a param.
- **Nothing checks the reference**, and no spec page the app-builder serves mentions `mcp_tool` or `mcpServers`.

### 5.2 The key

```jsonc
"mcp_tool": {
  "mcp_server": "<name of a server in the same backend's apps.json mcpServers>",
  "tool_id": "<the tool's name on that server>",
  "args": { "<tool argument>": "$<paramName>" }       // optional
}
```

| Key | Meaning |
|---|---|
| `mcp_server` | Required. The `name` of an entry in `mcpServers` on a template of the same backend's `apps.json`, compared exactly. Not a URL. |
| `tool_id` | Required. The tool's name on that server, compared exactly. |
| `args` | Optional. How the widget's params fill the tool's arguments. A key is a tool argument. A value is `$<paramName>`, the widget's current value of that param, or a literal string, number or boolean: the convention of `optionsParams` (4.7). Absent, every param whose name is also a property of the tool's input schema fills that argument. Present, it is the whole mapping. |

The names `mcp_tool`, `mcp_server` and `tool_id` stay as they are.

### 5.3 Rules

1. **Opt-in.** A widget with no `mcp_tool` has no linked tool: no call is attributed to it and the agent is told of no link. The server's tools stay in the agent's tool list when the server is registered, enabled and granted. That is the MCP setup, and the link does not change it.
2. **Same backend.** `mcp_server` names a server the widget's own backend declares. A widget cannot name a URL, so the credentials of a backend only ever go to servers its own `apps.json` lists. The names in a backend's `mcpServers` are unique (nothing checks this today). A widget whose `mcp_server` names no declared server is an error: it is reported with its path and left out, as for the other reference checks of 3.7 (decision A3). A backend that declares no server cannot use the key.
3. **Identity at run time.** A call is attributed to a widget only when the server was registered for the widget's backend, its declared `name` equals `mcp_server`, and the tool equals `tool_id`. `clientName` plays no part. Both registration paths record the backend's source id (section 6).
4. **The link is active** when the tool is in the agent's tool list for the request: the server is connected and enabled (an OAuth server needs the user's consent first), the user has not switched the tool off, the user's roles grant it, and the agent has MCP tools turned on. Whether the tool exists is known only after the server lists its tools, so it cannot be a load-time error. Otherwise the link is inert and the widget behaves as if it had none. The link never enables anything: the user's switches and the roles' grants decide, and the link follows them.
5. **Several widgets, one tool.** Allowed. A call is cited to the widget whose literal `args` all equal the call's arguments, the one with the most literals first, then the first the backend declares.
6. **`disableRetrievalForCopilot: true` and `mcp_tool` together are an error.** The first keeps the widget from the agent; the second hands the agent its query tool.
7. **Plugin types.** `mcp_tool` is a base key, valid on every type. It is host-only: the plugin's frame gets no binding for it and has no command or permission to call the tool.
8. **`iframe`.** `storage.mcpUrl` binds a server of the iframe's own to the instance (`components/Widgets/Iframe.tsx:335`), without the backend's credentials. That path stays as it is and neither uses nor conflicts with `mcp_tool`.

### 5.4 What the host and the agent do with it

1. **The agent is told.** Where the request is assembled (`getQueryFetchParams` and `getFunctionCallFetchParams`, `useAiFetchRequestInit.tsx:169` and `:313`), both the widget rows and the tool list are known. Each row of a widget with an active link gains `mcp_tool: { server_id, tool_name, args }`. `server_id` and `tool_name` are those of the matching entry in the request's `tools` (`AgentTool`, `ines/src/protocol/types.ts:59`), taken from the registry and not from the widget's strings, so a link can only name a tool the agent already has. `args` is the mapping as declared. The rows themselves are built by `createCopilotWidget` (`components/AI/hooks/useGetCopilotWidgets.tsx:463`).
2. **Ines shows it.** `Widget` gains the field (`ines/src/protocol/types.ts`). A `search_widgets` row carries the tool's name as the model sees it (`ines/src/mcp/factory.ts`) and the mapping, and the tool's description says that this field names the tool to load to query the widget's backend beyond the widget's own params. `get_widget_data` still reads the widget as before. The harness does no routing on content: it surfaces the tool and the model chooses (`ines/CLAUDE.md`).
3. **A call cites the widget.** As today, a call of a linked tool adds a citation for the widget. Its `input_args` are built through the mapping in reverse: for each `$param` entry, `input_args[param]` is the call's value for that argument. Arguments that map to no param stay in the citation's `details`. `Citation.tsx` then finds the widget on the dashboard by its own param names.
4. **The Workspace MCP shows it.** `get_widget_schema` and `list_available_widgets` return the widget's `mcp_tool` (3.8).

### 5.5 Security

- **The link grants nothing.** The call uses the user's own connection to the server, with the credentials the backend connection holds. The roles decide (`RoleMcpAccess`, matched on the server's URL and the tool's name) and the proxy checks every `tools/call` again.
- **`args` is a mapping, not a policy.** The model chooses the arguments and the server decides what a call may do. The tool should be a read-only query; the host does not enforce this, because MCP annotations are the server's own claim.
- **Only the backend's own servers.** The reference is a name resolved against the same backend's declarations (5.3), so a widget cannot attribute another backend's results to itself, and cannot point the backend's credentials at a host the backend did not declare.
- **A widget of a type the user has no renderer for** (a plugin type that is not enabled for them) is left out of their catalog (`partitionSupportedWidgets`), and its link goes with it.
- **No tool call at validation.** The endpoint probe never calls a tool, because tools can have side effects.
- **Nothing secret in the key.** It carries names, mappings and literals, all bounded (5.6).
- **Untrusted text stays untrusted.** The tool's and the widget's descriptions are the backend's own words, as today. The strings the agent receives for the link come from the registry.

### 5.6 In the schema

The base widget schema gains:

```jsonc
"mcp_tool": {
  "type": "object", "additionalProperties": false, "required": ["mcp_server", "tool_id"],
  "properties": {
    "mcp_server": { "type": "string", "minLength": 1, "maxLength": 128 },
    "tool_id":    { "type": "string", "minLength": 1, "maxLength": 128 },
    "args": {
      "type": "object", "maxProperties": 32,
      "additionalProperties": { "type": ["string", "number", "boolean"], "maxLength": 256 }
    }
  }
}
```

Per widget branch the composer also writes an `if`: when `disableRetrievalForCopilot` is `true`, `mcp_tool` is not allowed. `IGNORE_KEYS` goes: `mcp_tool` is a defined key, and `searchCategory` is settled by C6. What stays as code is in 3.7.

### 5.7 Example

A backend's `apps.json` declares the server (other keys omitted):

```json
[
  {
    "name": "Teams",
    "tabs": {},
    "mcpServers": [
      { "name": "Team data", "url": "https://<mcp-host>/mcp", "authType": "token" }
    ]
  }
]
```

The `team_report` widget of 4.9 opts in:

```json
"mcp_tool": {
  "mcp_server": "Team data",
  "tool_id": "get_team_report",
  "args": { "team_id": "$team", "period": "$period" }
}
```

With `team` set to `platform` and `period` to `month`, the agent's row for the widget names `get_team_report` and the mapping. When the agent calls it with `{ "team_id": "platform", "period": "month" }`, the result is cited as `team_report` with the `input_args` `{ "team": "platform", "period": "month" }`. The same call on a widget of another backend that names `Team data` does not match.

### 5.8 As built

- **The key** is in the contract (5.6), with the composer's rule against `disableRetrievalForCopilot: true`; a `$name` in `args` that names no declared param is a code check (`widgetsContractChecks.ts`).
- **Reference checks** (`validateBackend.ts`). `apps.json` is loaded before the widgets' errors are summed up and before the endpoint probe. A widget whose `mcp_server` names no server of the backend's `apps.json` is left out with `[mcp_tool/mcp_server]` and the reason; a backend with no `apps.json` declares no server. The check runs only when `apps.json` loaded with no invalid app (decision A3). One name naming two servers (different URLs) in one backend makes the later app invalid; the same server declared by two apps is allowed.
- **Registration** (`autoRegisterMcpForSource`) registers every declared server once per name and records `declaredName` and the backend's `sourceId`; `declaredName` is not editable, unlike the server's name and `clientName`, which the user can change. A server two apps declare was registered twice, because the loop checked a snapshot of the store; it now reads the store on each check. The listed-apps registration path is not used for links: it belongs to the apps marketplace, which is being removed.
- **The agent is told** (`lib/utils/mcpLink.ts`, used where the request is assembled in `useAiFetchRequestInit.tsx`). A widget row gains `mcp_tool: { server_id, tool_name, args }` only when the request's `tools` list the linked tool; `server_id` and `tool_name` come from that list. `CopilotWidget` has the field.
- **A call cites the widget** (`citeMcpCall`, used by `useMcpExecutor`). Only widgets of the server's own backend that name its declared name and the tool, compared exactly, are candidates; literal `args` choose among them (the most literals, then declaration order); `input_args` are built through the mapping in reverse, and the arguments that map to no param go in the citation's `details`.
- **The Workspace MCP** returns the declared link in `list_available_widgets` and `get_widget_schema`, and its tool description says what the field is.
- **Plugins.** The link is host-only: no trait source and no host command reach it. The hostile e2e plugin tries to read `mcp_tool` and to call `core:mcp:call`, and both are refused (abuse case 38).
- **Docs.** `specs/widgets-json.md` documents `mcp_tool`, and `specs/apps-json.md` documents `mcpServers` and a layout item's `storage`.
- **Ines** (5.4, item 2). A request's widget rows carry the link as the web app sends it (`Widget.mcp_tool` in `ines/src/protocol/types.ts`, checked and bounded in `routes/query.ts`). `linkedToolName` (`ines/src/mcp/factory.ts`) finds the registered tool by its server and its own name, never by the widget's strings, and names it as the model calls it; a `search_widgets` row then carries `mcp_tool: { tool, args }`, and the prompt's lists tag the widget `[query tool: <name>]`. The tool's description and the prompt say what the field is for. Nothing is routed by it: the model chooses.

## 6. Changes to existing code

| Where | Change |
|---|---|
| `frontend/src/utils/zodForms.ts` | Split `widgetShapeDefinition` into the base and per-type `data`. Close it with strict objects. Add `method`. Remove `widgetId`, `widgetType`, `defaultViz` and, per C6, the keys that are not backend contract. Define `mcp_tool` (5.6) and drop `IGNORE_KEYS`; `searchCategory` per C6. `endpoint` refuses `?` and `#`. |
| `frontend/src/lib/types/app.ts` | Close the `ParamDef` branches. Replace the five `unknown`s with defined value types. Move `multiple` into the text branch. Type `description` as a string. Add `in` to each branch except `form`, and `optionsMethod` to the `endpoint` branch; `optionsEndpoint` refuses `?` and `#`. `ParamDefSchema` is shared with saved dashboards, whose `endpoint.method` already allows `POST`. |
| `frontend/scripts/generate-widgets-schema.ts` (new) | Writes the kit. A test walks it for closedness and checks it matches the committed copy. |
| `frontend/src/lib/utils/widgetParams.ts` | `createWidgetEndpoint` stops forcing `GET`. One request builder replaces `cleanSearchParams`, `parseMarkdownParams` and `convertHeadersToRecord` at the data sites: URL with encoded placeholders and query, headers, body. The rules of 4.2 and 4.4, including the forbidden-name table, live here. The "URL already has a `?`" branch goes. |
| `frontend/src/lib/api.tsx` | `useJsonData` and `useMultipleQueries` call the builder, send the body, and put param header values and the body in the query key. |
| `frontend/src/lib/utils/app.ts`, `components/DraggableCard/FormParamDef.tsx` | `getEndpointParamRequestArgs` and the form's option lookup honor `optionsMethod` and send the body. The conversions (`createWidgetEndpoint` at `app.ts:1547`) read `method`. |
| `frontend/src/components/DataConnectors/common/helpers.ts` | The conversion at line 86 and the `createWidgetEndpoint` calls at 226 and 243 read `method` instead of writing `GET`. The source refresh (`updateWidgetEndpoints`) takes `data.<type>` from the definition along with `dataKey` (line 263). |
| `frontend/src/components/AI/hooks/useFunctionCall.tsx` | `getRequest`, `getHeadersAndUrlParams` and `getParamOptions` use the builder. `parseResponseBody` follows the type's `response.accepts` for plugin types. |
| `frontend/src/lib/utils/validateBackend.ts`, `apiSource.worker.ts` | Validate against the composed schema. `partitionSupportedWidgets` takes its type list from `x-types`. The endpoint probe sends `OPTIONS` to every route and runs no widget (4.8); The header-name check against the connection's credential headers. The `mcp_tool` reference checks of 3.7, once both files have loaded and only when `apps.json` itself is valid. |
| `frontend/src/components/AI/hooks/useWorkspaceBridgeCommandHandler.ts`, `src/api/workspace.api.ts` | `get_widget_schema` returns `data_args_schema`, `ui_args_schema`, each param's location, the widget's `method` and its `mcp_tool`; `list_available_widgets` returns `mcp_tool` too. `computeWidgetUiUpdates` rejects keys the schema does not define. |
| `frontend/src/components/AI/hooks/mcp/useMcpExecutor.ts` | `findEquivalentWidget` looks only at the widgets of the server's own backend, compares the server's declared `name` and the tool exactly, picks among several widgets by their literal `args` (5.3), and builds `input_args` through the mapping in reverse (5.4). |
| `frontend/src/lib/state/mcpTools.ts`, `lib/state/backendConnector.ts` | The registration path registers every declared server and records the backend's source id on it. The names in a backend's `mcpServers` are unique. |
| `frontend/src/components/AI/hooks/useAiFetchRequestInit.tsx`, `useGetCopilotWidgets.tsx`, `lib/state/copilot.ts` | The rows of widgets with an active link gain `mcp_tool` where the request is assembled (5.4). `CopilotWidget` gains the field. |
| `ines/src/protocol/types.ts`, `ines/src/agent/tools/search-widgets.ts` | `Widget.mcp_tool`; a `search_widgets` row names the tool as the model sees it and carries the mapping, and the tool's description says what the field is for. |
| `backend-api/backend/api/plugin_schema.py` (new), `plugin_discovery.py` | The composer, and the fragment lint at discovery. The forbidden-header table. |
| `backend-api/backend/routers/app/widget_plugins.py` | The schema endpoint. |
| `backend-api/backend/workspace_mcp/app_builder/resources/**`, `ines/mcp-server/src/resources/app-builder/**` | Generate the type and field lists; add the schema resource. Document `method`, `in`, `optionsMethod`, the placeholder rules, the `?` rule and CORS in `specs/widgets-json.md`, `specs/widget-parameters.md`, `backend-contract.md` and `guides/convert-endpoint-to-widget.md`. Document `mcp_tool` there, and the `mcpServers` of `apps.json` in `specs/apps-json.md`: no spec page covers either today. |
| `DESIGN.md` 4.4, GUEST-CONTRACT 3.1 | `handles[]` as objects; the `definition` binding. |

## 7. Decisions

**Settled.** Path parameters are `{param}` placeholders in `endpoint` and `in` has three values, not four. `optionsMethod` is added. A `?` or `#` in `endpoint` is an error, and so in `optionsEndpoint`, which goes through the same function. The endpoint probe sends `OPTIONS` to every route and runs no widget (4.8).

**Proposed, for the MCP opt-in.** Section 5 is a proposal in answer to "the widget needs also opt-in to a corresponding MCP tool for the same backend that the agent will use to query the backend". A1 to A4 are the forks in it.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| C1 | Unknown keys | An error: the widget is left out and the message names the path. | The contract is only "all accepted keys are defined" if anything else is refused. Backends that carry extra keys today need them removed. |
| C2 | Where plugin configuration lives | `data.<type>`, validated by the plugin's `definition`. | One namespace, no collisions, and it follows the shape of `data` today. |
| C3 | Where the schema is composed | The API, once. | Only the API knows the entity's plugins, and most consumers are not the SPA. |
| C4 | The SPA's validator | `ajv` as a direct dependency. The alternative is `z.fromJSONSchema`, which Zod calls semi-experimental. | The schema is the contract, so a standard engine and standard error pointers fit. |
| C5 | Global or per-entity schema | Per entity. | Enablement and handler choice are per entity. A global schema would admit types an entity cannot render. |
| C6 | Keys that are not backend contract | Remove `widgetId`, `widgetType`, `defaultViz`, and settle `storage` per type (the iframe's `mcpUrl` is one known use; the rest have to be found). | Internal fields should not be accepted from a backend. |
| A1 | Where a backend declares the MCP server a widget links to | The `mcpServers` of a template in its `apps.json`, as today, referenced by name. A backend with no template adds a minimal one (`name` and `tabs`). | One place for the URL, the auth type, the credentials and the user's switches, and a widget never holds a URL. The alternative, a URL in the widget, breaks the same-backend rule: credentials could be pointed at any host. |
| A2 | The tool beside the widget's endpoint, or instead of it | Beside. The agent keeps `get_widget_data` and is told the tool. | Routing an opted-in widget's reads through the tool needs routing in the harness that Ines forbids, and it changes what "the widget's data" means. The model chooses. |
| A3 | A reference to a server the backend does not declare | An error: the widget is reported and left out. The check runs only when `apps.json` is valid, so one broken file does not remove every linked widget. | The same class as the other reference checks. The alternative is a warning that drops only the link and keeps the widget, which accepts a contract with a dangling reference. |
| A4 | The shape of `args` | A map from tool argument to `$param` or a literal, whole when present, identity when absent. | It is the convention of `optionsParams`, and literals tell the widgets that link one tool apart. The alternative is no `args`, which forces every tool argument to be named like a param. |
