---
title: Ines HTTP API
sidebar_position: 3
---

# Ines HTTP API

Ines is a separate service from the Workspace API. It is a Hono application on Node that listens on port 7777 by default, and the web app talks to it directly from the browser. This page lists its routes, the checks that apply to them and the metrics that it serves. The questions that users ask travel over `POST /v1/query`, which has its own page, the [agent query protocol](../protocols/ines-query.md). The routes are defined in `agent/src/app.ts` and `agent/src/routes/`.

## Checks that apply to every route

**Origin.** Ines answers cross-origin requests from the origins that `INES_CORS_ORIGINS` lists. The value `*` allows every origin. The setting is required when authentication is on. The responses expose the headers `X-Trace-Id` and `X-Completion-Id` to scripts.

**Trace headers.** Every response carries `X-Trace-Id`, which repeats the request's header of that name or holds a new identifier, and `X-Completion-Id`, which is new for every response.

**Authentication.** Every route under `/v1` requires the header `Authorization: Bearer` with an [agent token](../protocols/agent-authentication.md), unless Ines runs with `INES_AUTH=none`. A request without a valid token receives the status 401, the body `{"error": "Not signed in"}` and the header `WWW-Authenticate: Bearer`. The routes outside `/v1` need no token.

**Body size.** A request body under `/v1` may not exceed `INES_MAX_BODY_MB` megabytes, which is 64 by default. The JSON helper routes accept at most 8 MB, and `/v1/transcribe` accepts a little more than 4 MiB. A larger body receives the status 413.

## Routes

| Method and path | Needs a token | What it does |
|---|---|---|
| `GET /` | No | Answers with the text `Ines`. |
| `GET /agents.json` | No | The agent's [descriptor](../schemas/agents-json.md). |
| `GET /status` | No | Answers `{"status": "ok", "timestamp": ..., "sharedState": ...}`. `sharedState` is true when Ines keeps its state in Redis, which a deployment with more than one replica needs. |
| `GET /ready` | No | Answers `{"status": "ready"}`. With authentication on, Ines first calls the `/health` route of the Workspace API with a timeout of 3 seconds, and when that fails it answers 503 with `{"status": "not ready", "reason": "the Workspace API does not answer"}`. |
| `POST /v1/query` | Yes | Asks a question. The answer is a stream of events, as described in the [agent query protocol](../protocols/ines-query.md). |
| `POST /v1/generate/chat/title` | Yes | Names a chat. |
| `POST /v1/generate/dashboard/title` | Yes | Names a dashboard. |
| `POST /v1/enhance_prompt` | Yes | Rewrites a question to be more specific. |
| `POST /v1/generate/widget_info` | Yes | Describes and classifies a widget from a sample of its data. |
| `POST /v1/generate/widget_info/file` | Yes | Describes an uploaded file. |
| `POST /v1/generate/code` | Yes | Writes or changes SQL or Python code for a widget. |
| `POST /v1/transcribe` | Yes | Turns a recording into text. |

## Helper routes

The helper routes make one call to the model and never run tools. Each user may make `INES_HELPER_CALLS_PER_MINUTE` of these calls a minute, which is 60 by default, and beyond that the route answers 429 with `{"error": "Too many requests. Try again in a minute."}` and `Retry-After: 60`. The tokens that a helper call uses are added to the user's usage, but the call does not count as a question. A body that is not JSON receives the status 400 and `{"error": "Invalid JSON"}`, and a body that does not fit the route's schema receives 400 and `{"error": "Invalid request", "details": [...]}`.

Every JSON helper accepts the optional field `model`. Ines uses it when this deployment offers the model and the user's roles allow it, and otherwise it uses `DEFAULT_MODEL` without reporting an error. When the model call fails, each helper answers with the fallback that the table gives, so that the interface never waits on a failure.

| Route | Request | Answer | Fallback |
|---|---|---|---|
| `/v1/generate/chat/title` | `messages`, a list of 1 to 1,000 objects with `role` and `content`. Ines reads the last five that have the role `human`, each cut to 500 characters. | A JSON string that holds the title, for example `"Revenue by region"`. | `"New Chat"`, also when there is no `human` message. |
| `/v1/generate/dashboard/title` | `widgets`, a list of 1 to 1,000 objects with optional `uuid`, `name`, `description` and `metadata`. Ines reads the first 20 names. | Plain text, the title. | `My Dashboard`, also when no widget has a name. |
| `/v1/enhance_prompt` | `messages` as above, and optionally `widgets`, `context`, `urls`, `workspace_state`, `workspace_options`, `timezone` and `tools`. Ines rewrites the last `human` message, cut to 4,000 characters, and uses the names of up to 30 widgets as hints. | Plain text, the rewritten question. | The original question. An empty string when there is no `human` message. |
| `/v1/generate/widget_info` | `widget_generation_request` with `widget_data`, a string of which Ines reads the first 3,000 characters, and optionally `metadata`, `name` and `description`. | A JSON object with `title`, `description`, `category` and `subcategory`. | An object made from the request's own `name`, `description` and `metadata`, with the category `Other`. |
| `/v1/generate/widget_info/file` | A multipart form with the field `file`, at most 25 MB. Ines reads the first 3,000 characters. | A JSON object with `title` and `description`. | The file's name without its extension as the title, and the file's name as the description. |
| `/v1/generate/code` | `widget_uuid`, `user_prompt` of up to 20,000 characters, `language`, which is `sql` or `python`, and optionally `current_code`, `sql_schema` and `data_sample`. | `{"success": true, "generated_code": "..."}` or `{"success": false, "error_message": "..."}`. | `{"success": false, "error_message": "Code generation failed"}`. |

The file route answers 400 with `{"error": "Missing 'file' field in form data"}` when the form has no `file`, and 413 when the file is larger than 25 MB.

## Speech to text

`POST /v1/transcribe` needs the setting `INES_TRANSCRIBE_MODEL`. Without it the route answers 404 with `{"error": "Speech to text is not set up for this agent."}`, and the descriptor leaves out the feature `speech-to-text`. The request is a multipart form with the field `audio`, which must be a 16-bit PCM WAV file of at most 4 MiB. The answer is `{"text": "..."}`. A recording that is too long receives 413, a file that is not a 16-bit PCM WAV receives 400 and a failure of the speech model receives 502 with `{"error": "Speech to text failed. Try again."}`.

## Metrics

Ines serves Prometheus metrics from a second listener, so that they never share a port with the API that users reach. The listener answers `GET /metrics` on the port that `INES_METRICS_PORT` names, which is 9464 by default, and the value 0 turns it off. It does not authenticate requests. The metrics never carry a label that comes from a user, a chat or text that a model wrote, so the number of series stays fixed.

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `ines_http_requests_total` | counter | `route`, `method`, `status` | HTTP requests. A route that does not exist is counted under `other`. |
| `ines_http_request_duration_seconds` | histogram | `route`, `method` | Time until a request is answered. For a stream, until it starts. |
| `ines_queries_total` | counter | `outcome` | Questions, by outcome: `completed`, `continued`, `limit`, `denied`, `busy`, `invalid`, `error` or `aborted`. |
| `ines_query_duration_seconds` | histogram | `outcome` | Time until the last event of a question is sent. |
| `ines_active_queries` | gauge | | Questions being answered now. |
| `ines_model_tokens_total` | counter | `direction` | Model tokens used, as `input` or `output`. |
| `ines_model_calls_total` | counter | `provider` | Calls made to a model, one for each step of a question. |
| `ines_model_errors_total` | counter | `provider` | Model calls that failed. |
| `ines_helper_calls_refused_total` | counter | | Helper calls that were refused because a user made too many in a minute. |
| `ines_workspace_api_requests_total` | counter | `endpoint`, `outcome` | Calls to the Workspace API, by endpoint and by outcome: `ok`, `rejected`, `limit` or `error`. |
| `ines_workspace_api_request_duration_seconds` | histogram | `endpoint` | Time that a call to the Workspace API takes. |
| `ines_auth_cache_total` | counter | `result` | Lookups of a signed-in user in the cache: `hit`, `miss` or `rejected`. |
| `ines_store_errors_total` | counter | `op` | Times the shared store could not answer and the process answered instead. A value that keeps rising means quotas and turns are counted for each replica. |
| `ines_conversation_recalls_total` | counter | `mode` | Times the model read an earlier part of a chat, by `latest`, `words` or `numbers`. |
| `ines_isolated_runs_total` | counter | `kind` | Work done in a child process, by how it ended: `ok`, `failed`, `timeout`, `crash`, `output`, `busy` or `protocol`. |
| `ines_isolated_run_duration_seconds` | histogram | `work` | How long such work took, by kind of work. |
| `ines_unhandled_errors_total` | counter | `kind` | Errors that nothing handled, as `rejection` or `exception`. |
| `ines_mcp_tool_calls_total` | counter | `tool`, `outcome` | Calls of the MCP server's tools, as `ok` or `error`. Only the MCP server's process updates it. |
| `ines_mcp_tool_duration_seconds` | histogram | `tool` | Time that a tool of the MCP server takes. Only the MCP server's process updates it. |
| `process_resident_memory_bytes`, `process_uptime_seconds` | gauge | | Resident memory and uptime of the process. |
| `ines_build_info` | gauge | `version` | Always 1. The label is the value of `OTEL_SERVICE_VERSION`, or `dev`. |

The MCP server serves the same kinds of metrics on `MCP_METRICS_PORT`, which is 9465 by default, and a value of 0 or less turns them off. Ines also exports traces over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and it prints them to its log when `OTEL_TRACES_CONSOLE` is `true`. Without either setting it creates no spans. The service name is `OTEL_SERVICE_NAME`, which is `ines` by default.
