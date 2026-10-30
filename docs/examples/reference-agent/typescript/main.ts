import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

type Json = Record<string, any>;

const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3000";
const PORT = Number(process.env.PORT ?? 6060);

const AGENTS = {
  reference_agent: {
    name: "Reference agent",
    description: "Answers questions about the widgets of your dashboard, without a model",
    endpoints: { query: "/v1/query" },
    features: {
      streaming: true,
      "widget-dashboard-select": true,
      "prompt-suggestions": {
        label: "Follow-up suggestions",
        default: true,
        description: "Suggest a question after each answer.",
      },
      shout: {
        label: "Answer in capitals",
        default: false,
        description: "Write every answer in capitals.",
      },
    },
  },
};

const sse = (name: string, data: Json): string => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

function widgetsOf(body: Json): Json[] {
  const tiers = body.widgets ?? {};
  return [...(tiers.primary ?? []), ...(tiers.secondary ?? []), ...(tiers.extra ?? [])];
}

function inputArgs(widget: Json): Json {
  const values: Json = {};
  for (const param of widget.params ?? []) {
    const value = param.current_value ?? param.default_value;
    if (value !== undefined && value !== null) values[param.name] = value;
  }
  return values;
}

const dataSource = (widget: Json): Json => ({
  widget_uuid: widget.uuid,
  origin: widget.origin,
  id: widget.widget_id,
  input_args: inputArgs(widget),
});

const citation = (widget: Json, source: Json): Json => ({
  id: `widget-${widget.uuid}`,
  source_info: {
    type: "widget",
    origin: widget.origin,
    widget_id: widget.widget_id,
    name: widget.name,
    metadata: { input_args: source.input_args ?? {}, widget_uuid: widget.uuid },
    citable: true,
  },
  details: [{ "Source type": "widget", Origin: widget.origin, "Data source": widget.name }],
  signature: "",
});

function* say(text: string, options: Json): Generator<string> {
  const shown = options.shout === true ? text.toUpperCase() : text;
  const words = shown.split(" ");
  for (const [index, word] of words.entries()) {
    yield sse("copilotMessageChunk", { delta: index === words.length - 1 ? word : `${word} ` });
  }
}

function* suggest(questions: string[], options: Json): Generator<string> {
  if (options["prompt-suggestions"] === true && questions.length > 0) {
    yield sse("copilotPromptSuggestions", { suggestions: questions });
  }
}

function overview(question: string, widgets: Json[]): string {
  if (widgets.length === 0) return "I cannot see a widget. Add a widget to the dashboard and ask again.";
  const names = widgets.map((widget) => widget.name).join(", ");
  return `You asked: "${question}". I can see these widgets: ${names}. Name one of them and I read its data.`;
}

function* answerFromResult(result: Json, widgets: Json[], options: Json): Generator<string> {
  const sources = result.input_arguments?.data_sources ?? [];
  const source = sources[0] ?? {};
  const widget = widgets.find((item) => item.uuid === source.widget_uuid);
  const name = widget ? widget.name : (source.id ?? "the widget");
  const entry = (result.data ?? [])[0] ?? {};
  if ("error_type" in entry) {
    yield* say(`The browser could not read "${name}": ${entry.content ?? ""}`, options);
    return;
  }
  const content = (entry.items ?? [])[0]?.content ?? "";
  const lines = String(content)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  yield* say(`"${name}" returned ${lines.length} lines. The first line is: ${lines[0] ?? ""}`, options);
  if (widget) yield sse("copilotCitationCollection", { citations: [citation(widget, source)] });
  yield* suggest(["What is on this dashboard?"], options);
}

function* respond(body: Json): Generator<string> {
  const options = body.workspace_options ?? {};
  const widgets = widgetsOf(body);
  const last = body.messages[body.messages.length - 1];
  if (last.role === "tool") {
    yield* answerFromResult(last, widgets, options);
    return;
  }
  const question = String(last.content ?? "");
  const named = widgets.find((widget) => question.toLowerCase().includes(widget.name.toLowerCase()));
  if (!named) {
    yield* say(overview(question, widgets), options);
    yield* suggest(widgets.length > 0 ? [`Read the data of ${widgets[0].name}`] : [], options);
    return;
  }
  yield sse("copilotStatusUpdate", {
    eventType: "INFO",
    message: `Reading the data of "${named.name}".`,
    group: "reasoning",
  });
  yield sse("copilotFunctionCall", {
    function: "get_widget_data",
    input_arguments: { data_sources: [dataSource(named)] },
    extra_state: {},
  });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  if (request.headers.origin === APP_ORIGIN) {
    response.setHeader("Access-Control-Allow-Origin", APP_ORIGIN);
    response.setHeader("Vary", "Origin");
  }
  if (request.method === "OPTIONS") {
    response.setHeader("Access-Control-Allow-Methods", "GET, POST");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Trace-Id");
    return response.writeHead(204).end();
  }
  if (request.method === "GET" && url.pathname === "/agents.json") return send(response, 200, AGENTS);
  if (request.method === "POST" && url.pathname === "/v1/query") {
    let body: Json;
    try {
      body = (await readJson(request)) as Json;
    } catch {
      return send(response, 400, { error: "Invalid JSON" });
    }
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0 || typeof messages[messages.length - 1] !== "object" || messages[messages.length - 1] === null) {
      return send(response, 400, { error: "Invalid request" });
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    try {
      for (const event of respond(body)) response.write(event);
    } catch {
      response.write(sse("copilotStatusUpdate", { eventType: "ERROR", message: "The agent could not read the request." }));
    }
    return response.end();
  }
  if (url.pathname === "/agents.json" || url.pathname === "/v1/query") {
    return send(response, 405, { detail: "Method Not Allowed" });
  }
  send(response, 404, { detail: "Not Found" });
}).listen(PORT, () => console.log(`Agent on http://localhost:${PORT}`));
