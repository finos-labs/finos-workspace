// Starts the Python and the TypeScript reference backends and checks that they
// answer every request the same way.
//
//     PYTHON=python3 node --test test/parity.test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";

const root = new URL("../", import.meta.url);
const widgets = JSON.parse(readFileSync(new URL("widgets.json", root)));
const apps = JSON.parse(readFileSync(new URL("apps.json", root)));
const ORIGIN = "http://localhost:3000";

const servers = {
  python: {
    port: 5161,
    // A path in PYTHON is relative to where the test runs, not to python/.
    command: process.env.PYTHON?.includes("/") ? resolve(process.env.PYTHON) : (process.env.PYTHON ?? "python3"),
    args: ["-m", "uvicorn", "main:app", "--port", "5161"],
    cwd: new URL("python/", root),
  },
  typescript: { port: 5162, command: process.execPath, args: ["main.ts"], cwd: new URL("typescript/", root) },
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
  const port = servers[name].port;
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { Origin: ORIGIN, ...init.headers },
  });
  const body = Buffer.from(await response.arrayBuffer())
    .toString("latin1")
    .replaceAll(`127.0.0.1:${port}`, "HOST")
    .replace(/Fetched at \d\d:\d\d:\d\d/, "Fetched at TIME");
  return {
    status: response.status,
    type: (response.headers.get("content-type") ?? "").replace(/\s/g, "").toLowerCase(),
    cors: response.headers.get("access-control-allow-origin"),
    body,
  };
}

async function same(path, init) {
  const [python, typescript] = [await call("python", path, init), await call("typescript", path, init)];
  assert.deepEqual(typescript, python, `${init?.method ?? "GET"} ${path}`);
  return python;
}

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("the catalog files are served unchanged", async () => {
  assert.deepEqual(JSON.parse((await same("/widgets.json")).body), widgets);
  assert.deepEqual(JSON.parse((await same("/apps.json")).body), apps);
});

test("every widget's endpoint answers the same with its default parameters", async () => {
  for (const [id, widget] of Object.entries(widgets)) {
    const params = (widget.params ?? []).flat().filter((param) => param.type !== "form" && param.value !== undefined);
    let path = `/${widget.endpoint}`;
    const query = new URLSearchParams();
    const headers = {};
    const body = {};
    for (const param of params) {
      if (path.includes(`{${param.paramName}}`)) path = path.replace(`{${param.paramName}}`, param.value);
      else if (param.in === "header") headers[param.paramName] = String(param.value);
      else if (param.in === "body") body[param.paramName] = param.value;
      else query.set(param.paramName, String(param.value));
    }
    const init = widget.method === "POST" ? { ...json(body), headers: { "Content-Type": "application/json", ...headers } } : { headers };
    const result = await same(`${path}${query.size ? `?${query}` : ""}`, init);
    if (id !== "markdown_widget_with_error") assert.equal(result.status, 200, id);
    assert.equal(result.cors, ORIGIN, id);
  }
});

test("variants of the parameters answer the same", async () => {
  const paths = [
    "/html_widget?theme=light",
    "/html_widget?raw=true",
    "/html_table_widget?theme=light",
    "/html_table_widget?raw=true",
    "/newsfeed_widget?category=tech",
    "/iframe_page?theme=light",
    "/param_text",
    "/param_number?count=1",
    "/param_boolean?include_details=true",
    "/param_date",
    "/param_dropdown?region=nowhere",
    "/param_multi_select?regions=apac",
    "/param_multi_select",
    "/param_multiple_text?tags=a,b,c",
    "/param_endpoint_dropdown?company=cedarline",
    "/param_endpoint_dropdown?company=nobody",
    "/company_options",
    "/city_options?country=borealis",
    "/city_options?country=nowhere",
    "/param_dependent_dropdown?country=borealis&city=riverside",
    "/param_rows?region=europe&count=4&note=Checked",
    "/param_header",
    "/regions/nowhere/summary",
    "/company_profile?company=dunmore",
    "/company_performance?company=birchfield&raw=true",
    "/company_performance?company=nobody",
    "/assets/revenue-chart.svg",
    "/assets/secret.txt",
    "/no_such_route",
  ];
  for (const path of paths) await same(path);
  await same("/param_header", { headers: { "X-Desk": "rates" } });
  await same("/param_body", json({ region: "europe", limit: 3 }));
  await same("/widgets.json", { method: "POST" });
});

test("the form adds clients the same way", async () => {
  await same("/client_entries");
  await same("/client_form", json({ first_name: "Ada" }));
  await same("/client_form", json({ first_name: "Ada", last_name: "Lane", investment_types: ["bonds", "funds"], risk_profile: "cautious" }));
  const entries = await same("/client_entries");
  assert.match(entries.body, /Ada Lane \| bonds, funds \| cautious/);
});

test("the app names only widgets that exist", () => {
  for (const app of apps) {
    for (const tab of Object.values(app.tabs)) {
      for (const item of tab.layout) assert.ok(widgets[item.i], `${app.name}: ${item.i}`);
    }
    for (const group of app.groups) {
      for (const id of group.widgetIds) assert.ok(widgets[id], `${app.name}: ${group.name}: ${id}`);
    }
  }
});
