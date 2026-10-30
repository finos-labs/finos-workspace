import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { after, before, test } from "node:test";

const root = new URL("../", import.meta.url);
const ORIGIN = "http://localhost:3000";

const servers = {
  python: {
    port: 5171,
    command: process.env.PYTHON?.includes("/") ? resolve(process.env.PYTHON) : (process.env.PYTHON ?? "python3"),
    args: ["-m", "uvicorn", "main:app", "--port", "5171"],
    cwd: new URL("python/", root),
  },
  typescript: { port: 5172, command: process.execPath, args: ["main.ts"], cwd: new URL("typescript/", root) },
};
const children = [];

async function waitFor(port) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`nothing answers on port ${port}`);
}

before(async () => {
  for (const { command, args, cwd, port } of Object.values(servers)) {
    const child = spawn(command, args, { cwd, env: { ...process.env, PORT: String(port) }, stdio: "inherit" });
    children.push(child);
  }
  await Promise.all(Object.values(servers).map(({ port }) => waitFor(port)));
});

after(() => {
  for (const child of children) child.kill();
});

async function call(name, path, init = {}) {
  const response = await fetch(`http://127.0.0.1:${servers[name].port}${path}`, {
    ...init,
    headers: { Origin: ORIGIN, ...init.headers },
  });
  return {
    status: response.status,
    type: (response.headers.get("content-type") ?? "").split(";")[0],
    cors: response.headers.get("access-control-allow-origin"),
    body: await response.text(),
  };
}

async function same(path, init) {
  const [python, typescript] = [await call("python", path, init), await call("typescript", path, init)];
  assert.deepEqual(typescript, python, `${init?.method ?? "GET"} ${path}`);
  return python;
}

const events = (body) =>
  body
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const [event, data] = block.split("\n");
      return { event: event.replace("event: ", ""), data: JSON.parse(data.replace("data: ", "")) };
    });

const answer = (body) =>
  events(body)
    .filter(({ event }) => event === "copilotMessageChunk")
    .map(({ data }) => data.delta)
    .join("");

const portfolio = {
  origin: "Quick start",
  widget_id: "portfolio_summary",
  uuid: "w-portfolio",
  name: "Portfolio summary",
  description: "Key figures of a sample portfolio",
  widget_type: "html",
  category: "Quick start",
  params: [],
};

const revenue = {
  origin: "Sales demo",
  widget_id: "revenue_by_region",
  uuid: "w-revenue",
  name: "Revenue by region",
  description: "Revenue for each sales region in one year",
  widget_type: "markdown",
  category: "sales",
  params: [{ name: "year", type: "number", default_value: 2025, current_value: "2024" }],
};

const query = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

const ask = (content, extra = {}) => ({
  messages: [{ role: "human", content }],
  widgets: { primary: [], secondary: [portfolio, revenue], extra: [] },
  ...extra,
});

const toolResult = (widget, entry) => ({
  messages: [
    { role: "human", content: `Read the data of ${widget.name}` },
    { role: "tool", function: "get_widget_data", input_arguments: { data_sources: [{ widget_uuid: widget.uuid, origin: widget.origin, id: widget.widget_id, input_args: {} }] }, data: [entry], extra_state: {} },
  ],
  widgets: { primary: [], secondary: [portfolio, revenue], extra: [] },
});

test("the descriptor names the agent, its endpoint and its features", async () => {
  const result = await same("/agents.json");
  const agent = JSON.parse(result.body).reference_agent;
  assert.equal(agent.endpoints.query, "/v1/query");
  assert.equal(agent.features.streaming, true);
  assert.equal(agent.features["widget-dashboard-select"], true);
  assert.equal(result.cors, ORIGIN);
});

test("a question that names no widget gets an overview and a suggestion", async () => {
  const result = await same("/v1/query", query(ask("What is on this dashboard?", { workspace_options: { "prompt-suggestions": true } })));
  assert.equal(result.type, "text/event-stream");
  assert.equal(answer(result.body), 'You asked: "What is on this dashboard?". I can see these widgets: Portfolio summary, Revenue by region. Name one of them and I read its data.');
  assert.deepEqual(events(result.body).at(-1), { event: "copilotPromptSuggestions", data: { suggestions: ["Read the data of Portfolio summary"] } });
});

test("a question without a widget on the dashboard says so", async () => {
  const result = await same("/v1/query", query({ messages: [{ role: "human", content: "Hello" }] }));
  assert.equal(answer(result.body), "I cannot see a widget. Add a widget to the dashboard and ask again.");
  assert.equal(events(result.body).some(({ event }) => event === "copilotPromptSuggestions"), false);
});

test("a question that names a widget ends with a request for its data", async () => {
  const result = await same("/v1/query", query(ask("Show me revenue by region please")));
  const [status, call] = events(result.body);
  assert.equal(status.event, "copilotStatusUpdate");
  assert.equal(status.data.eventType, "INFO");
  assert.deepEqual(call, {
    event: "copilotFunctionCall",
    data: {
      function: "get_widget_data",
      input_arguments: { data_sources: [{ widget_uuid: "w-revenue", origin: "Sales demo", id: "revenue_by_region", input_args: { year: "2024" } }] },
      extra_state: {},
    },
  });
  assert.equal(events(result.body).length, 2);
});

test("a widget without a current value sends its default value", async () => {
  const fresh = { ...revenue, params: [{ name: "year", type: "number", default_value: 2025 }] };
  const result = await same("/v1/query", query(ask("revenue by region", { widgets: { primary: [fresh] } })));
  assert.deepEqual(events(result.body)[1].data.input_arguments.data_sources[0].input_args, { year: 2025 });
});

test("the result of a call is answered with a citation", async () => {
  const entry = { items: [{ content: "| Region | Revenue |\n|---|---|\n| East | 110 |\n\n", data_format: { data_type: "object", parse_as: "text" } }] };
  const result = await same("/v1/query", query({ ...toolResult(revenue, entry), workspace_options: { "prompt-suggestions": true } }));
  assert.equal(answer(result.body), '"Revenue by region" returned 3 lines. The first line is: | Region | Revenue |');
  const [citations, suggestions] = events(result.body).filter(({ event }) => event !== "copilotMessageChunk");
  assert.equal(citations.event, "copilotCitationCollection");
  assert.equal(citations.data.citations[0].id, "widget-w-revenue");
  assert.equal(citations.data.citations[0].source_info.name, "Revenue by region");
  assert.deepEqual(suggestions, { event: "copilotPromptSuggestions", data: { suggestions: ["What is on this dashboard?"] } });
});

test("a result that the browser could not read is reported", async () => {
  const result = await same("/v1/query", query(toolResult(portfolio, { error_type: "gateway_error", content: "The backend did not answer" })));
  assert.equal(answer(result.body), 'The browser could not read "Portfolio summary": The backend did not answer');
  assert.equal(events(result.body).some(({ event }) => event === "copilotCitationCollection"), false);
});

test("the setting shout writes the answer in capitals", async () => {
  const result = await same("/v1/query", query(ask("What is on this dashboard?", { workspace_options: { shout: true } })));
  assert.equal(answer(result.body), answer(result.body).toUpperCase());
  assert.match(answer(result.body), /^YOU ASKED:/);
});

test("a request that does not fit is refused", async () => {
  assert.equal((await same("/v1/query", query("not json"))).status, 400);
  assert.deepEqual(JSON.parse((await same("/v1/query", query("not json"))).body), { error: "Invalid JSON" });
  for (const body of [{}, { messages: [] }, { messages: ["text"] }, [1]]) {
    const result = await same("/v1/query", query(body));
    assert.equal(result.status, 400);
    assert.deepEqual(JSON.parse(result.body), { error: "Invalid request" });
  }
});

test("a widget that the agent cannot read ends the stream with an error", async () => {
  const result = await same("/v1/query", query({ messages: [{ role: "human", content: "hello" }], widgets: { secondary: [{ uuid: "w-broken" }] } }));
  assert.deepEqual(events(result.body), [{ event: "copilotStatusUpdate", data: { eventType: "ERROR", message: "The agent could not read the request." } }]);
});

test("other routes are not found", async () => {
  const result = await same("/no_such_route");
  assert.equal(result.status, 404);
  await same("/v1/query");
});

test("the preflight allows the methods and headers of the web app and no others", async () => {
  for (const { port } of Object.values(servers)) {
    const response = await fetch(`http://127.0.0.1:${port}/v1/query`, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-trace-id",
      },
    });
    assert.ok(response.status < 300, `port ${port}: ${response.status}`);
    const headers = (response.headers.get("access-control-allow-headers") ?? "").toLowerCase().split(/\s*,\s*/);
    const methods = (response.headers.get("access-control-allow-methods") ?? "").toUpperCase().split(/\s*,\s*/);
    assert.ok(headers.includes("content-type") && headers.includes("x-trace-id"), `port ${port}: ${headers}`);
    assert.ok(!headers.includes("*") && !headers.includes("authorization"), `port ${port}: ${headers}`);
    assert.ok(methods.includes("POST") && methods.includes("GET") && !methods.includes("DELETE"), `port ${port}: ${methods}`);
  }
});

test("only the web app's origin is allowed", async () => {
  for (const { port } of Object.values(servers)) {
    const response = await fetch(`http://127.0.0.1:${port}/agents.json`, { headers: { Origin: "http://localhost:9999" } });
    assert.equal(response.headers.get("access-control-allow-origin"), null, `port ${port}`);
  }
});
