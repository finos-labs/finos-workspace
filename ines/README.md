# Ines

**Ines** is the Workspace's copilot agent. It searches the widgets on your dashboards, fetches their data, runs SQL over that data in-process, builds and edits dashboards, and streams back cited answers. It is made for a deployment with many users: it signs each caller in with the Workspace API, enforces the roles and usage limits the Workspace's admins set, keeps each user's chats apart, and says what it does in structured logs and Prometheus metrics (see [Running for many users](#running-for-many-users)).

The **MCP server** (in [`mcp-server/`](./mcp-server)) holds the tools she uses beyond the widgets: web search, web-page fetch and document search. In the repository's `docker-compose.yml` it runs with the agent and every user has it. The agent itself (widget search, data, SQL, dashboards, skills) does not need it.

Built on Bun + Hono + the Vercel AI SDK + the Model Context Protocol.

> **Who this is for:** developers who want to run, fork, or study a small, production-shaped financial copilot. You need the Workspace plus one LLM provider key (or a local Ollama) to run the agent. The MCP server is independent — it also works on its own with any MCP client, such as Claude Desktop.

## Contents

- [Quickstart](#quickstart) — get it running
- [Philosophy](#philosophy) — the thin-harness idea
- [Architecture](#architecture) — what the agent owns, what the MCP server owns, repo layout
- [How it works](#how-it-works) — request flow, result protocol, decoration, citations
- [Running for many users](#running-for-many-users) — sign-in, roles, limits, isolation, logs and metrics
- [Extending Ines](#extending-ines) — adding a capability
- [Testing](#testing) — the three tiers
- [Configuration](#configuration) — environment variables and endpoints
- [FAQ](#faq) — model selection, Docker + Ollama, common startup errors
- [License](#license) — Apache-2.0

## Quickstart

### Prerequisites

- [Bun](https://bun.sh) v1.x
- The Workspace — needed to use the agent from its UI (the repository's `docker-compose.yml` runs both)
- At least one LLM provider key: `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, or `NVIDIA_API_KEY` — or a local [Ollama](https://ollama.com) endpoint via `OLLAMA_BASE_URL`
- Optional, for some of the MCP server's tools: `INES_EMBED_MODEL` as `<provider>:<model>` with that provider's key (document search). Web search uses DuckDuckGo and needs no key

### Run it

```bash
bun install
cp .env.example .env          # set DEFAULT_MODEL and that provider's key, and INES_AUTH=none (see below)

bun run dev:agent             # agent only, on :7777
bun run dev:all               # agent and MCP server, prefixed/colored logs, --kill-others
bun run dev:mcp               # MCP server only, on :8787

bun run typecheck             # bunx tsc --noEmit — must be zero errors
bun run test                  # bun test tests/ mcp-server/test
```

Outside the repository's compose stack there is usually no Workspace API to sign users in with, so on a development machine set `INES_AUTH=none` in `.env`: every request is then anonymous and nothing is counted (Ines logs a warning). Without it she expects the settings of a deployment with users and says which are missing when she starts.

`bun run dev:agent` alone is enough for widget search, data fetching, SQL analysis, dashboard editing, and skills; the MCP server adds the rest.

### Connect it to the Workspace

With the repository's `docker-compose.yml`, Ines is already wired in: the web app's `AI_API_URL` points at her and the Copilot is on. To connect a Workspace by hand, in **AI Library → AI Agents → Add Agent** add Ines as a custom agent:

- **Custom agent** → `http://localhost:7777`. The Workspace reads the descriptor at `/agents.json` and sends queries to `/v1/query`.
- **MCP server** → `http://localhost:8787/mcp`. The Workspace lists the tools on connect and forwards them to the agent in each request. With the repository's `docker-compose.yml` you do not add it: the API registers it for every user (`DEFAULT_MCP_SERVERS`), and the web app calls it through the API's MCP proxy, which is also where a user's roles are checked on each tool call. The Workspace's own tools need no registration: the web app gives them to the agent itself.

If you only want the MCP server with a different client (Claude Desktop, say), skip the agent and point that client at `http://localhost:8787/mcp`. See [The Workspace's tools: three surfaces](#the-workspaces-tools-three-surfaces).

### Run it in a container

The Dockerfile has two targets: `ines` runs the agent (`src/server.ts`) on port `7777`, and `ines-mcp` runs the MCP server on `8787`. The agent's logs are JSON and her metrics are on `9464` (the MCP server's on `9465`); neither port needs publishing.

```bash
docker build --target ines -t ines .
docker run --rm -p 7777:7777 --env-file .env ines          # with INES_AUTH=none in .env, or the settings of a deployment
docker build --target ines-mcp -t ines-mcp .
docker run --rm --env-file .env ines-mcp
```

## Philosophy

Ines follows the **thin harness** principle: the model drives decisions, the code provides capabilities. Like opencode, Claude Code, and Codex, the harness is a capability broker and safety rail — not an orchestrator.

Two ideas drive the codebase:

1. **The model picks tools, not the harness.** No `if data looks like X then path A else path B` heuristics. Every tool sits in front of the model with a clear description, and the model chains them as it sees fit. The only branching the harness does is by *where a tool runs* (in-process vs. SSE round-trip vs. MCP), never by inspecting tool content.
2. **Capabilities live in MCP servers.** The agent is deliberately lean — it owns only what needs the Workspace's Copilot protocol or local request state. Web search, fetch, diagrams, and document RAG all live in the reference MCP server. Adding a stateless capability is one new tool file there; the agent code is untouched.

Why structure it this way:

- **Feature velocity.** A new stateless capability is a new file in `mcp-server/src/tools/` — no agent edits, no system-prompt regression risk, no SSE-handling regression risk.
- **A small system prompt.** With MCP, the tool description sent at registration *is* the instruction. The prompt stays short and focused instead of growing a section per feature.
- **Customer extensibility.** Anyone can write their own MCP server and register it with the Workspace; Ines treats it as one more tool in the list and ranks it for relevance the same way it ranks widgets.
- **Industry alignment.** Thin core, capabilities over a standard extension mechanism — the pattern every serious agent is converging on.

The core boundary, stated once: **core = anything that operates on data the agent already holds** (the widget list, `pendingTables`, the citation aggregator) **plus protocol mechanics** (SSE events, the vendored bridge contract). **Everything else goes to MCP** — stateless, heavy, cold-start, or third-party — with no exceptions made for convenience.

## Architecture

```
Workspace ──POST /v1/query──▶ Agent
   ▲   ▲                       │
   │   │                       │ streamText loop (MAX_LOOPS=3)
   │   │                       ▼
   │   │             ┌─ search_widgets        → executes locally → loop continues
   │   │             ├─ SQL family            → executes locally (closure) → loop continues
   │   │             ├─ get_widget_data       → SSE → workspace fetches widget data
   │   │             ├─ get_skill_content     → Ines's own skill: read locally → loop continues
   │   │             │                          the user's skill: SSE → workspace loads it
   │   │             ├─ Workspace tool        → SSE execute_agent_tool (server "workspace") → the user's tab runs it
   │   │             ├─ workspace bridge op   → native SSE copilotFunctionCall {function, input_arguments} → terminal
   │   │             │                          (only for a request without the Workspace's tools)
   │   │             ├─ external MCP tool     → SSE execute_agent_tool → workspace dispatches
   │   │             └─ text                  → SSE message + citations (terminal)
   │   │
   │   └─ Workspace re-POSTs with role:"tool" message containing data
   │
   └─ Workspace ◀── MCP server ◀── workspace.callTool(server_id, tool_name, parameters + decoration)
```

### What the agent owns

This is the agent's irreducible scope — all of it runs without the MCP server:

- Widget tier classification + `search_widgets`
- `get_widget_data` round-trip
- Widget data parsing (CSV / JSON / images → table schema; PDF/DOCX → a pointer to the document search)
- **Skills**: the catalog in the system prompt (the user's skills, which the Workspace lists, and Ines's own in `src/skills/`: `html-report`, `html-table`, `html-chart`) and `get_skill_content`, which reads Ines's own and round-trips to the Workspace for the user's. `/agents.json` lists Ines's own under `skills` (slug and description), so the Workspace shows them, read-only, in its Skills tab and `/` menu; a user who picks one sends only its slug, and Ines adds its instructions
- **SQL family** (`execute_sql`, `peek_table`, `peek_column_values`, `create_artifact`) — in-process `bun:sqlite`, a closure over `pendingTables`
- **Tool groups** (`load_tools`, the catalog in the system prompt, the instructions that go with a loaded group) — the model is given the few tools every question can need and a one-line catalog of the agent's own others. The tools that the Workspace supplies (the connected servers' and its own) are never deferred: they are given in full, with their descriptions and parameters, so the model reads how to use them before it acts; see `src/agent/tool-groups.ts`
- **Native helpers** (`enhance_prompt`, `_llm_think`, `create_table_from_text`, `create_html_artifact`, `create_app`) — local and state-bound to `artifactQueue` / `pendingTables`. `create_app` validates each `(origin, widget_id)` against the live widget catalog and emits an `app` artifact (an apps.json template) the Workspace renders with open-as-dashboard / save-to-apps actions
- **Workspace bridge tools** — the agent's own function calls for the Workspace (`update_widget_in_dashboard`, `add_widget_to_dashboard`, `get_params_options`, `manage_navigation_bar`, `add_generative_widget`, `assign_tasks_to_agents`; the vendored bridge contract declares more, which only the WebSocket companion has), emitted as native `copilotFunctionCall` SSE. They are only for a request that does not carry the Workspace's own tools (see [The Workspace's own tools](#the-workspaces-own-tools))
- `execute_agent_tool` round-trip + typed-result handler (the bridge for any external MCP tool)
- `extra_state` preservation across re-POSTs
- Citation aggregation (widgets + MCP web; a search of a document is cited as the file widget at the pages the answer names)
- System prompt builder

### What the optional MCP server owns

Stateless / heavy / cold-start capabilities, exposed over Streamable HTTP MCP. None of these are required for the agent to run. `web_search`, `fetch_webpage` and `inspect_webpage` need no key; the others are registered only when their key or binary is present.

| Tool | Backend | Notes |
|---|---|---|
| `web_search` | DuckDuckGo (HTML endpoint, no key) | The capability **SEARCH_WEB** (see "The web tools", below). Returns text + web citations via `$ines_kind`. DuckDuckGo can answer a burst of queries with a human-check page; the tool then says so and the model can retry later |
| `fetch_webpage` | `fetchClientUrl` + a DOM in a child process | The capability **FETCH_FROM_WEB**. Fetches a page and holds it for the chat; returns an **overview** (title, description, outline, what it contains, embedded JSON, the first 3,000 characters of its text) and a `page_id`, never the whole page |
| `inspect_webpage` | the held page, read in a child process | Part of **FETCH_FROM_WEB**. Reads a held page by `page_id`, a bounded amount per call: `text` (readable text as markdown, from an offset), `find` (a literal phrase, with its offset and the text around it), `select` (elements by CSS selector), `links`, `tables` (returned as tables the agent loads for SQL), `data` (JSON the page embeds: JSON-LD, `__NEXT_DATA__`; by path), `raw` (the HTML source, from an offset or around a phrase) |
| `query_documents` | Embeddings from `INES_EMBED_MODEL` + in-memory/Redis store | RAG search over uploaded docs (PDF per page, DOCX, TXT/MD/HTML); the files come by signed link or as bytes; each hit is tagged with its page and the tool reports every page with its score; gated by `INES_EMBED_MODEL` and its provider's key |
| `list_documents` | same store | Inventory of docs loaded in the conversation |

### Repo layout

```
src/                           # Agent (port 7777) — the standalone product
├── server.ts                  # Hono entry
├── routes/
│   ├── agents.ts              # GET /agents.json
│   ├── status.ts              # GET /status
│   ├── query.ts               # POST /v1/query
│   └── generate/              # Auxiliary single-shot LLM endpoints
├── agent/
│   ├── loop.ts                # Single agentic loop, step walker, decoration step
│   ├── messages.ts
│   ├── prompt.ts
│   ├── tool-groups.ts         # Which tools the model is given: core tools, groups, load_tools, per-group instructions
│   ├── round-trip.ts          # Re-POST data injection
│   ├── context.ts             # request.context split (tables vs text blocks)
│   ├── documents.ts           # uploaded-doc decode + RAG decoration
│   ├── file-docs.ts           # file-widget → RAG document bridge
│   ├── row-cache.ts           # cross-request widget row cache
│   ├── url-prefetch.ts        # eager URL prefetch
│   └── tools/
│       ├── search-widgets.ts
│       ├── widget-data.ts
│       ├── skills.ts
│       ├── workspace.ts       # makeWorkspaceTools — 16 native bridge ops
│       ├── native.ts          # hub: enhance_prompt, _llm_think, create_table_from_text, create_html_artifact
│       ├── enhance-prompt.ts
│       ├── think.ts
│       ├── table-from-text.ts
│       ├── html-artifact.ts
│       └── sql/               # execute_sql, peek_table, peek_column_values, create_artifact (in-process)
├── widgets/                   # tiers, parse, parse-as
├── sql/                       # loader (analyzeTable — type inference only)
├── skills/                    # Ines's own skills: one markdown file per slug, and the catalog
├── mcp/                       # factory, schema, results, retry
├── protocol/                  # types, events, stream, extra-state, citations, bridge-commands
└── lib/                       # providers, llm, token-usage, logger

mcp-server/                    # Optional companion MCP server (port 8787)
└── src/
    ├── server.ts              # @modelcontextprotocol/sdk + @hono/mcp
    ├── lib/                   # typed.ts (ContentItem helpers), redis.ts, logger.ts
    ├── bridge/                # Path B bridge protocol (singleton, routes, state, validators)
    ├── prompts/               # MCP prompt definitions
    ├── resources/             # MCP resources (app-builder guides, etc.)
    └── tools/
        ├── backend/
        │   ├── web-search.ts
        │   ├── fetch-webpage.ts
        │   └── documents/     # query_documents, list_documents + extract/chunk/retrieve/store
        └── workspace/         # Path B (Claude Desktop) wrappers around the bridge — filtered out for Ines

tests/                         # Tiers 1 + 2 (every PR, mocked LLM)
├── unit/                      # Pure-function + per-tool tests, mirrors src/ and mcp-server/ layout
├── integration/agent-loop/    # Loop-level scenarios with mocked LLM
├── helpers/                   # mock-llm, sse-reader, clear-state
└── fixtures/

evals/                         # Tier 3 (nightly, real LLM)
├── runner.ts                  # Orchestrator + summary report
├── trace.ts                   # Single-shot agent loop capture
├── cases/                     # widget-selection, tool-routing, sql-analysis, intent,
│                              # workspace-context, locale, citations, file-widgets,
│                              # mcp-routing, native-tools, skills, url-context
├── graders/                   # toolCalled, widgetIdInTopN, argContains, llmJudge, noBadState, ...
└── runs/<date>/               # Per-trial trace JSONs (gitignored)
```

### Tech stack

| Layer | Choice |
|---|---|
| Runtime | Bun |
| Package manager | bun |
| HTTP | Hono |
| AI SDK | Vercel AI SDK v6 (OpenAI, OpenRouter, Groq, Ollama) |
| MCP SDK (server) | `@modelcontextprotocol/sdk` + `@hono/mcp` |
| Validation | Zod (everywhere) |
| In-process SQL | `bun:sqlite` (per-call, on the agent) |
| HTML → Markdown | Turndown |
| Logging | LogTape |

## How it works

### The agent never opens an MCP connection

The Workspace is the only thing that speaks MCP. The agent just emits SSE events that say "please call this tool" and waits for the Workspace to re-POST the result — the same protocol every other Workspace MCP integration uses. There are three SSE function-call shapes the agent emits:

| Function | Used for | Frontend dispatcher |
|---|---|---|
| `get_widget_data` / `get_skill_content` | Bespoke agent paths with widget-tier resolution / skill payload | bespoke |
| `<command>` (one of the agent's own bridge commands, above) | Workspace ops for a request without the Workspace's tools: `update_widget_in_dashboard`, `add_widget_to_dashboard`, … | the Workspace's `handleFunctionCall` |
| `execute_agent_tool` | Any MCP tool: the Workspace's own, web search, fetch, document search, third-party MCPs | `useWorkspaceToolExecutor` for the Workspace's own (server id `workspace`), `useMcpExecutor` for the rest |

(Both live in the Workspace frontend, not in this repo.)

The flow for **external MCP tools**:

1. The Workspace boots, lists tools from each configured MCP server, and caches the descriptors.
2. The user sends a message. The Workspace POSTs `/v1/query` with `body.tools = [all currently connected MCP tools]`. (When no MCP server is connected, this list is empty and the agent runs on its own tools.)
3. The agent filters out any user-supplied MCP wrapper whose name collides with an agent-owned tool (the SQL family + the bridge commands). The Workspace's own tools (server id `workspace`) are not wrappers of those: see below.
4. The agent registers each remaining tool as a no-execute `tool({...})`. The model picks one. The agent emits `copilotFunctionCall { function: "execute_agent_tool", input_arguments: { server_id, tool_name, parameters } }`.
5. The Workspace dispatches `mcpConnection.callTool(...)` to the right server and gets the result back.
6. The Workspace re-POSTs with a `role: "tool"` message containing the MCP `content[]`.
7. The agent's `processMcpResult` parses each item, pushes artifacts/citations into the queue, injects text into context, and resumes the loop.

**Workspace bridge ops** skip the MCP detour entirely: the agent emits `copilotFunctionCall { function: <command>, input_arguments: <bridge shape> }` and the Workspace frontend runs the operation directly in the browser. Same SSE surface as `get_widget_data` / `get_skill_content`. A request that carries the Workspace's own tools has no use for them (next section).

### The Workspace's own tools

The Workspace gives the agent in its web app the tools it has for itself, with the tools of the MCP servers the user connected: each is a tool of the request with the name (`Workspace_<tool>`), the description and the schema that the Workspace gives it, from the same server that external hosts connect to over MCP. Their server id is `workspace` (`src/protocol/workspace-server.ts`). The user is signed in and the tab is theirs, so the tab runs a call (as it runs the call of any MCP tool, `execute_agent_tool`), as that user: the API recognises the user by the session token and checks the call against the user's roles. No MCP connection, token or bridge session is involved; a replaced agent gets the same tools in the same way.

What the agent does with them:

- **Reading a widget** is `get_widget_data`, under its own name, with the schema the Workspace gives it (`origin`, `widget_id`, `data_args`, `widget_uuid`). The result is taken in as the widget's data, tables the model queries (`src/agent/workspace-widget-data.ts`). A request without the Workspace's tool still has the agent's own `get_widget_data`. For data a widget does not show, the model uses the MCP tools of the widget's own backend.
- **Everything else** (`create_widget`, `update_widget`, `update_widget_layout`, `delete_widget`, `manage_dashboard`, `manage_navigation_bar`, `navigate_workspace`, `add_generative_widget`, `get_params_options`, `list_available_widgets`, `get_widget_schema`, `read_widget`, `get_workspace_snapshot`, `manage_backends`, `manage_apps`, `assign_tasks_to_agents`) is always registered, whatever page the user is on, and is the `workspace` tool group the model loads with `load_tools`. `get_skill_content` stays the agent's own.
- **The agent's own function calls for the Workspace are not registered** when the request carries any of the Workspace's tools: one way to do each thing, the tool the Workspace describes.
- **Calls made together are made one by one.** The browser runs one function call per re-POST, so the first call of a step is emitted at once and the rest wait in `extra_state.pending_workspace_calls`; the loop makes them one per re-POST, before the model is asked again, so that a model that updates five widgets at once has all five updated. What comes back from the browser is not trusted: a queued call is made only of a Workspace tool that this request registers.
- **A widget is named by its `origin` and `widget_id`**, which the prompt's widget lists show (`[origin: …]`, and the name's parentheses) and `search_widgets` returns.
- **A widget may name the tool that queries it.** A backend's widget can opt in to one MCP tool of the same backend (`mcp_tool` in its widgets.json, docs/widget-plugins/WIDGETS-JSON.md 5). The web app sends the link only while that tool is in the request's tools, as `{ server_id, tool_name, args }`; the agent finds the registered tool by those, never by a name the widget wrote (`linkedToolName`, `src/mcp/factory.ts`). Its `search_widgets` row then has `mcp_tool: { tool, args }`, the prompt's lists tag it `[query tool: <name>]`, and `args` says how the widget's params fill the tool's arguments. The model decides whether to use it.
- **A widget advertises its state.** Each widget of the request carries its current parameters (`current_value`: what it shows now; the web app resolves the dashboard's parameter groups before it sends them) and its `widget_type`. The prompt lists the parameters with their values, and tags a widget that embeds a page of its own backend `[iframe]`. The web app sends that widget with every request, by its uuid, whether or not its page has connected and published entries yet (those come in as entries of their own, `<uuid>::iframe::<id the page made up>`). For such a widget the parameters *are* its state, so the model does not fetch it to find out, and it does not fetch its page (`get_widget_data` on the widget itself returns HTML; what the page publishes is read from its `::iframe::` entry, through the iframe protocol). A parameter of it is changed with `update_widget`, which hands the value to the page through the iframe protocol and says in its result that it did. The tools of the widget's own backend are for what parameters cannot say (indicators, drawings...): they are the backend's own tools, called as their descriptions and parameters say, and the backend sends the event to the page itself. What one widget's page or backend does is not assumed of another's. A result that says `dispatched: false`, `confirmed: false` or an error means nothing is known to have changed, and the model says that. The widget's parameters in the next request are the proof.
This means the agent is **offline with respect to MCP**: zero outbound connections to any MCP server, no third-party API keys ever in the agent, and nothing to invalidate when a user toggles a server on or off — the next request simply carries a different tool list.

### Typed MCP result protocol

Standard MCP only carries text/image/resource content. Ines extends this without breaking compatibility: each text content item is either plain text **or** a JSON object with a `$ines_kind` discriminator.

```json
{ "$ines_kind": "artifact",     "artifact": { ... } }
{ "$ines_kind": "citation",     "citation": { "type": "web", "url": "...", "title": "..." } }
{ "$ines_kind": "sqlite_table", "name": "...", "rows": [...] }
```

Helpers in [`mcp-server/src/lib/typed.ts`](./mcp-server/src/lib/typed.ts): `textItem()`, `artifactItem()`, `webCitationItem()`, `documentCitationItem()`, `sqliteTableItem()`. Plain text (no `$ines_kind`) is injected as a normal message. A per-item discriminator — rather than a fixed outer envelope — lets one result mix kinds (text + citations + an artifact + a table) and lets plain-text or third-party tools work without any conformance.

### Decoration (`x-ines-*`)

Some agent-side data has to ride along with an MCP call without the LLM seeing it. The document-RAG tools (`query_documents` / `list_documents`) use it:

- `x-ines-conversation-id` — the Workspace's `X-Trace-Id`; keys the per-chat document store
- `x-ines-documents` — the delta of uploaded-doc bytes shipped to the document tools for ingest

The agent injects these into `parameters` just before emitting the SSE event; the Workspace forwards `parameters` byte-for-byte; the MCP-side tool reads them. The model never sees them — `src/mcp/schema.ts` strips any `x-ines-*` key from the model-facing schema, so **any new internal-only key must start with that prefix.** The SQL family needs no decoration — it runs in-process and reads `pendingTables` directly through its tool factory's closure.

### What the model is served

The Workspace sends the whole chat with every request; **the model is not given it.** It is served the current turn: the user's last message and what has happened since in this turn (tool results, widget data). Of everything earlier it gets one note (`src/agent/history.ts`): how many earlier messages there are, the user's last eight earlier questions as one short line each, and an instruction to read the earlier messages before answering anything that refers back to them. Anything else of the conversation the model fetches itself with the in-process tool `recall_conversation` (`src/agent/tools/recall-conversation.ts`), which reads the latest earlier messages, searches them by words (ranked so that a word few messages have counts most) or reads them by number, and returns a limited amount each time. The tool exists only when there are earlier messages.

Why: serving the whole chat makes every question cost more than the last (a question at the 300th exchange used 68k tokens, 4 times the 25th's, and the tokens count against the user's daily limit) and ends in a request the model refuses once the chat outgrows its context. Measured on a live model, a question at the 5th, 100th and 300th exchange now uses the same ~19k tokens when it needs an earlier fact (two model calls: look back, answer) and ~9k when it stands on its own (one call). A single message longer than 60,000 characters is cut off and says so.

State that the model no longer sees but the agent still needs is read from the request directly: the tables loaded in earlier turns are still there to query (they are cached for the chat and listed in the system prompt).

### What the chat is shown: reasoning, and the answer

Nothing is streamed to the chat token by token: not thinking, not reasoning, not the answer, not a tool result. The loop reads the model's stream a step at a time and holds each step's text until the step ends, so there is only one thing to decide, and it is decided by the tool calls:

- **A step that calls a tool is reasoning.** Its text is shown as one reasoning status (`copilotStatusUpdate`, group `reasoning`), cleaned like the answer (no placeholder tags, no suggestions block) and left out when it is too short to say anything or repeats the last one. The tool's own status follows it.
- **The answer is the step in which the model calls no more tools.** It is sent to the chat whole, as one `copilotMessageChunk` (however many deltas the model wrote it in), after the artifacts and citations that belong with it.

The web app holds to the same rule whatever an agent sends: a chunk is only held, and the answer is put in the chat as one message when it is complete (at the next status update or function call, or when the stream is done). Stopping a question keeps what was held, as a cancelled message. The system prompt tells the model that text written alongside a tool call is shown as reasoning, so it keeps it to one short line of intent or writes none.

**A model that calls tools by writing them into its text** (an open-weight model behind Ollama, some NIM and OpenRouter models: `<tool_call>{"name": "...", "arguments": {...}}</tool_call>`, `<TOOLCALL>[...]</TOOLCALL>`, `<function=name>{...}</function>`, `[TOOL_CALLS][...]`) is wrapped by a middleware (`src/lib/inline-tool-calls.ts`, applied in `resolveModel`) that turns each marker into a real tool call before the loop sees the stream. The rule above then holds unchanged: the step has a tool call, so its text is reasoning; the marker is never shown. A marker that cannot be read, or names a tool the request does not offer, is dropped from the text, not shown. A model that makes native tool calls is passed through as it is. `INES_INLINE_TOOL_CALLS=off` removes the middleware.

### Citations

Citations come from **two sources**: widgets (whenever widget data is loaded) and MCP tools (any tool that returns a `$ines_kind: "citation"` item). The agent aggregates them into a single `Citation[]` per request and emits one `copilotCitationCollection` SSE event at end-of-turn.

Across multi-step round-trips the in-flight set is serialized into `extra_state.intermediate_citations` and restored on the next re-POST — persistence happens at **every** round-trip emit point, because each POST starts with fresh request-scoped state. Dedup keys (`widget|<uuid>|<sortedArgs>` for widgets, `web|<link>` for web/document) make the aggregation idempotent across reruns. Widget IDs are deterministic — a SHA-1 hash of `(widget.uuid, sortedInputArgs)` — so the same widget with the same args always gets the same citation ID.

One nuance: the Workspace recognizes `source_info.type` of `widget`, `web`, `artifact`, `direct retrieval`, and `findb`. Anything else (including `document`) renders nothing, so document citations from MCP are mapped to `web`.

### Observability (OpenTelemetry)

Off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. With no endpoint the API hands back a no-op tracer, every span is non-recording, and nothing is exported — so call sites never branch on "is telemetry on."

The thing worth understanding is that **a logical turn is N HTTP POSTs, not one.** Every round-trip — `get_widget_data`, `execute_agent_tool`, the 16 bridge commands, the `pending_bridge_calls` drain — ends the generator and the browser re-POSTs. Two keys ride `extra_state` to keep the turn coherent across that hop:

- `traceparent` — the W3C span context of the **first** request in the turn, echoed forward verbatim. Later requests parent to it, so all N land in one trace instead of N disconnected ones. Propagating the root (not the previous request) keeps the tree flat: a 19-call bridge drain produces 19 siblings, not 19 levels of nesting. Later spans legitimately start after their parent ended — read turn wall-clock off the trace, not the root span.
- `turn_usage` — token usage summed across every request in the turn. Per-request counters die with the generator, so without this a turn's cost is unrecoverable. Note that input tokens grow on each re-POST, because `buildMessages` re-renders the conversation every time; the turn total is the sum of a growing series, which is what you actually pay.

Both arrive via the browser, so both are untrusted: `parseTraceparent` and `readTurnUsage` return null/zero on anything malformed rather than throwing. A bad counter must never cost the user their turn.

Model calls are instrumented through the AI SDK's `experimental_telemetry` (the only two call sites are `streamText` in `src/agent/loop.ts` and `generateText` in `src/lib/llm.ts`), which yields per-step spans with tool calls and usage. The `streamText` call is explicitly bound to the turn span via `context.with` — the loop is an AsyncGenerator, and ambient context doesn't reliably survive its yields.

The `Token usage` log line carries `conversationId` and `traceId` alongside both the request and turn totals, so usage stays attributable when many chats interleave in one log stream.

#### Connecting Langfuse

Langfuse ingests OTLP directly, so it needs no code — only env vars. Create a project, then:

```bash
AUTH=$(printf 'pk-lf-...:sk-lf-...' | base64)   # public key : secret key
```

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:3000/api/public/otel
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <AUTH>,x-langfuse-ingestion-version=4
```

Do not quote the header value — everything after the first `=` is the value, spaces and commas included.

Endpoint semantics follow the OTLP spec: `OTEL_EXPORTER_OTLP_ENDPOINT` is a **base** and `/v1/traces` is appended to it, while `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is used verbatim. This matters for Langfuse — on a self-hosted v4 deployment `POST /api/public/otel` returns the app shell (404) and only `/api/public/otel/v1/traces` ingests.

What maps across without extra work: `session.id` on the turn span groups a chat's turns into one Langfuse session, and the AI SDK's `gen_ai.*` attributes make each model call a generation with model and token usage attached. Langfuse also reads `user.id` if you ever want per-user attribution — the Workspace sends the user's id in an `X-User-Id` header (Ines does not use it: a client could put anything in it, so she asks the API whose token it is), but exporting it to a tracing backend is a privacy decision, so nothing emits it today.

Two known gaps: MCP-server spans orphan (the browser calls that server, not the agent — closing it means adding an `x-ines-traceparent` decoration), and browser-side execution time is only visible as the gap between requests. Auto-instrumentation is deliberately absent: `@opentelemetry/instrumentation-*` patches Node's module registry and will not see `Bun.serve` or `fetch`.

### The Workspace's tools: three surfaces

The Workspace can be read and changed in three ways, and they are not the same thing:

| Surface | Consumer | How a call is made | Where it lives |
|---|---|---|---|
| The Workspace's own tools | Ines, and any agent that replaces her, in the web app | `execute_agent_tool` with server id `workspace`: the user's tab runs it, as the signed-in user | The API (`/app/workspace-tools`), the web app (`useWorkspaceToolExecutor`), `src/mcp/factory.ts`, `src/agent/tool-groups.ts` |
| Own function calls (Path A) | Ines, for a request without the Workspace's tools | Native SSE `copilotFunctionCall { function: <command>, input_arguments }` | `src/agent/tools/workspace.ts` + `src/protocol/bridge-commands.ts` |
| Path B | Claude Desktop, other MCP clients | Standard MCP `tools/call` with `_json` string args | `mcp-server/src/tools/workspace/*` (18 wrappers) |

External hosts of the Workspace's own MCP server (`/mcp` of the API) are another thing again: they sign in with the user's personal access token and reach the browser through a bridge session that the user opens. None of that is used by the agent in the web app.

Ines's `body.tools` filter drops the Path-B wrappers whenever it sees a name matching a vendored bridge command, and her own function calls are not registered when the request carries the Workspace's tools, so the model only ever sees one surface per capability. The Path-B wrappers are gated behind `COMPANION_TOOLS_ENABLED` (off by default).

## Running for many users

The agent is built for a deployment shared by many users, and leaves to the Workspace what the Workspace already knows.

- **Sign-in.** Every request to `/v1/*` carries the user's session token, and `GET /app/user` on the Workspace API says whose it is (remembered for `INES_AUTH_CACHE_SECONDS`). The `X-User-Id` header the web app also sends is ignored: a client could put anything in it. If the API cannot be asked, the request fails with 503 rather than going on unchecked. What the API is asked is bounded, since anyone can send any token: a token it turned down is not asked about again for 10 seconds, concurrent requests with one token share one question, and at most 32 questions are under way (some more wait, the rest get 503 with `Retry-After`), so a flood of made-up tokens cannot become a flood to the API.
- **The web tools.** `SEARCH_WEB` (`web_search`) and `FETCH_FROM_WEB` (`fetch_webpage`) are on for everyone, and an administrator can switch either off for an entity or for one user (see "The web tools" below).
- **Roles and limits.** Before any work for a question, Ines calls `POST /app/copilot/authorize` (which models and MCP tools the user's roles grant: a denied model is refused in the chat, a denied tool is left out) and, for the first request of the turn, `PUT /app/usage` (one question against the daily limit; the API answers 422 with its own wording when it is used up). After the request she adds the tokens it used. Both calls carry `INES_METERING_TOKEN` besides the user's own token, so users cannot write their own usage. A turn that needs a tool in the browser is several requests; only the first is counted, and a request that claims to continue a turn Ines does not know of is counted again.
- **One user's chats are theirs.** Everything kept for a chat (widget rows, documents, fetched pages) is filed under `<user>:<chat>`. The browser makes the calls to the MCP tools, so it could name any chat; Ines signs each scope with `INES_SCOPE_SECRET` and the tools that keep state (`query_documents`, `list_documents`) refuse a call without a valid signature.
- **What a client can make the agent fetch.** Files, pasted links and pages a model asks for are fetched only from public addresses (`src/lib/safe-fetch.ts`): the host is resolved once, every address it resolves to is checked, and the connection goes to the address that was checked (so a host cannot answer one address to the check and another to the connection), redirects are checked again, internal names and private, loopback and link-local addresses are refused, and a response is cut off at 25 MB. The one exception is the Workspace's own links to its files, fetched from `WORKSPACE_API_URL`.
- **Limits.** `INES_MAX_CONCURRENT_QUERIES` per user (a user over it gets 429), `INES_MAX_TOTAL_QUERIES` for the whole agent (503), `INES_MAX_TURN_REQUESTS` per question, `INES_HELPER_CALLS_PER_MINUTE` per user for the helpers (titles, prompt rewriting, dictation; 429, and counted before the body is read), `INES_INVALID_REQUESTS_PER_MINUTE` per user for requests that are not questions (past it their questions are turned away unread), `INES_MAX_BODY_MB` per request (8 MB for the helpers that take JSON), field limits on what a request may hold (messages, widgets, documents), and only the models on offer (`DEFAULT_MODEL`, `INES_MODELS`). A query's place is taken before its body is read (a body can be tens of megabytes, and refused requests must cost nothing), and a query whose client has gone is stopped, and its place and its model call with it.
- **More than one replica.** A turn is several requests, and what the agent remembers between them decides what the next one may do. All of it — who a token belongs to, how much of a user's share is left, which turn is under way and a chat's rows — lives behind one store (`src/lib/store.ts`). With `REDIS_URL` set it is shared, so a user has one share of their quota across every replica, a continuation is recognised wherever it lands, and rows another replica fetched are found instead of fetched again; `GET /status` says `sharedState: true`. Without it the store keeps everything in this process, as it always did, and a deployment should run one replica (or send a chat's requests to the same one). Redis is never in the way of serving: an operation it cannot answer falls back to this process, so a Redis outage makes the quotas per-replica for a while rather than stopping the agent — `ines_store_errors_total` counts those. Every cache is bounded (entries, size and age) and filed under the user's scope; a table too large to be worth sending (1 MB as JSON) stays in the process that fetched it, and another replica fetches it again.

### Hardening

What strangers can send the agent (files, pages, a user's own questions) and what a model can be talked into by text in them:

- **Work on a stranger's bytes runs in a child process** with an empty environment, a time limit and a memory limit, and is killed when it overruns (`src/lib/isolate.ts`): the SQL tools (`INES_SQL_TIMEOUT_MS`, default 10 s), spreadsheets (read after their ZIP directory was checked for bombs, `src/lib/zip-guard.ts`), PDFs, Word files and pages (in the MCP server). `INES_ISOLATED_CONCURRENCY` (default 4) bounds how many run at once; past it a call is refused instead of queued without end. A worker thread would not do: a thread inside SQLite cannot be stopped.
- **What is read is bounded before it is paid for**: sizes of files, rows, chunks and pages, and the chunks one user may have embedded in an hour (`INES_INGEST_CHUNKS_PER_HOUR`, default 20,000), all checked before a model or an embedding is called.
- **Text a model reads is data.** The system prompt says so, and the tools are held to it: `fetch_webpage` fetches only an address the agent signed (`x-ines-url-sig`), and the agent signs only an address that was in what the model was given: the user's messages and attachments, and what a search, a page, a widget or a document returned. Not what the model wrote itself, and not the results of the SQL tools or of `recall_conversation`, which repeat any string they are told to. The match is exact, so an address with the user's data added is refused (`src/agent/known-urls.ts`, `mcp-server/src/lib/url-check.ts`). `INES_FETCH_ANY_URL=true` turns this off. A model's answer cannot show an image from outside: `![alt](address)` becomes a link the user may follow (`neutralizeImages` in `src/protocol/events.ts`), since the chat window loads an image by itself and its address could carry the user's data. The web app holds to the same rule on its side, whatever an agent sends: the chat renders no image of any kind (alt text only), no raw HTML, no script and no style from message text, and an HTML artifact (a table, a chart) is shown in an iframe whose own content security policy lets the browser load nothing by address (`frontend/src/components/AI/artifactPolicy.ts`: images and fonts only as `data:`, inline styles, no scripts but the app's own); the preview of a link the user clicks is loaded only when they ask for it, and in a sandbox.
- **The process stays up and says why it did not**: unhandled errors are logged and counted (`ines_unhandled_errors_total`), `SIGTERM` stops taking requests and lets the running ones end (`INES_SHUTDOWN_GRACE_SECONDS`, default 25), and `LIVE_DEBUG_TRACES` is ignored in production unless `INES_ALLOW_DEBUG_TRACES=true`.
- **The containers** (`docker-compose.yml`) have a read-only root, no capabilities, no new privileges, a memory limit (`INES_MEM_LIMIT`, default 4g) and a limit on processes.

### The web tools

Searching the web and reading a page from it are two capabilities, **SEARCH_WEB** and **FETCH_FROM_WEB**, that an administrator can switch off for a user. They are flags of the entitlement (`search_web`, `fetch_from_web`), which starts with the tier's defaults (on), is copied to each entity and from the entity to each user, and can be changed at each step:

- **For an entity**, by the operator (admin panel: Entity → entitlements, or `PATCH /entity/entitlement/{entity}`). The change reaches the users who still have the entity's setting, and not those whose own was set (unless "update all users" is chosen).
- **For one user**, by an administrator (admin panel: User → Entitlements; the organization's own admin: the user's profile, "Copilot web access"; or `PATCH /admin/entitlement/{user}`). This is the override, and a user cannot change it themselves.

A flag that is off wins over what roles grant, and goes by the tool's name, so the same tool on another MCP server is as switched off. It is enforced in three places: the API's `POST /app/copilot/authorize` names the tools as denied and says which capabilities are off (`disabled_capabilities`), so Ines leaves them out and tells the model ("WEB ACCESS: your administrator has switched off …"); the API's MCP proxy refuses a call of the tool; and the web app does not offer the tool. With **FETCH_FROM_WEB** off, Ines does not fetch the addresses in the user's message either (the eager prefetch is the same capability). An administrator never has to list the web tools in a role: the switches work for users whose roles grant nothing too.

A page is read in parts, never put in front of the model whole (a few hundred KB of markup, mostly not written to be read), and a markdown copy of it would throw away what the work may need (links, tables, the data a page carries for its scripts, the markup). `fetch_webpage` keeps the page as fetched, under an id that is the same for the same address, in a store of the MCP server filed under the chat's scope key (`mcp-server/src/lib/page-store.ts`: six pages and 12 million characters to a chat, 80 million for all chats, 30 minutes, in memory like the document store; a page that is gone is fetched again), and `inspect_webpage` reads parts of it. Every view returns a bounded amount (`text` and `raw` at most 12,000 characters, the others a few dozen items), and the DOM work (parsing, selectors, tables, JSON) runs in a child process with a deadline (`src/lib/page-view.ts`, `html-child.ts`), so a page built to be deep, wide or slow cannot stop the server. `find` takes a literal, not a pattern. A result is only the page's own words and numbers: it never repeats the selector, phrase or path it was asked for, so a model cannot get its own text back as something that came from a page (the addresses in `links` and the other views count as given for `fetch_webpage`, see Hardening). The eager prefetch of the addresses in a user's message gives the model the same overview of each page (no `page_id`: the agent holds nothing for the tool server), and a model that needs more calls `fetch_webpage` and `inspect_webpage`.

### Logs, metrics and health

- **Logs** (`src/lib/logging.ts`, `src/lib/redact.ts`): JSON lines on stdout, at `LOG_LEVEL`. Every record is redacted before it is written — session tokens, API keys, JWTs, signed file URLs, file bytes, the messages of a conversation, email addresses — and a provider's error is logged with its status and body but not the request that caused it. Records made while a question is answered carry `requestId`, `user`, `conversationId` and `model`. The `audit` category (always at info) has one record per question (outcome, tokens, duration) and per refusal.
- **Metrics** (`src/lib/metrics.ts`): Prometheus text on `INES_METRICS_PORT` (the MCP server's on `MCP_METRICS_PORT`). `ines_http_requests_total`, `ines_http_request_duration_seconds`, `ines_queries_total{outcome}`, `ines_query_duration_seconds`, `ines_active_queries`, `ines_model_tokens_total{direction}`, `ines_model_errors_total{provider}`, `ines_model_calls_total{provider}`, `ines_workspace_api_requests_total{endpoint,outcome}`, `ines_auth_cache_total`, `ines_mcp_tool_calls_total{tool,outcome}` and `ines_mcp_tool_duration_seconds`. Nothing is labelled by user, chat or model-generated text, and a metric keeps at most 500 label sets.
- **Traces:** OpenTelemetry, as described next.
- **Health:** `/status` (liveness) and `/ready` (the Workspace API answers).

## Extending Ines

Decide by where the work needs to run:

1. **Stateless / heavy / cold-start** (web search, fetch, a renderer): **write a new MCP tool** in `mcp-server/src/tools/`. Export `<name>Schema` / `<name>Description` / `<name>Handler`, register it in `mcp-server/src/server.ts`, and use the `typed.ts` helpers for artifacts/citations/tables. The agent picks it up automatically — no agent code changes.
2. **State-bound** (operates on `pendingTables`, `artifactQueue`, or other request-scoped agent state): **add an agent tool** under `src/agent/tools/` with an `execute` that closes over the context, following the `make<Name>Tool(ctx)` factory pattern.
3. **A new workspace bridge op:** extend `src/protocol/bridge-commands.ts` (Zod schema + description + the name in `WORKSPACE_BRIDGE_COMMANDS`). The factory and loop dispatch pick it up generically.

Every tool input is a Zod schema, validated with `.parse()` — never a cast. Use `.describe()` on every field; that description is what the LLM sees. After adding or removing a tool, update the tool tables in this README. 

## Testing

Three tiers. The first two run on every PR with a mocked LLM and are fully deterministic; the third scores real model behavior nightly.

| Tier | What | When | LLM |
|---|---|---|---|
| 1 — Unit | Pure functions, MCP tool handlers, parsers, schema converters | Every PR | none |
| 2 — Integration | Drives `src/agent/loop.ts` and real routes/handlers; only the LLM is mocked (`MockLanguageModelV2`) | Every PR | mocked |
| 3 — Evals | Drives the real agent loop against a live LLM, scored by deterministic graders + LLM-as-judge | Nightly + pre-release | real |

```bash
bun run test        # Tiers 1 + 2 — gates every PR
bun run typecheck   # bunx tsc --noEmit — zero errors required
bun run evals       # Tier 3 — nightly + manual
```

The guiding rule is **test the result, not the reasoning.** Modern models reach the same outcome by different paths, so we assert on outputs — function returns, mutated context, the SSE events the Workspace receives, the terminal citation collection — never on which tool fired first or in what order. Behavioral questions ("does the model pick the right widget?") live in `evals/` with pass-rate thresholds across N trials; `tests/` pins contracts that hold regardless of which model runs. The mock LLM is a fixture to drive the loop into an observable state, never the system under test.

## Configuration

### Environment variables

**Agent (`src/`):**

```
OPENAI_API_KEY        # OpenAI models
OPENROUTER_API_KEY    # OpenRouter (Claude, Gemini, DeepSeek, etc.)
GROQ_API_KEY          # Groq models
NVIDIA_API_KEY        # NVIDIA NIM models
OLLAMA_BASE_URL       # Ollama endpoint (default http://localhost:11434/api)
DEFAULT_MODEL         # Required, no default: "<provider>:<model>". Used for every model call, unless
                      # the Workspace picker names another
PORT                  # Agent port (default 7777)

# Who may use the agent (see "Running for many users")
INES_AUTH                    # workspace (default) or none
WORKSPACE_API_URL            # Required with workspace auth: the Workspace API as the agent reaches it
WORKSPACE_ORIGIN             # Required with workspace auth or WORKSPACE_PUBLIC_URL: the Origin of every call to that
                             # API (the agent's, and the MCP server's file fetches), the web app's origin; the API
                             # refuses an origin that is not in its BACKEND_CORS_ORIGINS
WORKSPACE_PUBLIC_URL         # The API as the browser addresses it; links to the Workspace's files on it are fetched from WORKSPACE_API_URL
INES_METERING_TOKEN          # Required with workspace auth: python -m scripts.create_metering_token
INES_SCOPE_SECRET            # Required with workspace auth (16+ characters); shared with the MCP server
INES_CORS_ORIGINS            # Required with workspace auth: the web app's origin(s), or *
INES_MODELS                  # More models users may pick, comma-separated <provider>:<model>
INES_TRANSCRIBE_MODEL        # Dictation in the chat, no default: <provider>:<model> (groq, openai or nvidia), plus that
                             # provider's key; nvidia models are named as on build.nvidia.com (nvidia:openai/whisper-large-v3).
                             # Unset: no dictation, and /agents.json does not offer "speech-to-text"
INES_AUTH_CACHE_SECONDS      # How long a signed-in user is remembered (default 30)
REDIS_URL                    # Shares what the agent keeps between the requests of a turn with the other
                             # replicas (sign-ins, quotas, turns, a chat's rows). Unset: kept in this
                             # process, so run one replica. See "Running for many users"
INES_INLINE_TOOL_CALLS       # "off" does not read tool calls that a model writes into its text (see What the chat is shown); on by default
INES_MAX_CONCURRENT_QUERIES  # Queries one user may run at once (default 4)
INES_MAX_TOTAL_QUERIES       # Queries the whole agent runs at once; past it a query is refused with 503 (default 200)
INES_MAX_TURN_REQUESTS       # Requests one question may be made of, counting every return from a tool (default 60)
INES_HELPER_CALLS_PER_MINUTE # Helper calls (titles, rewritten prompts, dictation) one user may make in a minute; past it 429 (default 60)
INES_INVALID_REQUESTS_PER_MINUTE # Requests that are not questions (not JSON, wrong shape) one user may send in a minute (default 20)
INES_MAX_BODY_MB             # Largest request (default 64)
INES_SQL_TIMEOUT_MS          # How long one SQL tool call may run (default 10000)
INES_ISOLATED_CONCURRENCY    # Child processes the agent runs at once for SQL and files (default 4)
INES_SHUTDOWN_GRACE_SECONDS  # How long running queries have to end after SIGTERM (default 25)
INES_ALLOW_DEBUG_TRACES      # "true" lets LIVE_DEBUG_TRACES work in production (it logs whole conversations)

LOG_LEVEL                    # trace | debug | info | warning | error | fatal (info in production, debug otherwise)
LOG_FORMAT                   # json | pretty (json in production, pretty otherwise)
INES_METRICS_PORT            # Prometheus metrics (default 9464; 0 turns them off)

OTEL_EXPORTER_OTLP_ENDPOINT         # Enables tracing. Base URL — /v1/traces is appended per the OTLP
                                    # spec. Unset = telemetry entirely off (no spans, no cost)
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT  # Optional — exact traces URL, used verbatim, wins over the above
OTEL_SERVICE_NAME                   # Optional — service.name on exported spans (default ines)
OTEL_SERVICE_VERSION                # Optional — service.version on exported spans. Baked into the
                                    # published image as the commit sha (Dockerfile GIT_SHA build arg);
                                    # defaults to "dev" for local builds. This is what attributes a
                                    # latency or cost regression to a specific deploy.
OTEL_TRACES_CONSOLE                 # "true" prints spans to stdout — dev only, no collector needed
OTEL_RECORD_PROMPTS                 # "true" puts prompts, widget rows and SQL results into span
                                    # attributes. Off by default: that is customer data leaving the
                                    # process. Only enable against a self-hosted collector.
```

**Companion MCP server (`mcp-server/`):**

```
INES_SCOPE_SECRET       # Shared with the agent. When set, the tools that keep state for a chat act only on a scope she signed
MCP_METRICS_PORT        # Prometheus metrics (default 9465; 0 turns them off)
LOG_LEVEL, LOG_FORMAT   # As for the agent
COMPANION_TOOLS_ENABLED # "true" registers the 18 Path-B workspace bridge tools + prompts + app-builder resources (default false)
INES_FETCH_ANY_URL      # "true" lets fetch_webpage fetch any address; by default only one the agent signed (see Hardening)
INES_INGEST_CHUNKS_PER_HOUR  # Chunks one user may have embedded in an hour (default 20000)
REDIS_URL               # Optional — persists the document-RAG store across restarts (in-memory if unset)
INES_EMBED_MODEL        # Required for query_documents / list_documents, no default: <provider>:<model> (openai, openrouter, nvidia or ollama), plus that provider's key
MCP_PUBLIC_BASE_URL     # Optional — public base URL advertised to the bridge
MCP_BRIDGE_COMMAND_TIMEOUT_MS  # Optional — Path B bridge command timeout (ms)
MCP_PORT                # MCP server port (default 8787)
```

### Endpoints

**Agent:**
- `GET /agents.json` — agent descriptor (name, features, the models on offer, the skills that come with Ines); public
- `GET /status` — the process is up (the container's health check); public
- `GET /ready` — 200 when the Workspace API answers, 503 when it does not; public
- `POST /v1/query` — main query endpoint (SSE); needs a signed-in user
- `POST /v1/generate/*`, `POST /v1/enhance_prompt` — single-shot helpers (chat title, dashboard title, prompt enhancement, widget info, code); need a signed-in user. Their tokens are not metered.
- `POST /v1/transcribe` — dictation: a 16-bit PCM WAV recording (form field `audio`, up to 4 MB, about two minutes at 16 kHz) answered with `{ "text": … }`, from `INES_TRANSCRIBE_MODEL`; needs a signed-in user and counts as a helper call. Groq and OpenAI models are called through the AI SDK; NVIDIA's hosted speech models through Riva's `Recognize` over gRPC (`grpc.nvcf.nvidia.com`), with the model's function id looked up by name from the functions `NVIDIA_API_KEY` can see. Without the variable it answers 404, and `/agents.json` does not offer `"speech-to-text"`, so the web app shows no microphone.
- `GET /metrics` — on the metrics port (`INES_METRICS_PORT`, 9464), not on the agent's

**MCP server:**
- `GET /` — server descriptor
- `POST /mcp` — Streamable HTTP MCP transport. Stateless: each request is answered by a server of its own, there is no session and no stream to the client (`GET` and `DELETE` answer 405)
- `GET /metrics` — on `MCP_METRICS_PORT` (9465)

## FAQ

**The Workspace keeps using a different model than my `DEFAULT_MODEL`. Why?**
The model is resolved as **Workspace settings-wheel picker → `DEFAULT_MODEL`** (there is no built-in model; without `DEFAULT_MODEL` and a picked model the chat shows an error). If you've picked a model in the chat's settings (the wheel icon), the Workspace sends it per request as `workspace_options.model`, and that **overrides** your `DEFAULT_MODEL` env. `DEFAULT_MODEL` only applies when no model is picked. The agent logs the source on every request — look for `model=… (via workspace_options.model | env.DEFAULT_MODEL | hardcoded-default)`.

**I changed the model in settings but the Workspace still sends the old one.**
The picked model is bound to the chat. Change it in the settings wheel, then **start a new chat** — existing chats keep the model they were created with. The Workspace also caches its agent config, so if it stays stuck, hard-refresh the browser tab.

**I edited `DEFAULT_MODEL` in `.env` but nothing changed.**
`bun run dev:agent` runs with `--hot`, which reloads **code, not environment variables**. Restart the server after editing `.env`. (And remember the Workspace picker still wins over `DEFAULT_MODEL` — see above.)

**Ollama works locally but not from the Docker container (connection refused).**
Inside a container, `localhost` is the container itself, not your host machine. Point `OLLAMA_BASE_URL` at `http://host.docker.internal:11434/api` instead of `http://localhost:11434/api`.

**Ollama errors immediately — a `Model error` in chat / a 404 on `/api/chat`.**
The tag after `ollama:` in `DEFAULT_MODEL` must be a model you've **actually pulled**, matching exactly. If it isn't, Ollama 404s the chat request and the agent surfaces a `Model error`. Check what's installed with `ollama list` and pull the one you want (`ollama pull <model>`).

**Do I need the MCP server?**
The repository's compose stack runs it, and the tools in it are how the agent searches the web and your documents. The agent itself is standalone — widget search, data, SQL, dashboards, and skills all work with `bun run dev:agent` alone. The MCP server adds web search, fetch, diagrams, and document search.

**Ines will not start and lists what is missing.**
With the default `INES_AUTH=workspace` she needs `WORKSPACE_API_URL`, `WORKSPACE_ORIGIN`, `INES_METERING_TOKEN`, `INES_SCOPE_SECRET` and `INES_CORS_ORIGINS`, and she stops at start if any is missing instead of running without users. In the compose stack `create_local_env` and `docker-compose.yml` set them. On a development machine with no Workspace API, set `INES_AUTH=none`.

**A user is told a limit is reached, or that their role does not allow a model.**
Both come from the Workspace, not from Ines: the daily limits are the entitlement an admin sets, and the models and tools are what the user's roles grant (admin panel, a role's Copilot access), less what is switched off for the user (the web tools, see "The web tools"). Ines only enforces them, and says so in the chat in the API's own words.

**Which embedding model does document RAG use?**
Document RAG (`query_documents` / `list_documents`) lives on the companion MCP server and embeds your uploaded docs with the model you name in `INES_EMBED_MODEL` to build the per-conversation vector store. Embeddings are a separate model call from chat, so the variable names its own model, written `<provider>:<model>` like `DEFAULT_MODEL`, and needs that provider's key. The providers that embed are `openai`, `openrouter`, `nvidia` and `ollama` (Groq has no embeddings API). It does not have to be the provider of your chat model. Without a valid `INES_EMBED_MODEL` and its key those two tools are simply **not registered**, and the server logs why; everything else (the core agent plus the rest of the MCP server) keeps working. NVIDIA models are called as the retrieval models they are, with the stored text as `passage` and the question as `query`.

**"No AI providers configured" on startup.**
Set at least one of `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, or `NVIDIA_API_KEY`, or point `OLLAMA_BASE_URL` at a running Ollama.

## License

Apache-2.0, like the rest of the repository: see the [LICENSE](../LICENSE) at its root.
