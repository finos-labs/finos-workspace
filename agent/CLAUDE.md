Copilot agent for the FINOS Workspace. Hono + Node + Vercel AI SDK + MCP. Node runs the TypeScript as it is (type stripping): no build step.

For architecture, tool inventory, file layout, env vars, request flow, the MCP and citation protocols, and the test strategy, read [README.md](./README.md). This file is rules, conventions, and gotchas only.

## Commands

```bash
npm run dev:agent     # agent on :7777
npm run dev:mcp       # MCP server on :8787
npm run typecheck     # tsc --noEmit — must be zero errors
npm test              # node --test over tests/ and mcp-server/test — must be all green before merge
```

Node is the runtime and npm the package manager.

## Hard rules — thin harness

The agent owns: protocol round-trips, widget tier/parse, citation aggregation, system prompt, **state-bound capabilities** (SQL family on `pendingTables` + `artifactQueue`, workspace bridge ops on the vendored bridge contract). Stateless / heavy / cold-start capabilities live in the MCP server. New capability needs in-process state the workspace can't reach → it's an agent tool; otherwise add it to `mcp-server/`.

- **No content-based routing in the harness.** No `isStructured()`, no `if data looks like X then path A else path B`. Surface tools, let the model pick. Generic dispatch by tool source (in-process vs SSE round-trip vs MCP) is structural, not content-based.
- **Never open MCP connections from the agent.** The workspace owns MCP. The agent emits `executeAgentTool` SSE for MCP tools (the FINOS Workspace's own among them, server id `workspace`), native `copilotFunctionCall { function: <command> }` for its own bridge ops (only for a request that does not carry the FINOS Workspace's tools), or runs locally (`search_widgets`, SQL family).
- **One `streamText` per iteration.** The outer `MAX_LOOPS=3` exists only for what is resolved without an HTTP round-trip — cache-resolved widget re-fetches and the agent's own skills (`src/skills/`) — not for orchestration. (`streamText`, not `generateText`: the loop consumes `fullStream` so in-process tool chains stream progress live; a stalled call is bounded by `LLM_STREAM_TIMEOUT_MS`.)
- **Tools have `execute` only when the work is local + cheap, *or* state-bound to in-process data.** Today that's `search_widgets` (closure on `tieredWidgets` — primary/secondary/extra preserved for ranking) and the SQL family (closure on `pendingTables` + `artifactQueue`). Everything else (widget data, skill, workspace bridge ops, MCP-registered) has no `execute`.
- **Prepare, don't prescribe.** Ship widget rows into `pendingTables`; the model decides whether to call SQL or answer directly.

The only acceptable harness branching is `lastMessage.role === "tool"` dispatched by `toolMsg.function` (`get_widget_data` default, `get_skill_content`, `execute_agent_tool`).

## Context — serve the current turn, fetch the rest

- **The model is given the current turn only** (`src/agent/messages.ts`, `src/agent/history.ts`): the user's last message and what has happened since, plus one small note that earlier messages exist. Never put earlier turns, earlier answers or whole earlier tool results back into the model input to "help": they cost every request more than the last and count against the user's tokens. A turn that needs them reads them with `recall_conversation`.
- **Anything the agent needs from an earlier turn that the model no longer sees is read from `request.messages` directly** (see `earlierEntries(request.messages)` in `loop.ts`), not from `ctx.messages`.
- **The note is constant in size** (a count and the last eight questions, cut short). Do not make it grow with the chat.
- **The model is given the tools it uses, and knows the rest exist** (`src/agent/tool-groups.ts`). The fixed cost of a model call was ~10k tokens (every tool's definition, every tool's instructions) for questions that needed none of them; the agent's own tools no longer cost it, while the Workspace-supplied tools (given in full, below) cost what their descriptions and parameters weigh. Core tools (`search_widgets`, `get_widget_data`, `get_skill_content`, `recall_conversation`, `load_tools`) are always there, and so are the tools that the FINOS Workspace supplies: those of the servers the user connected belong to no group, and the FINOS Workspace's own are the `always` group `workspace` (never in the catalog, its instructions always in the prompt). The model reads their descriptions and parameters before it acts; deferring them behind a one-line catalog had it call them blind, with arguments it guessed. Every other tool belongs to a group (`sql`, `dashboard`, `apps`, `render`, `planning`, `documents`, `web`) that the system prompt lists in one line, and that the model loads with `load_tools`. A group's instructions (`notes`) are in the system prompt only while it is loaded, so they are written in the group, never in `BASE_PROMPT`. The prompt and the active tools are rebuilt at every step (`prepareStep`); loaded groups ride in `extra_state.loaded_tool_groups` across round trips. A tool the model calls without loading its group is not refused, it loads the group. The agent loads a group itself only when the state makes it certain (tables loaded → `sql`; a PDF/DOCX widget or upload → `documents`): that decides which definitions are offered, never which path the model takes, so it is not content-based routing.
- **Documents are searched, not shown.** A PDF/DOCX (chat attachment or PDF widget) is never put in the model input, as bytes or as a `file` part: the round trip leaves a pointer, the agent ships the file's signed link to `query_documents` (`x-agent-documents`, `url`), and the MCP fetches it with `fetchClientUrl`. Citations of a search are shaped by the agent (`src/protocol/citations.ts`): the MCP reports every page it returned with its score, and the pages the shown answer names (`sink.text`, never the raw model text, which holds the suggestions block) are cited as the file widget at that page (`details: [{Filename, Page}]`, the shape the FINOS Workspace's `Citation.tsx` opens). The reported pages ride in `extra_state.document_hits` across round trips.

## TypeScript

- `strict: true`, zero errors at all times. CI gates on this.
- Node strips the types and runs the file, so: a relative import names the file with its extension (`./loop.ts`), a type is imported with `import type` (`verbatimModuleSyntax`), and only syntax that erases is used: no `enum`, no `namespace` with code, no constructor parameter properties (`erasableSyntaxOnly`). `tsc` says so when one slips in.
- No `any` unless unavoidable, and justify with a comment. Prefer `unknown` + type guards.
- `interface` for object shapes, `type` for unions/intersections.
- Wire types live in `src/protocol/types.ts`; MCP-result types in `src/mcp/results.ts`; ContentItem helpers in `mcp-server/src/lib/typed.ts`.

## Zod is the source of truth

- Every tool input is a Zod schema. Validate with `.parse()` — **never `as`**.
- Use `.describe()` on every field; the description is what the LLM sees.
- The MCP schema layer (`src/mcp/schema.ts`) handles `enum`, `anyOf`, `oneOf`, `null`, nested `object`, `array.items`, `nullable`, `const`. Extend it rather than collapsing into `z.unknown()`.

## Vercel AI SDK patterns

```ts
// Auto-execute tool — local + cheap, or state-bound to in-process data
const t = tool({ description, inputSchema, execute: async (args) => { ... } });

// Round-trip tool: omit execute → loop stops, harness emits SSE
const rt = tool({ description, inputSchema });
```

`stopWhen` includes one `hasToolCall(name)` per round-trip tool — `get_widget_data`, `get_skill_content`, every workspace bridge command name (while the agent's own bridge ops are registered), plus `mcpToolsResult.stopCondition` for external MCP tools, plus `stepCountIs(15)`.

Consume `result.fullStream` and emit live as parts arrive (`src/agent/loop.ts`):
- `text-delta` → held for the step (`pendingText`), never sent as it arrives. At the end of the step (or at its first `tool-call`) `showPendingText` decides by the tool calls alone: a step with a tool call is **reasoning** (one `reasoningStep`, sanitized, ≥15 chars, deduped); a step with none is the **answer**, sent whole through the text sink as one `messageChunk` (`mergeMessageChunks` joins the sink's 4 KB slices). The model must never be able to make text appear token by token, and the loop never classifies text by its content (the middleware below reads a call format at the model boundary and routes nothing).
- **Tool calls written into the text** (`<tool_call>{…}</tool_call>`, `<function=…>`, `[TOOL_CALLS]`) are turned into real `tool-call` parts by `src/lib/inline-tool-calls.ts`, a `LanguageModelV3Middleware` applied in `resolveModel`, so the loop never sees a marker and the rule above is unchanged. An unreadable marker or one naming a tool that is not offered is dropped, never shown. A new marker format is a row in `FORMATS`, with a test.
- `tool-call` → `reasoningStep` per call, carrying `{ tool_name, input }` (the eval trace runner reads this to attribute in-process calls)
- drain `artifactQueue` after every part (SQL family pushes synchronously from `execute`; MCP results push from `processMcpResult` on the next re-POST) — artifacts land right after the tool that produced them
- `abort`/`error` (or a thrown stream error) → ERROR `reasoningStep` + return
- after the stream drains, `await result.steps` / `result.totalUsage` / `result.text` for the round-trip dispatch (reads `lastStep` / `finalText`)

Tools never yield SSE directly. The `artifactQueue` is the single ordered side-channel.

## Decoration (`x-agent-*`)

Some data must ride along with an MCP call without the LLM seeing it. The document-RAG tools `query_documents` / `list_documents` use this path (`x-agent-conversation-id`, `x-agent-documents`). Three rules:

1. Inject into `parameters` in `src/agent/loop.ts` right before yielding `executeAgentTool`.
2. Read on the MCP side from the tool's args object.
3. **Any new internal-only key must start with `x-agent-`** — `src/mcp/schema.ts` strips that prefix from the model-facing schema. Without the prefix the model will see and hallucinate the field.

The document tools ship only the delta: `documentsShipped` tracks the documents already sent, persisted as `extra_state.documents_shipped`. Every round-trip emission must carry the continuation `extra_state` (`buildContinuationExtraState` in `src/agent/loop.ts`); an emission that drops those keys silently wipes the delta state mid-turn.

The SQL family lives in-process on the agent and reads `pendingTables` directly — no decoration, no wire payload.

## Conventions

- AsyncGenerators for SSE — every response path yields `SSEEvent` objects, never writes directly.
- LogTape: agent uses `["app", ...]`, MCP server uses `["mcp", ...]`. A single grep on `conversationId` traces a request across both processes.
- No classes. Pure functions and interfaces only.
- Request-scoped state goes in tool factories: `makeSearchWidgetsTool(allWidgets)`, `makeSqlTools({pendingTables, artifactQueue})`, `makeMcpTools(agentTools)`, `makeRetryTracker()`. Stateless tool factories (`makeWidgetDataTool`, `makeGetSkillContentTool`, `makeWorkspaceTools`) follow the same convention for consistency and testability.
- MCP server tool files export `<name>Schema`, `<name>Description`, `<name>Handler` and register in `mcp-server/src/server.ts`.
- Use the existing `singleShotLlm` (`src/lib/llm.ts`) for any new `/generate/*` route — don't hand-roll a new `generateText` wrapper.

## Gotchas

- **`X-Trace-Id` is the conversation key.** FINOS Workspace sets it per chat; the agent threads it as `conversationId` into the decoration of the tools that keep state per chat. Any code that needs per-chat state should derive from this, not invent its own ID.
- **MCP `content[]` arrives flattened.** FINOS Workspace's `useMcpExecutor.ts` JSON-stringifies the whole array into a single text item. `processMcpResult` recurses into array elements — preserve that when adding new typed-result kinds.
- **The model must see tool outcomes.** Artifacts ride the SSE side-channel, so `dispatchTyped` injects a delivery-ack line into the LLM message, and `buildMessages` renders every *earlier* `execute_agent_tool` result via `renderToolResultForHistory` (pure — no queue pushes, no `rememberRows`); the last tool message stays with `injectFromReboot`. When adding a typed-result kind, extend BOTH `dispatchTyped` and `renderToolResultForHistory`, or the model goes amnesiac about that kind and re-runs finished work.
- **The FINOS Workspace's own tools are MCP tools of server `workspace`** (`src/protocol/workspace-server.ts`). `makeMcpTools(agentTools)` registers all of them, with the FINOS Workspace's names, descriptions and schemas, except `get_skill_content` (the agent's own), whatever page the user is on. They are the `workspace` tool group, an `always` one (`tool-groups.ts` matches it by server id, not by name): given in full and with its instructions at every step. While the request carries any of them the agent's own bridge ops are not registered (`workspaceToolsOffered`): one surface per capability. Their calls are `execute_agent_tool`, which the browser runs one at a time, so the calls of a step after the first wait in `extra_state.pending_workspace_calls` and the loop makes them one per re-POST before it asks the model again (the mirror of `pending_bridge_calls`); that queue comes back from the browser, so a call is made only of a FINOS Workspace tool this request registers. Do not give the model a widget without its `origin` (the prompt lists it): the FINOS Workspace's tools need it, and a model that is not given it guesses. A widget's `current_value` is what it shows now (the web app's `createCopilotWidget` resolves parameter groups, which override the value a widget stored): the prompt shows it, and for an `[iframe]` widget (`widget_type`) it is the widget's state, so the model reads state from it, changes it with `update_widget` (which delivers the value to the page through the iframe protocol and confirms it), and uses the tools of the widget's own backend only for what parameters cannot say (those tools are given in full, as the backend describes them, and the backend sends the event to the page itself: the FINOS Workspace does not deliver events of a backend's tools; a result that is not `dispatched`/`confirmed` is not a change, and the prompt says so). Never call `get_widget_data` for a task that does not need the widget's data: not to change a widget, not to find out what it is set to (the prompt says so). Never read a widget's state from `get_widget_data` of an iframe widget: that is the page. A widget's text is never shown in the chat as an artifact: only tables are.
- **FINOS Workspace bridge ops are round-trips, one per turn.** The agent emits exactly ONE `copilotFunctionCall` SSE per turn — the first bridge call of the step (the browser executes each emission and re-POSTs immediately, so a second emission in the same turn would fork the conversation into duplicate continuations). When the model fires several bridge calls in one step, the remainder are QUEUED in `extra_state.pending_bridge_calls` and the loop drains them one-per-re-POST (before re-running the model) — NOT re-issued by the model, which it does not reliably do after firing them up front (2026-06-11: 19 `update_widget` calls, 1 executed, rest dropped, "I updated the widget" hallucinated). Mirror of `pending_widget_data_requests`; rides the same `extra_state` echo (FE `functionCallSchema` keeps it via `z.any()`). `buildMessages` renders EARLIER bridge results into history (like `execute_agent_tool`) so the final turn knows every queued mutation landed. Command names go over the wire verbatim — no legacy renames (the `update_widget` → `update_widget_in_dashboard` remap is gone; `round-trip.ts` still canonicalizes the old name when reading saved chat history). The browser runs the op via `useWorkspaceBridgeCommandHandler` (shared with the WS companion bridge) and re-POSTs a `{status, message, data}` tool result. Because they round-trip, bridge emissions MUST carry `buildContinuationExtraState` like every other round-trip. (The 16 ops are listed in `src/protocol/bridge-commands.ts`.)
- **SQL family runs in-process.** Tools have `execute` and read `pendingTables` from the factory closure. `create_artifact` pushes the artifact directly onto `artifactQueue` (loop drains after `generateText`). No decoration, no wire payload.
- **MCP factory filter.** `src/mcp/factory.ts` drops user-supplied MCP wrappers whose name collides with an agent-owned tool (SQL family + native helpers `enhance_prompt`/`_llm_think`/`create_table_from_text`/`create_html_artifact`/`create_app` + 16 bridge commands + bridge-mount extras `update_widget_layout`/`get_widget_data`/`get_skill_content` from `BRIDGE_MOUNT_EXTRA_NAMES`). If you add a new agent-owned tool, add its name to the filter so Path-B duplicates don't double-register.
- **A turn spans N POSTs, and telemetry has to follow it.** `extra_state.traceparent` (span context of the turn's FIRST request, echoed forward verbatim — never rewritten per-hop) and `extra_state.turn_usage` (token total across all requests) ride `buildContinuationExtraState` like every other continuation key. Drop them from an emission and the turn splits into disconnected traces with unrecoverable cost. Both are browser-echoed, so both are parsed defensively (`parseTraceparent`, `readTurnUsage` — null/zero, never throw). The turn span is ended in the loop's `finally`, because every round-trip exits through a `return`. Telemetry is a no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set; keep it that way — don't add span creation inside tool implementations, the AI SDK already emits `ai.toolCall` spans.
- **The prompt advertises only registered MCP tools.** `buildSystemPrompt` takes `mcpToolEntries` (the post-filter `makeMcpTools(...).entries`) — never list raw `request.tools` in the prompt. A prompt/registration mismatch makes the model call ghost tools (it sees a name+description with no schema, invents args, gets `NoSuchToolError`, and may then hallucinate success).

## Many users — rules that keep one user from another

The agent serves many users (README "Running for many users"). These are what keeps them apart; a change that breaks one is a security bug.

- **The user is the principal on the context** (`c.get("principal")`, set by `src/auth/middleware.ts` from the session token the FINOS Workspace API recognised). Never read `X-User-Id` or any other header a client can set for an identity.
- **State kept for a chat is filed under the scope key** (`scopeKey(userId, chatId)` in `src/lib/scope.ts`), which is what `conversationId` is inside the loop. Never key a cache or a store by the raw `X-Trace-Id`. A call to an MCP tool that keeps state carries that key and its signature (`x-agent-scope-sig`), and the tool checks it (`mcp-server/src/lib/scope-check.ts`).
- **A URL that came from a client is fetched with `fetchClientUrl`** (`src/lib/safe-fetch.ts`), never `fetch`: it refuses internal addresses and caps the size. The same goes for a new MCP tool that takes a URL.
- **Everything the FINOS Workspace decides is asked of the FINOS Workspace API** (`src/auth/workspace-client.ts`): who the user is, their roles, their limits. Do not copy that state into the agent.
- **Logs name things; they do not carry conversations.** Redaction (`src/lib/redact.ts`) is the last defence, not the first: log ids, counts and outcomes, never a request body, a message, a file or a token.
- **No metric label from a user, a chat or model-generated text.** Every distinct label value is a series that Prometheus keeps.
- **Work on a stranger's bytes does not run in the agent's own thread.** SQL, spreadsheets, PDF/Word text and page conversion go through `runInChild` (`src/lib/isolate.ts`): a child process with an empty env, a deadline and SIGKILL. A worker thread cannot be stopped inside native SQLite; an in-process regex or parser on a megabyte of someone else's text blocks every query and the health check. Check sizes (and a ZIP's directory, `zip-guard.ts`) before reading, and before any model or embedding call.
- **Every process-wide cache is bounded and filed under the scope key** (`createBoundedCache` in `src/lib/bounded-cache.ts`: age, entries, weight). A `Map` that only grows, or one keyed without the user, is a bug.
- **What outlives a request goes in the store, not in a module-level `Map`** (`src/lib/store.ts`). A turn is several requests, so anything the next one needs — who a token belongs to, a quota, a turn — is shared when `REDIS_URL` is set and per-process when it is not. A chat's tables and widget data are kept in Redis alone (`store.sharedOnly()`), never in a process's memory, and are not kept without Redis. Adding such a thing as a bare `Map` makes it right on one replica and wrong on two. The store never throws: an operation Redis cannot answer falls back to this process, so a new one must be a cache or a limit, never a correctness check that may not be skipped. The exception is `limits.running()`, which is deliberately local because a shutdown waits for *this* replica's queries.
- **A pattern that meets text from outside is tested with hostile text** (`tests/unit/src/lib/redos.test.ts`): nested or adjacent `\s*`, `[^x]*` that restarts at every character, and an unbounded alternation all take time with the square of the text. Bound the text first (see `redactString`) or the gap (see `pagesNamedIn`).
- **What the model reads is data, and an address it fetches or shows is a way out.** The agent signs a `fetch_webpage` address only if it was in what the model was given (`src/agent/known-urls.ts`; never a result of a tool that computes or repeats, never the model's own text), and the answer's text sink turns `![](…)` images into links (`neutralizeImages`). A new tool that sends a request somewhere the model names, or a new way for the answer to load a resource, needs the same. **A tool that reads outside content returns only that content, never the caller's own words** (`inspect_webpage` does not repeat the selector, phrase or path it was given), because its results count as given (`READING_TOOLS`): a result that echoed the model would launder an address the model chose into one the agent signs. A web page is read in parts through `fetch_webpage` (overview + `page_id`) and `inspect_webpage`, never put whole in front of the model (`src/lib/page-view.ts`, runs in a child; every view is bounded).
- **A capability an administrator can switch off is asked of the FINOS Workspace, never decided here.** The web tools are `SEARCH_WEB` and `FETCH_FROM_WEB` (settings of a role, on for a user when any of their roles allows them); the API's authorize answer carries `disabled_capabilities` and the denied tools. Whatever the agent does itself that is the same capability (the eager prefetch of the addresses in a message is `FETCH_FROM_WEB`) is skipped when it is off, and the model is told (`describeDisabledCapabilities`). A new tool for something an administrator should be able to switch off is a new `CopilotCapability` in the backend (`api/schemas.py`) and the same three steps: role setting, authorize, proxy.
- **A new setting with a default that is open (no auth, `*`) is a bug.** The secure value is the default; the open one is a named opt-out (`AGENT_AUTH=none`).

## When adding a capability

1. **Stateless / heavy / cold-start (web search, fetch): write a new MCP tool** in `mcp-server/src/tools/`. Export `Schema`/`Description`/`Handler`, register in `server.ts`. Use `typed.ts` helpers for artifacts/citations/tables.
2. **State-bound (operates on `pendingTables`, `artifactQueue`, or other request-scoped agent state): add an agent tool** under `src/agent/tools/` with an `execute` that closes over the context. Match the `make<Name>Tool(ctx)` factory pattern.
3. **New workspace bridge op:** extend `src/protocol/bridge-commands.ts` (Zod schema + description + name in `WORKSPACE_BRIDGE_COMMANDS`). The factory + loop dispatch picks it up generically.
4. **Give every new tool a group** in `src/agent/tool-groups.ts` (or make it core only if nearly every question needs it), with its instructions in the group's `notes`, not in `BASE_PROMPT`; an MCP tool no group claims is not deferred (its definition is always given). Keep tool descriptions short: they cost every call of every question that loads the group.
5. Update [README.md](./README.md) tool table when adding/removing tools.
