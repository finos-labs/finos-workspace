// The FINOS Workspace reference backend, in TypeScript.
//
// Every widget of FINOS Workspace's built-in types, with invented data. The
// Python version in ../python answers every request the same way. It uses only
// the modules that Node.js includes, and Node.js 22.18 or later runs it as it is:
//
//     node main.ts

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

const ROOT = new URL("../", import.meta.url);
const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3000";
const PORT = Number(process.env.PORT ?? 5050);

const read = (path: string) => readFileSync(new URL(path, ROOT));
const WIDGETS = JSON.parse(read("widgets.json").toString());
const APPS = JSON.parse(read("apps.json").toString());
const DATA = JSON.parse(read("data.json").toString());
const ASSETS: Record<string, string> = { "sample-report.pdf": "application/pdf", "revenue-chart.svg": "image/svg+xml" };

interface Company {
  id: string;
  name: string;
  sector: string;
  founded: string;
  headquarters: string;
  summary: string;
  performance: { year: string; revenue: string; growth: string }[];
}
interface Option {
  label: string;
  value: string;
}
interface Client {
  first_name: string;
  last_name: string;
  investment_types: string;
  risk_profile: string;
}

const COMPANIES = new Map<string, Company>(DATA.companies.map((company: Company) => [company.id, company]));
const REGIONS = new Map<string, string>(DATA.regions.map((region: Option) => [region.value, region.label]));

const PALETTES: Record<string, Record<string, string>> = {
  dark: { background: "#0b2432", card: "#12313f", text: "#e7f2f8", muted: "#9db4c0", border: "#355867" },
  light: { background: "#ffffff", card: "#f2f6f8", text: "#1a3248", muted: "#5a7282", border: "#b7cdd8" },
};

const clients: Client[] = [];

interface Reply {
  status?: number;
  type: string;
  body: string | Buffer;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

const json = (value: unknown, status = 200): Reply => ({ status, type: "application/json", body: JSON.stringify(value) });
const markdown = (text: string): Reply => ({ type: "text/markdown; charset=utf-8", body: text });
const file = (name: string): Reply => ({ type: ASSETS[name], body: read(`assets/${name}`) });

function page(theme: string, body: string): Reply {
  const colors = PALETTES[theme] ?? PALETTES.dark;
  return {
    type: "text/html; charset=utf-8",
    body: `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 16px; background: ${colors.background}; color: ${colors.text}; font: 14px/1.4 system-ui, sans-serif; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .card { background: ${colors.card}; border-radius: 8px; padding: 12px; }
  .muted { color: ${colors.muted}; font-size: 12px; }
  .value { font-size: 22px; font-weight: 600; }
  .up { color: #2e9e6a; }
  .down { color: #d0504f; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid ${colors.border}; padding: 6px 8px; text-align: left; }
</style>
</head>
<body>${body}</body>
</html>`,
  };
}

function table(columns: string[], rows: unknown[][]): string {
  const head = columns.map((column) => `<th>${column}</th>`).join("");
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
  return `<table><tr>${head}</tr>${body}</table>`;
}

function companyOr404(id: string): Company {
  const company = COMPANIES.get(id);
  if (!company) throw new HttpError(404, `Unknown company: ${id}`);
  return company;
}

function holdingsList(count: number): string {
  return DATA.holdings
    .slice(0, Math.max(count, 0))
    .map((holding: { company: string; weight: string }) => `- ${holding.company}: ${holding.weight}`)
    .join("\n");
}

const fetchedAt = () => new Date().toISOString().slice(11, 19);
const flag = (value: string | null) => ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
const integer = (value: string | null, fallback: number) => (value === null ? fallback : Number.parseInt(value, 10));

interface Request {
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
  base: string;
  path: string[];
}
type Handler = (request: Request) => Reply;

const get: Record<string, Handler> = {
  "/": () => json({ name: "FINOS Workspace reference backend", widgets: Object.keys(WIDGETS).length }),
  "/widgets.json": () => json(WIDGETS),
  "/apps.json": () => json(APPS),

  // Widget types
  "/markdown_widget": () =>
    markdown(
      "# Reference backend\n\n" +
        "This widget is Markdown that the backend returns as text. " +
        "Every name and number in this backend is invented.\n\n" +
        "- **Bold**, *italic* and `code`\n" +
        "- Lists and tables\n\n" +
        "| Company | Sector |\n|---|---|\n" +
        DATA.companies.map((company: Company) => `| ${company.name} | ${company.sector} |`).join("\n"),
    ),
  "/markdown_widget_with_image": () => {
    const svg = read("assets/revenue-chart.svg").toString("base64");
    return markdown(`## Revenue by company\n\n![Revenue by company](data:image/svg+xml;base64,${svg})`);
  },
  "/markdown_widget_with_error": () => {
    throw new HttpError(500, "This widget fails on purpose, to show how an error looks.");
  },
  "/html_widget": ({ query }) => {
    if (flag(query.get("raw"))) return json(DATA.portfolio);
    const cards = DATA.portfolio
      .map(
        (row: { metric: string; value: string; change: string }) =>
          `<div class="card"><div class="muted">${row.metric}</div>` +
          `<div class="value">${row.value}</div>` +
          `<div class="${row.change.startsWith("-") ? "down" : "up"}">${row.change}</div></div>`,
      )
      .join("");
    return page(query.get("theme") ?? "dark", `<div class="grid">${cards}</div>`);
  },
  "/html_table_widget": ({ query }) => {
    if (flag(query.get("raw"))) return json(DATA.holdings);
    const rows = DATA.holdings.map((h: Record<string, unknown>) => [h.company, h.sector, h.quantity, h.price, h.weight]);
    return page(query.get("theme") ?? "dark", table(["Company", "Sector", "Quantity", "Price", "Weight"], rows));
  },
  "/newsfeed_widget": ({ query }) => {
    const category = query.get("category") ?? "all";
    return json(
      DATA.articles
        .filter((article: { category: string }) => category === "all" || article.category === category)
        .map(({ title, date, author, excerpt, body }: Record<string, string>) => ({ title, date, author, excerpt, body })),
    );
  },
  "/pdf_widget": () => file("sample-report.pdf"),
  "/pdf_widget_base64": () =>
    json({
      data_format: { data_type: "pdf", filename: "sample-report.pdf" },
      content: read("assets/sample-report.pdf").toString("base64"),
    }),
  "/pdf_widget_url": ({ base }) =>
    json({ data_format: { data_type: "pdf", filename: "sample-report.pdf" }, url: `${base}/assets/sample-report.pdf` }),
  "/iframe_page": ({ query }) =>
    page(query.get("theme") ?? "dark", "<h2>A page in a frame</h2><p>The iframe widget opens this page, which the backend serves.</p>"),

  // Parameters
  "/param_text": ({ query }) => markdown(`Hello, **${query.get("name") || "nobody"}**.`),
  "/param_number": ({ query }) => {
    const count = integer(query.get("count"), 3);
    return markdown(`The ${count} largest holdings:\n\n${holdingsList(count)}`);
  },
  "/param_boolean": ({ query }) => {
    const details = flag(query.get("include_details"));
    return markdown(
      DATA.companies
        .map((c: Company) => `- **${c.name}**` + (details ? `: ${c.sector}, ${c.headquarters}` : ""))
        .join("\n"),
    );
  },
  "/param_date": ({ query }) => markdown(`Report as of **${query.get("as_of") || "today"}**.`),
  "/param_dropdown": ({ query }) => {
    const region = query.get("region") ?? "europe";
    return markdown(DATA.regionSummaries[region] ?? `No data for ${region}.`);
  },
  "/param_multi_select": ({ query }) => {
    const chosen = (query.get("regions") ?? "").split(",").filter(Boolean);
    return markdown(chosen.map((region) => `- ${DATA.regionSummaries[region] ?? region}`).join("\n") || "No region chosen.");
  },
  "/param_multiple_text": ({ query }) => {
    const chosen = (query.get("tags") ?? "").split(",").filter(Boolean);
    return markdown(`${chosen.length} tags: ` + chosen.map((tag) => `\`${tag}\``).join(", "));
  },
  "/company_options": () => json(DATA.companies.map((company: Company) => ({ label: company.name, value: company.id }))),
  "/param_endpoint_dropdown": ({ query }) => {
    const company = companyOr404(query.get("company") ?? "alder");
    return markdown(`## ${company.name}\n\n${company.summary}`);
  },
  "/city_options": ({ query }) => json(DATA.cities[query.get("country") ?? ""] ?? []),
  "/param_dependent_dropdown": ({ query }) =>
    markdown(`Country: **${query.get("country") || "none"}**, city: **${query.get("city") || "none"}**.`),
  "/param_rows": ({ query }) => {
    const region = query.get("region") ?? "americas";
    const note = query.get("note") ?? "";
    const text = `${DATA.regionSummaries[region] ?? region}\n\n${holdingsList(integer(query.get("count"), 2))}`;
    return markdown(text + (note ? `\n\n> ${note}` : ""));
  },
  "/param_header": ({ headers }) => markdown(`The \`X-Desk\` header says **${headers["x-desk"] || "nothing"}**.`),

  // Widget settings
  "/setting_stale_time": () => settingsWidget("Stale time: one minute"),
  "/setting_refetch_interval": () => settingsWidget("Refetch interval: 15 seconds"),
  "/setting_cron_refetch": () => settingsWidget("Refetch schedule: every five minutes"),
  "/setting_data_update_display": () => settingsWidget("Data changes at 9:00 on weekdays"),
  "/setting_run_button": () => settingsWidget("Fetched when you select Run"),

  // Linked widgets
  "/company_profile": ({ query }) => {
    const c = companyOr404(query.get("company") ?? "alder");
    return markdown(
      `## ${c.name}\n\n${c.summary}\n\n` +
        `- Sector: ${c.sector}\n- Founded: ${c.founded}\n- Headquarters: ${c.headquarters}`,
    );
  },
  "/company_performance": ({ query }) => {
    const company = companyOr404(query.get("company") ?? "alder");
    if (flag(query.get("raw"))) return json(company.performance);
    const rows = company.performance.map((row) => [row.year, row.revenue, row.growth]);
    return page(query.get("theme") ?? "dark", `<h3>${company.name}</h3>` + table(["Year", "Revenue ($M)", "Growth"], rows));
  },

  // Forms
  "/client_entries": () => {
    if (clients.length === 0) return markdown("No clients yet. Fill in the form and select **Add client**.");
    const rows = clients
      .map((c) => `| ${c.first_name} ${c.last_name} | ${c.investment_types} | ${c.risk_profile} |`)
      .join("\n");
    return markdown(`| Client | Investment types | Risk profile |\n|---|---|---|\n${rows}`);
  },
};

const post: Record<string, Handler> = {
  "/param_body": ({ body }) => {
    const limit = Number.parseInt(String(body.limit ?? 0), 10);
    return markdown(`POST body: region **${body.region ?? ""}**, limit **${limit}**.\n\n${holdingsList(limit)}`);
  },
  "/client_form": ({ body }) => {
    if (!body.first_name || !body.last_name) return json({ detail: "First name and last name are required." }, 400);
    const types = body.investment_types ?? [];
    clients.push({
      first_name: String(body.first_name),
      last_name: String(body.last_name),
      investment_types: Array.isArray(types) ? types.join(", ") : String(types),
      risk_profile: String(body.risk_profile ?? ""),
    });
    return json({ success: true });
  },
};

// Routes with a placeholder in their path
const patterns: [RegExp, Handler][] = [
  [
    /^\/assets\/([^/]+)$/,
    ({ path: [name] }) => {
      if (!(name in ASSETS)) throw new HttpError(404, "Not Found");
      return file(name);
    },
  ],
  [
    /^\/regions\/([^/]+)\/summary$/,
    ({ path: [region] }) => {
      if (!REGIONS.has(region)) throw new HttpError(404, `Unknown region: ${region}`);
      return markdown(`Path parameter: \`${region}\`\n\n${DATA.regionSummaries[region]}`);
    },
  ],
];

function settingsWidget(name: string): Reply {
  return markdown(`**${name}**\n\nFetched at ${fetchedAt()} UTC.`);
}

function route(method: string, pathname: string): [Handler, string[]] | number {
  const table = method === "POST" ? post : method === "GET" ? get : null;
  if (table && Object.hasOwn(table, pathname)) return [table[pathname], []];
  if (Object.hasOwn(get, pathname) || Object.hasOwn(post, pathname)) return 405;
  for (const [pattern, handler] of patterns) {
    const match = pattern.exec(pathname);
    if (match) return method === "GET" ? [handler, match.slice(1).map(decodeURIComponent)] : 405;
  }
  return 404;
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString());
  return typeof parsed === "object" && parsed !== null ? parsed : {};
}

function send(response: ServerResponse, reply: Reply) {
  response.writeHead(reply.status ?? 200, { "Content-Type": reply.type }).end(reply.body);
}

createServer(async (request, response) => {
  if (request.headers.origin === APP_ORIGIN) {
    response.setHeader("Access-Control-Allow-Origin", APP_ORIGIN);
    response.setHeader("Vary", "Origin");
  }
  if (request.method === "OPTIONS") {
    response.setHeader("Access-Control-Allow-Methods", "GET, POST");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Desk");
    return response.writeHead(204).end();
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `localhost:${PORT}`}`);
  const found = route(request.method ?? "GET", url.pathname);
  if (typeof found === "number") {
    return send(response, json({ detail: found === 405 ? "Method Not Allowed" : "Not Found" }, found));
  }

  try {
    const [handler, path] = found;
    const body = request.method === "POST" ? await readBody(request) : {};
    send(response, handler({ query: url.searchParams, headers: request.headers, body, base: url.origin, path }));
  } catch (error) {
    if (error instanceof HttpError) return send(response, json({ detail: error.message }, error.status));
    if (error instanceof SyntaxError) return send(response, json({ detail: "The body is not valid JSON." }, 400));
    throw error;
  }
}).listen(PORT, () => console.log(`Reference backend on http://localhost:${PORT}`));
