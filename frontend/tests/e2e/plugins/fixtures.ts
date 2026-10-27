import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import {
  createServer as createHttpsServer,
  type Server as HttpsServer,
} from "node:https";
import { dirname, join } from "node:path";
import { localhostTls } from "../tls";

const sha256 = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");

function listingDigest(files: Record<string, string>) {
  const lines = Object.keys(files)
    .sort()
    .map((path) => `${path}\0${files[path]}\n`)
    .join("");
  const raw = createHash("sha256").update(lines).digest("base64url");
  return `sha256-${raw}`;
}

export function writePackage(
  root: string,
  manifest: Record<string, unknown> & { id: string },
  files: Record<string, string>,
  named?: string,
) {
  const hashes: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) hashes[name] = sha256(content);
  const seed = sha256(JSON.stringify([manifest, hashes]));
  const version =
    named ??
    `1.${Number.parseInt(seed.slice(0, 4), 16)}.${Number.parseInt(seed.slice(4, 8), 16)}`;
  const directory = join(root, manifest.id, version);
  mkdirSync(directory, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), content);
  }
  writeFileSync(
    join(directory, "plugin.json"),
    JSON.stringify({ ...manifest, version, checksum: listingDigest(hashes) }, null, 2),
  );
  return version;
}

const BASE = {
  manifestVersion: 1,
  publisher: { name: "Workspace end-to-end tests" },
  host: { api: 1, afm: "0.11" },
  entry: { module: "entry.js" },
};

export const TABLE_ENTRY = `
export default {
  initialize({ model }) {
    return {
      async copilotContext() { return { rows: (model.get("data") ?? []).length }; },
      async exportOptions() {
        const rows = model.get("data") ?? [];
        if (!rows.length) return [];
        const region = model.get("params")?.region ?? "-";
        return [{ id: "rows", label: "Rows of " + region + " (JSON)", extension: "json", mime: "application/json" }];
      },
      async exportData(id, { title }) {
        if (id !== "rows") return null;
        return JSON.stringify({ title, rows: model.get("data") ?? [] });
      },
    };
  },
  render({ model, el, experimental }) {
    if (model.get("meta")?.widgetId === "note") {
      const drawNote = () => {
        const note = document.createElement("p");
        note.id = "e2e-note";
        note.textContent = model.get("config")?.text ?? "";
        el.replaceChildren(note);
      };
      model.on("change:config", drawNote);
      drawNote();
      return;
    }
    const draw = () => {
      const rows = model.get("data") ?? [];
      const params = model.get("params") ?? {};
      const definition = model.get("definition") ?? {};
      el.replaceChildren();
      const title = document.createElement("h3");
      title.id = "e2e-title";
      title.textContent = (definition.title ?? "Rows") + ": " + (params.region ?? "-");
      const count = document.createElement("p");
      count.id = "e2e-count";
      count.textContent = rows.length + " rows";
      const theme = document.createElement("p");
      theme.id = "e2e-theme";
      theme.textContent = "theme " + (model.get("theme")?.mode ?? "-");
      const next = document.createElement("button");
      next.id = "e2e-next";
      next.textContent = "Next region";
      next.onclick = async () => {
        const region = params.region === "emea" ? "apac" : "emea";
        model.set("params", { ...params, region });
        model.save_changes();
        await experimental.invoke("core:ui:notify", { level: "info", text: "Region " + region });
      };
      el.append(title, count, theme, next);
    };
    for (const name of ["data", "params", "definition", "theme"]) model.on("change:" + name, draw);
    draw();
  },
};
`;

export const HOSTILE_ENTRY = `
const results = {};
const attempt = (name, fn) => {
  try {
    const value = fn();
    results[name] = value === "blocked" ? "blocked" : "allowed";
  } catch {
    results[name] = "blocked";
  }
};
const violations = [];
document.addEventListener("securitypolicyviolation", (e) => violations.push(e.effectiveDirective));

export default {
  async render({ model, el, experimental }) {
    attempt("parent-document", () => window.parent.document.body.innerHTML);
    attempt("top-document", () => window.top.document.cookie);
    attempt("opener", () => (window.opener ? window.opener.document : "blocked"));
    attempt("local-storage", () => window.localStorage.setItem("x", "1"));
    attempt("session-storage", () => window.sessionStorage.getItem("x"));
    attempt("cookie", () => {
      document.cookie = "e2e=1";
      return document.cookie.includes("e2e=1") ? "allowed" : "blocked";
    });
    attempt("window-open", () => (window.open("https://example.com") ? "allowed" : "blocked"));
    attempt("top-navigation", () => { window.top.location.href = "https://example.com"; });
    attempt("alert", () => { alert("x"); return "blocked"; });
    attempt("eval", () => new Function("return 1")());
    const before = violations.length;
    await fetch("https://example.com/beacon").catch(() => undefined);
    new Image().src = "https://example.com/pixel.png";
    try { new WebSocket("wss://example.com/socket"); } catch {}
    navigator.sendBeacon?.("https://example.com/beacon", "x");
    await import("https://example.com/module.js").catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 500));
    results["network"] = violations.length - before >= 3 ? "blocked" : "allowed";
    results["worker-network"] = await new Promise((resolve) => {
      const code = \`self.onmessage = async () => {
        const url = URL.createObjectURL(new Blob(['fetch("https://nested.example.com/beacon").then(() => postMessage("allowed"), () => postMessage("blocked"))'], { type: "text/javascript" }));
        const inner = new Worker(url);
        URL.revokeObjectURL(url);
        const nested = new Promise((done) => { inner.onmessage = (event) => done(event.data); setTimeout(() => done("silent"), 4000); });
        const own = await fetch("https://worker.example.com/beacon").then(() => "allowed", () => "blocked");
        postMessage(own === "blocked" && (await nested) === "blocked" ? "blocked" : "allowed");
      };\`;
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = (event) => resolve(event.data);
      worker.onerror = () => resolve("error");
      worker.postMessage("go");
      setTimeout(() => resolve("silent"), 6000);
    });
    results["data-worker"] = await new Promise((resolve) => {
      try {
        const worker = new Worker("data:text/javascript,postMessage('ran')");
        worker.onmessage = () => resolve("allowed");
        worker.onerror = () => resolve("blocked");
        setTimeout(() => resolve("blocked"), 3000);
      } catch {
        resolve("blocked");
      }
    });
    window.parent.postMessage({ type: "ws-shell-ready" }, "*");
    window.parent.postMessage({ t: "write", traits: { params: { region: "forged" } } }, "*");
    attempt("mcp-link", () => (model.get("mcp_tool") === undefined ? "blocked" : "allowed"));
    for (const [name, msg] of [
      ["core:clipboard:write", { text: "x" }],
      ["core:shell:exec", {}],
      ["core:mcp:call", { server: "E2E MCP", tool: "lookup", arguments: {} }],
    ]) {
      try {
        await experimental.invoke(name, msg);
        results[name] = "allowed";
      } catch (error) {
        results[name] = error.name === "not_granted" || error.name === "unknown_command" ? "blocked" : error.name;
      }
    }
    try {
      await experimental.invoke("core:ui:open-link", { url: "javascript:alert(1)" });
      results["javascript-link"] = "allowed";
    } catch (error) {
      results["javascript-link"] = error.name === "out_of_scope" ? "blocked" : error.name;
    }
    await experimental.invoke("core:ui:notify", { text: "<img src=x onerror=alert(1)>e2e-markup" });
    model.set("params", { undeclared: "x" });
    model.save_changes();
    Object.prototype.e2ePolluted = true;
    const pre = document.createElement("pre");
    pre.id = "e2e-results";
    pre.textContent = JSON.stringify(results);
    el.replaceChildren(pre);
  },
};
`;

export function tableManifest(id = "e2e-table") {
  return {
    ...BASE,
    id,
    name: "End-to-end table",
    description: "Exercises the widget plugin runtime",
    contributes: {
      widgets: [
        {
          id: "table",
          name: "End-to-end table",
          handles: [
            {
              type: "e2e_table",
              definition: {
                type: "object",
                additionalProperties: false,
                properties: { title: { type: "string", maxLength: 80 } },
              },
            },
          ],
          permissions: [
            "core:data:read",
            "core:params:write",
            "core:ui:notify",
            "core:export:provide",
            "core:copilot:context",
          ],
        },
        {
          id: "note",
          name: "End-to-end note",
          description: "A note the plugin renders from its settings",
          category: "E2E plugins",
          standalone: true,
          permissions: [],
          settings: {
            schema: {
              properties: { text: { type: "string", maxLength: 80, title: "Text" } },
            },
            defaults: { text: "Hello from a plugin" },
          },
          grid: { w: 12, h: 6 },
        },
      ],
    },
  };
}

export function hostileManifest(id = "e2e-hostile") {
  return {
    ...BASE,
    id,
    name: "End-to-end hostile",
    description: "Attempts what a plugin must not be able to do",
    contributes: {
      widgets: [
        {
          id: "probe",
          name: "End-to-end hostile",
          handles: [{ type: "e2e_hostile" }],
          permissions: ["core:data:read", "core:ui:notify", "core:ui:open-link"],
        },
      ],
    },
  };
}

export const WANDERER_ENTRY = `
export default {
  render({ el }) {
    el.textContent = "wandering";
    setTimeout(() => {
      location.href = "about:blank";
    }, 500);
  },
};
`;

export function wandererManifest(id = "e2e-wanderer") {
  return {
    ...BASE,
    id,
    name: "End-to-end wanderer",
    description: "Navigates its own frame away",
    contributes: {
      widgets: [
        {
          id: "wanderer",
          name: "End-to-end wanderer",
          description: "A frame that navigates itself",
          category: "E2E plugins",
          standalone: true,
          permissions: [],
          grid: { w: 12, h: 6 },
        },
      ],
    },
  };
}

const WIDGETS = {
  e2e_rows: {
    name: "E2E rows",
    description: "Rows for one region",
    type: "e2e_table",
    endpoint: "/rows",
    data: { e2e_table: { title: "Sales" } },
    params: [{ paramName: "region", type: "text", value: "emea", label: "Region" }],
  },
  e2e_probe: {
    name: "E2E probe",
    description: "A hostile plugin's attempts",
    type: "e2e_hostile",
    endpoint: "/rows",
    params: [{ paramName: "region", type: "text", value: "emea", label: "Region" }],
    mcp_tool: { mcp_server: "E2E MCP", tool_id: "lookup", args: { region: "$region" } },
  },
};

const ROWS: Record<string, unknown[]> = {
  emea: [
    { country: "France", sales: 10 },
    { country: "Spain", sales: 7 },
  ],
  apac: [
    { country: "Japan", sales: 12 },
    { country: "India", sales: 9 },
    { country: "Korea", sales: 4 },
  ],
};

export function startBackend(port: number, origin: string): Promise<HttpsServer> {
  const server = createHttpsServer(localhostTls(), (request, response) => {
    const url = new URL(request.url ?? "/", `https://localhost:${port}`);
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const send = (status: number, body: unknown) => {
      response
        .writeHead(status, { "Content-Type": "application/json" })
        .end(JSON.stringify(body));
    };
    if (url.pathname === "/widgets.json") send(200, WIDGETS);
    else if (url.pathname === "/apps.json")
      send(200, [
        {
          name: "E2E plugin apps",
          tabs: {},
          mcpServers: [
            {
              name: "E2E MCP",
              url: `https://localhost:${port}/mcp`,
              authType: "token",
            },
          ],
        },
      ]);
    else if (url.pathname === "/rows")
      send(200, ROWS[url.searchParams.get("region") ?? "emea"] ?? []);
    else send(404, { detail: "not found" });
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve(server)),
  );
}

export const QUOTES_ENTRY = `
export default {
  async render({ el, experimental }) {
    const results = {};
    const call = async (name, msg) => {
      try {
        const [value] = await experimental.invoke("core:proxy:call", msg);
        results[name] = value;
      } catch (error) {
        results[name] = "refused:" + error.name;
      }
    };
    await call("quote", { id: "quote", args: { symbol: "IBM" } });
    await call("undeclared", { id: "other", args: {} });
    await call("own-url", { id: "quote", url: "https://169.254.169.254/latest/meta-data/", args: { symbol: "IBM" } });
    await call("extra-arg", { id: "quote", args: { symbol: "IBM", host: "169.254.169.254" } });
    const pre = document.createElement("pre");
    pre.id = "e2e-proxy-results";
    pre.textContent = JSON.stringify(results);
    el.replaceChildren(pre);
  },
};
`;

export function quotesManifest(origin: string, id = "e2e-quotes") {
  return {
    ...BASE,
    id,
    name: "End-to-end quotes",
    description: "Reads a keyed quote service through a proxy",
    secrets: [
      { name: "api_key", purpose: "Authenticates to the end-to-end quote service" },
    ],
    server: {
      network: [origin],
      proxies: [
        {
          id: "quote",
          method: "GET",
          url: `${origin}/quotes/\${arg:symbol}`,
          // biome-ignore lint/suspicious/noTemplateCurlyInString: a template token the API fills
          headers: { Authorization: "Bearer ${secret:api_key}" },
          args: { symbol: { type: "string", maxLength: 12, required: true } },
        },
      ],
    },
    contributes: {
      widgets: [
        {
          id: "quote",
          name: "E2E quote",
          description: "A quote from the keyed service",
          category: "E2E plugins",
          standalone: true,
          permissions: ["core:proxy:call"],
          server: { proxies: ["quote"] },
          grid: { w: 12, h: 6 },
        },
      ],
    },
  };
}

export interface UpstreamRequest {
  path: string;
  authorization: string | undefined;
}

export function startProxyUpstream(
  port: number,
  listen: string,
  tlsDir: string,
  secret: () => string,
) {
  const received: UpstreamRequest[] = [];
  const server = createHttpsServer(
    {
      key: readFileSync(join(tlsDir, "key.pem")),
      cert: readFileSync(join(tlsDir, "cert.pem")),
    },
    (request, response) => {
      received.push({
        path: request.url ?? "",
        authorization: request.headers.authorization,
      });
      const send = (status: number, body: unknown) =>
        response
          .writeHead(status, { "Content-Type": "application/json" })
          .end(JSON.stringify(body));
      const symbol = /^\/quotes\/([A-Za-z0-9.%-]{1,40})$/.exec(request.url ?? "")?.[1];
      if (request.headers.authorization !== `Bearer ${secret()}`)
        send(401, { detail: "unauthorized" });
      else if (!symbol) send(404, { detail: "not found" });
      else send(200, { symbol: decodeURIComponent(symbol), price: 101.5 });
    },
  );
  return new Promise<{ server: typeof server; received: UpstreamRequest[] }>(
    (resolve) => server.listen(port, listen, () => resolve({ server, received })),
  );
}

export function journeyEntry(label: string, reach: string) {
  return `
export default {
  async render({ el }) {
    const version = document.createElement("p");
    version.id = "e2e-journey-version";
    version.textContent = ${JSON.stringify(label)};
    const reach = document.createElement("p");
    reach.id = "e2e-journey-reach";
    reach.textContent = "trying";
    el.replaceChildren(version, reach);
    try {
      const response = await fetch(${JSON.stringify(`${reach}/ping`)});
      reach.textContent = response.ok ? "reached" : "refused " + response.status;
    } catch {
      reach.textContent = "blocked";
    }
    for (let i = 0; i < 300; i++) {
      try {
        document.dispatchEvent(new SecurityPolicyViolationEvent("securitypolicyviolation", {
          blockedURI: "https://forged-" + i + ".example.org/<b>x</b>",
          effectiveDirective: "connect-src",
          violatedDirective: "connect-src",
          originalPolicy: "",
          disposition: "enforce",
          statusCode: 0,
        }));
      } catch {}
    }
    for (let i = 0; i < 250; i++) new Image().src = "https://flood-" + i + ".example.invalid/p.png";
  },
};
`;
}

export function journeyManifest(id = "e2e-journey") {
  return {
    ...BASE,
    id,
    name: "End-to-end journey",
    description: "Walks through the admin journey",
    contributes: {
      widgets: [
        {
          id: "journey",
          name: "E2E journey",
          description: "Shows its version and what it can reach",
          category: "E2E plugins",
          standalone: true,
          permissions: [],
          grid: { w: 12, h: 6 },
        },
      ],
    },
  };
}

export function startReachServer(port: number) {
  const hits: string[] = [];
  const server = createServer((request, response) => {
    hits.push(request.url ?? "");
    response
      .writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      })
      .end('{"ok": true}');
  });
  return new Promise<{ server: Server; hits: string[] }>((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve({ server, hits })),
  );
}

export const CONFORMANCE_ENTRY = `
const order = [];
export default {
  async initialize() {
    order.push("initialize");
    await new Promise((resolve) => setTimeout(resolve, 20));
  },
  async render({ model, el, host, experimental }) {
    order.push("render");
    const results = { order };
    const refreshes = document.createElement("p");
    refreshes.id = "e2e-refreshes";
    refreshes.textContent = "0";
    model.on("msg:custom", (content) => {
      if (content?.kind === "workspace-event" && content.name === "refresh")
        refreshes.textContent = String(Number(refreshes.textContent) + 1);
    });
    const outcome = (promise) => promise.then(([value]) => ["resolved", value], (e) => e.name);
    results.invoke = await outcome(experimental.invoke("core:ui:notify", { text: "conformance invoke" }));
    results.refused = await outcome(experimental.invoke("core:clipboard:write", { text: "x" }));
    results.send = await new Promise((resolve) => {
      const handler = (content, buffers) => {
        if (content?.id !== "conformance-1") return;
        model.off("msg:custom", handler);
        resolve([content.kind, content.response ?? null, buffers.length]);
      };
      model.on("msg:custom", handler);
      model.send({ id: "conformance-1", kind: "anywidget-command", name: "core:ui:notify", msg: { text: "conformance send" } }, undefined, []);
      setTimeout(() => resolve("no answer"), 5000);
    });
    const echoed = (trait, value) => new Promise((resolve) => {
      const before = JSON.stringify(model.get(trait));
      let changes = 0;
      model.on("change:" + trait, () => {
        changes += 1;
        if (changes === 2) resolve(JSON.stringify(model.get(trait)) === before ? "restored" : "kept");
      });
      model.set(trait, value);
      model.save_changes();
      setTimeout(() => resolve("no echo after " + changes), 5000);
    });
    results.unpermitted = await echoed("params", { region: "forged" });
    results.oversized = await echoed("state", { big: "x".repeat(70 * 1024) });
    results.asset = await experimental.invoke("core:asset:read", { path: "assets/sample.txt" }).then(
      ([value, [bytes]]) => [value.size, new TextDecoder().decode(bytes)],
      (e) => e.name,
    );
    results.assetOutside = await outcome(experimental.invoke("core:asset:read", { path: "entry.js" }));
    results.assetMissing = await outcome(experimental.invoke("core:asset:read", { path: "assets/missing.txt" }));
    results.cross = await host.getWidget("other").then(() => "allowed", (e) => e.name);
    const pre = document.createElement("pre");
    pre.id = "e2e-conformance";
    pre.textContent = JSON.stringify(results);
    el.replaceChildren(pre, refreshes);
  },
};
`;

export function conformanceManifest(id = "e2e-conformance") {
  return {
    ...BASE,
    id,
    name: "End-to-end conformance",
    description: "Checks the guest contract in a real frame",
    contributes: {
      widgets: [
        {
          id: "conformance",
          name: "E2E conformance",
          description: "Runs the contract's cases",
          category: "E2E plugins",
          standalone: true,
          permissions: ["core:ui:notify", "core:state:write"],
          params: [
            { paramName: "region", type: "text", value: "emea", label: "Region" },
          ],
          grid: { w: 12, h: 8 },
        },
      ],
    },
  };
}

export function versionDigest(root: string, id: string, version: string) {
  const directory = join(root, id, version);
  const hashes: Record<string, string> = {};
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`);
      else hashes[`${prefix}${name}`] = sha256(readFileSync(path));
    }
  };
  walk(directory, "");
  return listingDigest(hashes);
}

export const FORECAST_ENTRY = `
export default {
  async render({ el, experimental }) {
    const results = {};
    try {
      const [value] = await experimental.invoke("core:backend:call", { route: "forecast", args: { region: "emea" } });
      results.forecast = value;
    } catch (error) {
      results.forecast = "refused:" + error.name;
    }
    try {
      await experimental.invoke("core:backend:call", { route: "other", args: {} });
      results.other = "allowed";
    } catch (error) {
      results.other = "refused:" + error.name;
    }
    const pre = document.createElement("pre");
    pre.id = "e2e-forecast";
    pre.textContent = JSON.stringify(results);
    el.replaceChildren(pre);
  },
};
`;

export function forecastManifest(id = "e2e-forecast") {
  return {
    ...BASE,
    id,
    name: "End-to-end forecast",
    description: "A plugin whose backend reads a data source for the user",
    secrets: [{ name: "model_key", purpose: "Authenticates the backend to its model" }],
    dataSources: [{ id: "sales", purpose: "The sales of the user's organization" }],
    identity: "pseudonymous",
    server: {
      backend: {
        protocol: 1,
        routes: [
          {
            id: "forecast",
            args: { region: { type: "string", maxLength: 8, required: true } },
            secrets: ["model_key"],
          },
        ],
      },
    },
    contributes: {
      widgets: [
        {
          id: "forecast",
          name: "E2E forecast",
          description: "A forecast from the plugin's backend",
          category: "E2E plugins",
          standalone: true,
          permissions: ["core:backend:call"],
          server: { routes: ["forecast"] },
          grid: { w: 12, h: 6 },
        },
      ],
    },
  };
}

export interface BackendRequest {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export function startPluginBackend(options: {
  port: number;
  listen: string;
  apiUrl: string;
  origin: string;
  identity: () => Record<string, unknown>;
  secret: () => string;
}) {
  const received: BackendRequest[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString();
    received.push({ path: request.url ?? "", headers: request.headers, body });
    const send = (status: number, value: unknown) =>
      response
        .writeHead(status, { "Content-Type": "application/json" })
        .end(JSON.stringify(value));
    if (request.url === "/.workspace/identity") return send(200, options.identity());
    if (request.url === "/.workspace/health") return send(200, { ok: true });
    if (request.url !== "/.workspace/routes/forecast") return send(404, {});
    const call = JSON.parse(body);
    const read = await fetch(`${options.apiUrl}/internal/plugin-broker/data/sales`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Call": String(request.headers["x-workspace-call"] ?? ""),
        Origin: options.origin,
      },
      body: JSON.stringify({
        path: "/sales",
        method: "GET",
        query: { region: call.args.region },
      }),
    });
    const data = await read.json();
    send(200, {
      region: call.args.region,
      rows: data.body?.rows ?? null,
      caller: call.caller?.id ? "pseudonymous" : "none",
      secret: request.headers["x-workspace-secret-model-key"] === options.secret(),
    });
  });
  return new Promise<{ server: Server; received: BackendRequest[] }>((resolve) =>
    server.listen(options.port, options.listen, () => resolve({ server, received })),
  );
}

export function startDataSource(port: number, listen: string, key: () => string) {
  const received: BackendRequest[] = [];
  const server = createServer((request, response) => {
    received.push({ path: request.url ?? "", headers: request.headers, body: "" });
    const authorized = request.headers["x-api-key"] === key();
    response
      .writeHead(authorized ? 200 : 401, { "Content-Type": "application/json" })
      .end(
        JSON.stringify(
          authorized ? { rows: [{ region: "emea", sales: 10 }] } : { detail: "no key" },
        ),
      );
  });
  return new Promise<{ server: Server; received: BackendRequest[] }>((resolve) =>
    server.listen(port, listen, () => resolve({ server, received })),
  );
}
