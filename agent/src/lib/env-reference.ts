export const AUTH_MODES = ["workspace", "none"] as const;
export const LOG_LEVELS = ["trace", "debug", "info", "warning", "error", "fatal"] as const;
export const LOG_FORMATS = ["json", "pretty"] as const;
const INLINE_TOOL_CALL_MODES = ["on", "off"] as const;
const DEBUG_TRACE_LEVELS = ["0", "1", "2"] as const;

type EnvType = "string" | "secret" | "url" | "origin" | "integer" | "boolean" | "list" | "model" | "model-list" | "enum";
type EnvProcess = "agent" | "mcp-server";

interface EnvVariable {
  name: string;
  group: string;
  readBy: readonly EnvProcess[];
  type: EnvType;
  default: string | null;
  required: string | null;
  choices: readonly string[] | null;
  providers: readonly string[] | null;
  description: string;
}

const BOTH: readonly EnvProcess[] = ["agent", "mcp-server"];
const AGENT: readonly EnvProcess[] = ["agent"];
const MCP: readonly EnvProcess[] = ["mcp-server"];

type Entry = Omit<EnvVariable, "group" | "default" | "required" | "choices" | "providers"> &
  Partial<Pick<EnvVariable, "default" | "required" | "choices" | "providers">>;

function group(name: string, entries: Entry[]): EnvVariable[] {
  return entries.map((entry) => ({
    group: name,
    default: null,
    required: null,
    choices: null,
    providers: null,
    ...entry,
  }));
}

export const ENV_REFERENCE: readonly EnvVariable[] = [
  ...group("Models and providers", [
    {
      name: "DEFAULT_MODEL",
      readBy: AGENT,
      type: "model",
      required: "always",
      providers: ["openai", "openrouter", "groq", "nvidia", "ollama"],
      description:
        "The model that every call of the agent uses unless the user picks another of the offered models in the Workspace: chat, titles, prompt enhancement and table extraction. It is written <provider>:<model>, where <model> is the name that the provider gives it. No model is built into the agent, so a request that names none fails while this is unset. Changing it needs a restart.",
    },
    {
      name: "INES_MODELS",
      readBy: AGENT,
      type: "model-list",
      providers: ["openai", "openrouter", "groq", "nvidia", "ollama"],
      description:
        "More models that users may choose, comma-separated and written like DEFAULT_MODEL. The agent offers DEFAULT_MODEL and these models and refuses any other, so a user cannot spend the provider keys on a model that the operator did not choose. The roles in the Workspace (Admin, Roles) choose among them.",
    },
    {
      name: "OPENAI_API_KEY",
      readBy: BOTH,
      type: "secret",
      description:
        "API key of OpenAI. With it, models written openai:<model> work, and so do OpenAI transcription models (agent) and embedding models (MCP server). Without a key, the models of that provider are not available.",
    },
    {
      name: "OPENROUTER_API_KEY",
      readBy: BOTH,
      type: "secret",
      description:
        "API key of OpenRouter, which offers Claude, Gemini, DeepSeek and many other models. With it, models written openrouter:<model> work, and so do OpenRouter embedding models (MCP server).",
    },
    {
      name: "GROQ_API_KEY",
      readBy: AGENT,
      type: "secret",
      description: "API key of Groq. With it, models written groq:<model> work, and so do Groq transcription models.",
    },
    {
      name: "NVIDIA_API_KEY",
      readBy: BOTH,
      type: "secret",
      description:
        "API key of NVIDIA NIM at integrate.api.nvidia.com. With it, models written nvidia:<model> work, and so do NVIDIA speech models (agent) and embedding models (MCP server).",
    },
    {
      name: "OLLAMA_BASE_URL",
      readBy: BOTH,
      type: "url",
      default: "http://localhost:11434/api",
      description:
        "Address of the Ollama API, for models written ollama:<model> (agent) and Ollama embedding models (MCP server). In Docker, use host.docker.internal instead of localhost: inside a container, localhost is the container itself and cannot reach an Ollama on the host.",
    },
    {
      name: "INES_TRANSCRIBE_MODEL",
      readBy: AGENT,
      type: "model",
      providers: ["groq", "openai", "nvidia"],
      description:
        "The model that turns a dictated recording into the text of a question, written <provider>:<model>, for example groq:whisper-large-v3-turbo, openai:gpt-4o-mini-transcribe or nvidia:openai/whisper-large-v3. The provider needs its API key. Unset, the chat has no microphone.",
    },
    {
      name: "INES_EMBED_MODEL",
      readBy: MCP,
      type: "model",
      providers: ["openai", "openrouter", "nvidia", "ollama"],
      description:
        "The embedding model of document search, written <provider>:<model>. The provider needs its API key or, for Ollama, its address. There is no default: unset, the tools query_documents and list_documents are turned off.",
    },
    {
      name: "INES_INLINE_TOOL_CALLS",
      readBy: AGENT,
      type: "enum",
      default: "on",
      choices: INLINE_TOOL_CALL_MODES,
      description:
        "A model without native tool calling writes its calls into its text, as <tool_call>{...}</tool_call>, <function=...> or [TOOL_CALLS]. With on, the agent reads them as tool calls. Only the value off turns this off; any other value leaves it on.",
    },
  ]),
  ...group("Who can use the agent", [
    {
      name: "INES_AUTH",
      readBy: BOTH,
      type: "enum",
      default: "workspace",
      choices: AUTH_MODES,
      description:
        "How callers are admitted. With workspace, every caller signs in with the Workspace API, which owns the users, their roles and their usage limits. With none, the agent runs without users and counts nothing, which is for a development machine only.",
    },
    {
      name: "WORKSPACE_API_URL",
      readBy: BOTH,
      type: "url",
      required: "with INES_AUTH=workspace",
      description:
        "Address of the Workspace API as the agent and the MCP server reach it, which is not necessarily the address that a browser uses; inside a deployment, it is the address of the API service. Signed file links of the Workspace are fetched through it.",
    },
    {
      name: "WORKSPACE_ORIGIN",
      readBy: BOTH,
      type: "origin",
      required: "with INES_AUTH=workspace or WORKSPACE_PUBLIC_URL",
      description:
        "The origin of the web app, without a path, for example https://workspace.example.com. Every call to the Workspace API carries it as its Origin, and the API refuses the calls of an origin that it does not allow, so it must be one of the API's BACKEND_CORS_ORIGINS.",
    },
    {
      name: "WORKSPACE_PUBLIC_URL",
      readBy: BOTH,
      type: "url",
      description:
        "The address at which browsers reach the Workspace API, without a path, as it appears in the links to uploaded files (/app/files/...). The agent and the MCP server rewrite such a link to WORKSPACE_API_URL and fetch it with WORKSPACE_ORIGIN as its Origin, so that an API on a private network can serve files to them. Unset, those links are fetched like any other address and are refused when it is internal.",
    },
    {
      name: "INES_CORS_ORIGINS",
      readBy: AGENT,
      type: "list",
      required: "with INES_AUTH=workspace",
      description:
        "The origins of the web app that may call the agent from a browser, comma-separated, each like https://workspace.example.com. An * allows every origin.",
    },
    {
      name: "INES_METERING_TOKEN",
      readBy: AGENT,
      type: "secret",
      required: "with INES_AUTH=workspace",
      description:
        "The token with which the agent reports usage to the Workspace API; `python -m scripts.create_metering_token` in backend-api/backend mints it. It runs out after a year, and the API refuses one that never runs out. Until a new one is set, usage is not counted and the API answers 403.",
    },
    {
      name: "INES_SCOPE_SECRET",
      readBy: BOTH,
      type: "secret",
      required: "with INES_AUTH=workspace",
      description:
        "At least 16 characters. The secret with which the agent signs the chat scope that the MCP tools receive, and the addresses that the model may fetch. The agent and the MCP server must have the same value; it keeps one user's chat from another's.",
    },
    {
      name: "INES_AUTH_CACHE_SECONDS",
      readBy: AGENT,
      type: "integer",
      default: "30",
      description: "How long, in seconds, a signed-in user is remembered before the Workspace API is asked about them again. The least is 0.",
    },
    {
      name: "INES_FETCH_ANY_URL",
      readBy: MCP,
      type: "boolean",
      default: "false",
      description:
        "The tool fetch_webpage fetches only an address that was in the conversation, given by the user or listed by a search, a page or a widget, so that text in a page cannot make the agent fetch an address with the user's data in it. With true, it fetches any address.",
    },
  ]),
  ...group("Limits", [
    {
      name: "INES_MAX_BODY_MB",
      readBy: AGENT,
      type: "integer",
      default: "64",
      description: "The largest request that the agent accepts, in megabytes. The least is 1.",
    },
    {
      name: "INES_MAX_CONCURRENT_QUERIES",
      readBy: AGENT,
      type: "integer",
      default: "4",
      description: "How many questions one user may have running at once. The least is 1.",
    },
    {
      name: "INES_MAX_TOTAL_QUERIES",
      readBy: AGENT,
      type: "integer",
      default: "200",
      description: "How many questions the whole agent runs at once. Past it, the agent answers 503. The least is 1.",
    },
    {
      name: "INES_MAX_TURN_REQUESTS",
      readBy: AGENT,
      type: "integer",
      default: "60",
      description: "How many requests one question may be made of: a turn is several requests, one for each tool that the browser runs. The least is 1.",
    },
    {
      name: "INES_HELPER_CALLS_PER_MINUTE",
      readBy: AGENT,
      type: "integer",
      default: "60",
      description: "How many helper calls, such as titles and rewritten prompts, one user may make in a minute. The least is 1.",
    },
    {
      name: "INES_INVALID_REQUESTS_PER_MINUTE",
      readBy: AGENT,
      type: "integer",
      default: "20",
      description:
        "How many requests that are not questions (not JSON, or of the wrong shape) one user may send in a minute. Past it, their questions are turned away unread. The least is 1.",
    },
    {
      name: "LLM_STREAM_TIMEOUT_MS",
      readBy: AGENT,
      type: "integer",
      default: "240000",
      description: "How long, in milliseconds, a model call may take before the agent stops it. A value that is not a number, or is 0, leaves the default.",
    },
    {
      name: "INES_SQL_TIMEOUT_MS",
      readBy: AGENT,
      type: "integer",
      default: "10000",
      description:
        "How long, in milliseconds, one SQL query on the data of a chat may run before the agent stops it. A value below 100 leaves the default.",
    },
    {
      name: "INES_ISOLATED_CONCURRENCY",
      readBy: BOTH,
      type: "integer",
      default: "4",
      description:
        "How many child processes may run at once for work on a stranger's bytes: SQL, spreadsheets, PDF and Word text, and web pages. A value that is not a number, or is 0, leaves the default; a smaller number than 1 counts as 1.",
    },
    {
      name: "INES_INGEST_CHUNKS_PER_HOUR",
      readBy: MCP,
      type: "integer",
      default: "20000",
      description: "How many chunks of documents one chat may add to document search in an hour. A value that is not a positive number leaves the default.",
    },
    {
      name: "INES_SHUTDOWN_GRACE_SECONDS",
      readBy: AGENT,
      type: "integer",
      default: "25",
      description: "How long, in seconds, the agent waits for the questions in progress to finish after it is told to stop, before it exits.",
    },
  ]),
  ...group("Processes and storage", [
    {
      name: "PORT",
      readBy: AGENT,
      type: "integer",
      default: "7777",
      description: "The port on which the agent listens.",
    },
    {
      name: "MCP_PORT",
      readBy: MCP,
      type: "integer",
      default: "8787",
      description: "The port on which the MCP server listens.",
    },
    {
      name: "MCP_PUBLIC_BASE_URL",
      readBy: MCP,
      type: "url",
      default: "http://127.0.0.1:<MCP_PORT>",
      description: "The address at which browsers reach the MCP server, which it gives to the Workspace tabs that connect to its bridge.",
    },
    {
      name: "MCP_BRIDGE_COMMAND_TIMEOUT_MS",
      readBy: MCP,
      type: "integer",
      default: "15000",
      description: "How long, in milliseconds, the MCP server waits for a Workspace tab to answer a bridge command.",
    },
    {
      name: "COMPANION_TOOLS_ENABLED",
      readBy: MCP,
      type: "boolean",
      default: "false",
      description:
        "With true, the MCP server offers the tools, prompts and app-builder resources that drive a Workspace browser tab through its bridge at /bridge/ws. Any other value leaves them off.",
    },
    {
      name: "REDIS_URL",
      readBy: BOTH,
      type: "url",
      description:
        "A Redis or Valkey address, for example redis://valkey:6379. What the agent keeps between the requests of one turn (who is signed in, how much of a user's share is left, which turn is under way, a chat's rows), and what the MCP server keeps for the documents of a chat, lives there when this is set and in the process when it is not. Shared, every replica gives the same answer; without it, run one replica, and a chat's tables are not kept.",
    },
  ]),
  ...group("Logs, metrics and traces", [
    {
      name: "NODE_ENV",
      readBy: BOTH,
      type: "string",
      description:
        "With production, logs default to level info in JSON, and LIVE_DEBUG_TRACES is ignored unless INES_ALLOW_DEBUG_TRACES is true. Any other value, or none, selects the defaults of development: level debug and the pretty format.",
    },
    {
      name: "LOG_LEVEL",
      readBy: BOTH,
      type: "enum",
      default: "info in production, otherwise debug",
      choices: LOG_LEVELS,
      description: "The least severe level that is logged, whatever the case; the value warn is accepted as warning. Logs go to stdout, cleaned of secrets, session tokens, file bytes, signed file URLs and email addresses.",
    },
    {
      name: "LOG_FORMAT",
      readBy: BOTH,
      type: "enum",
      default: "json in production, otherwise pretty",
      choices: LOG_FORMATS,
      description: "The format of the logs, whatever the case: one JSON object per line, or text for a person to read.",
    },
    {
      name: "INES_METRICS_PORT",
      readBy: AGENT,
      type: "integer",
      default: "9464",
      description: "The port on which the agent serves its Prometheus metrics at /metrics. The port is not published by the deployment. The value 0 turns the metrics off.",
    },
    {
      name: "MCP_METRICS_PORT",
      readBy: MCP,
      type: "integer",
      default: "9465",
      description: "The port on which the MCP server serves its Prometheus metrics at /metrics. The value 0 turns the metrics off.",
    },
    {
      name: "OTEL_EXPORTER_OTLP_ENDPOINT",
      readBy: AGENT,
      type: "url",
      description: "The base address of an OpenTelemetry collector. With it, the agent exports its traces to <address>/v1/traces. Without it, and without the other trace settings, tracing is off.",
    },
    {
      name: "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
      readBy: AGENT,
      type: "url",
      description: "The full address that traces are exported to. It takes the place of OTEL_EXPORTER_OTLP_ENDPOINT for traces.",
    },
    {
      name: "OTEL_TRACES_CONSOLE",
      readBy: AGENT,
      type: "boolean",
      default: "false",
      description: "With true, the agent prints its spans to the console. Any other value leaves this off.",
    },
    {
      name: "OTEL_RECORD_PROMPTS",
      readBy: AGENT,
      type: "boolean",
      default: "false",
      description: "With true, the traces of the agent contain the prompts and answers of the model. Any other value leaves them out.",
    },
    {
      name: "OTEL_SERVICE_NAME",
      readBy: AGENT,
      type: "string",
      default: "ines",
      description: "The name under which the agent's traces are exported.",
    },
    {
      name: "OTEL_SERVICE_VERSION",
      readBy: BOTH,
      type: "string",
      default: "dev",
      description: "The version that the agent's traces and the metric ines_build_info report.",
    },
  ]),
  ...group("Debugging", [
    {
      name: "LIVE_DEBUG_TRACES",
      readBy: AGENT,
      type: "enum",
      default: "0",
      choices: DEBUG_TRACE_LEVELS,
      description:
        "Writes the course of each question to the log while it runs. The value 1 writes a clean trace, and 2 also writes the whole input and output of the model as JSON. A value of 1 or more writes whole conversations to the log, so the agent ignores it in production unless INES_ALLOW_DEBUG_TRACES is true.",
    },
    {
      name: "INES_ALLOW_DEBUG_TRACES",
      readBy: AGENT,
      type: "boolean",
      default: "false",
      description: "With true, LIVE_DEBUG_TRACES takes effect when NODE_ENV is production. Any other value leaves it ignored there.",
    },
  ]),
];
