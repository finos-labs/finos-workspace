import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { AgentData, ApiData, BridgeData, PluginsData } from "../../src/data/types.ts";
import { fromRepo } from "./paths.mts";

interface Requirement {
  page: string;
  what: string;
  tokens: string[];
}

function requirements(plugins: PluginsData, agent: AgentData): Requirement[] {
  const commands = plugins.permissions.flatMap((permission) => (permission.command === null ? [] : [permission.command]));
  const values = plugins.values;
  return [
    { page: "docs/reference/plugins/commands-and-permissions.mdx", what: "host commands", tokens: commands.map((name) => `\`${name}\``) },
    {
      page: "docs/reference/plugins/package-and-manifest.mdx",
      what: "host versions in the example manifest",
      tokens: [`"host": { "api": ${values["host.api"]}, "afm": "${values["host.afm"]}" }`],
    },
    {
      page: "docs/tutorials/plugins/build-your-first-widget-plugin.md",
      what: "host versions in the manifest that the lesson writes",
      tokens: [`"host": { "api": ${values["host.api"]}, "afm": "${values["host.afm"]}" }`],
    },
    { page: "docs/reference/protocols/ines-tool-results.mdx", what: "typed result kinds", tokens: agent.protocol.typedResults.kinds.map((kind) => `| \`${kind}\` |`) },
  ];
}

export function checkCoverage(plugins: PluginsData, agent: AgentData): void {
  const missing: string[] = [];
  for (const requirement of requirements(plugins, agent)) {
    const text = readFileSync(fromRepo(requirement.page), "utf8");
    for (const token of requirement.tokens) {
      if (!text.includes(token)) missing.push(`${requirement.page} does not mention ${requirement.what}: ${token}`);
    }
  }
  if (missing.length > 0) throw new Error(`The hand-written pages are out of step with the code:\n${missing.join("\n")}`);
}

interface KnownRoute {
  method: string;
  path: string;
}

const DOCS = "docs";
const SERVED_BY_EXAMPLES = [{ path: "/.workspace/health", source: "docs/examples/sql-explorer/backend/server.py" }];
const NAMED_FOR_OTHER_SYSTEMS = [{ method: "POST", path: "/v1/traces", source: "agent/src/lib/telemetry.ts" }];
const SKIPPED = new Set(["examples"]);

function pages(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return SKIPPED.has(name) ? [] : pages(path);
    return /\.mdx?$/.test(name) ? [path] : [];
  });
}

function shape(path: string): string {
  return path
    .replace(/[?#].*$/, "")
    .replace(/\{[^}]*\}|<[^>]*>/g, "{}")
    .replace(/\/+$/, "");
}

export function checkRoutes(api: ApiData, agent: AgentData, bridge: BridgeData, plugins: PluginsData): void {
  const known: KnownRoute[] = [
    { method: "GET", path: "/metrics" },
    { method: "GET", path: String(plugins.values["backend.identityPath"]) },
    { method: "POST", path: `${plugins.values["backend.routePathPrefix"]}{route}` },
    ...api.tags.flatMap((tag) => tag.operations.map((operation) => ({ method: operation.method, path: operation.path }))),
    ...agent.http.routes.map((route) => ({ method: route.method, path: route.path })),
    ...agent.mcp.routes.map((route) => ({ method: route.method, path: route.path })),
    { method: "GET", path: String(bridge.values["constants.webSocketPath"]) },
  ];
  for (const example of SERVED_BY_EXAMPLES) {
    if (!readFileSync(fromRepo(example.source), "utf8").includes(example.path)) {
      throw new Error(`${example.source} no longer serves ${example.path}, which the pages name`);
    }
    known.push({ method: "GET", path: example.path });
  }
  for (const other of NAMED_FOR_OTHER_SYSTEMS) {
    if (!readFileSync(fromRepo(other.source), "utf8").includes(other.path)) {
      throw new Error(`${other.source} no longer uses ${other.path}, which the pages name`);
    }
    known.push({ method: other.method, path: other.path });
  }
  const shapes = new Set(known.map((route) => `${route.method} ${shape(route.path)}`));
  const paths = new Set(known.map((route) => shape(route.path)));
  const roots = new Set(known.map((route) => route.path.split("/")[1]));
  const families = new Set(known.flatMap((route) => route.path.split("/").slice(1).map((_, index, parts) => `/${parts.slice(0, index + 1).join("/")}`)).map(shape));
  const candidate = /`(?:(GET|POST|PUT|PATCH|DELETE) )?(\/[A-Za-z0-9_{}<>:.\/-]+)(?:\?[^`\s]*)?`/g;
  const unknown: string[] = [];
  for (const page of pages(fromRepo(DOCS))) {
    for (const match of readFileSync(page, "utf8").matchAll(candidate)) {
      const [, method, written] = match;
      const path = written.replace(/\/\.\.\.$/, "");
      const root = path.split("/")[1];
      if (!method && !roots.has(root)) continue;
      if (families.has(shape(path)) && (!method || path !== written)) continue;
      const found = method ? shapes.has(`${method} ${shape(path)}`) : paths.has(shape(path));
      if (!found) unknown.push(`${page.slice(fromRepo(DOCS).length - DOCS.length)}: ${method ? `${method} ` : ""}${path}`);
    }
  }
  if (unknown.length > 0) throw new Error(`The pages name routes that the code does not have:\n${[...new Set(unknown)].join("\n")}`);
}

const NOT_SEARCHED = new Set([".git", "node_modules", "build", "reference-data", "generated", ".docusaurus"]);

function filesOf(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (NOT_SEARCHED.has(name)) return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesOf(path) : [path];
  });
}

const ON_ANOTHER_BRANCH = new Set(["docs/examples/backend/tests/test_isolation.py"]);

export function checkAbuseCases(): void {
  const page = readFileSync(fromRepo("docs/reference/plugins/abuse-cases.mdx"), "utf8");
  const root = fromRepo(".");
  const files = filesOf(root);
  const problems: string[] = [];
  for (const row of page.split("\n").filter((line) => line.startsWith("|") && !line.startsWith("| Abuse") && !line.startsWith("|---"))) {
    const cell = row.split(" | ").at(-1) ?? "";
    const named = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string).filter((name) => /\.[a-z]+$/.test(name));
    const titles = [...cell.replace(/`[^`]*`/g, "").matchAll(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g)].map((match) => match[0]);
    const found = named.map((name) => files.filter((file) => file === join(root, name) || file.endsWith(`/${name}`)));
    named.forEach((name, index) => {
      if (!ON_ANOTHER_BRANCH.has(name) && (found[index] ?? []).length === 0) problems.push(`The abuse case "${row.slice(2, 50)}" names ${name}, which does not exist`);
    });
    for (const title of titles) {
      const sources = found.flat().filter((file) => readFileSync(file, "utf8").includes(`"${title}"`));
      if (sources.length === 0) problems.push(`The abuse case "${row.slice(2, 50)}" names the test ${title}, which is in none of its files`);
    }
  }
  if (problems.length > 0) throw new Error(`abuse-cases.mdx is out of step with the tests:\n${problems.join("\n")}`);
}

export function checkSettingNames(known: Set<string>, pages: string[]): void {
  const problems: string[] = [];
  for (const page of pages) {
    const text = readFileSync(fromRepo(page), "utf8");
    for (const match of text.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)`/g)) {
      const name = match[1] as string;
      if (name.length > 3 && !known.has(name)) problems.push(`${page} names the setting ${name}, which no component defines`);
    }
  }
  if (problems.length > 0) throw new Error(`The hand-written pages name settings that do not exist:\n${[...new Set(problems)].join("\n")}`);
}

const LISTINGS = [
  {
    page: "docs/tutorials/agents/let-your-agent-read-the-dashboard.mdx",
    files: ["docs/examples/reference-agent/python/main.py", "docs/examples/reference-agent/typescript/main.ts"],
  },
];

export function checkExampleListings(): void {
  const problems: string[] = [];
  for (const { page, files } of LISTINGS) {
    const text = readFileSync(fromRepo(page), "utf8");
    for (const file of files) {
      if (!text.includes(readFileSync(fromRepo(file), "utf8").trimEnd())) problems.push(`${page} does not show ${file} as it is`);
    }
  }
  if (problems.length > 0) throw new Error(`A tutorial shows code that differs from the example that its test runs:\n${problems.join("\n")}`);
}

interface LinkRule {
  term: string;
  pattern: RegExp;
  pages: string[];
  only?: string;
  except?: string;
}

const REFERENCE = "docs/reference/";
const LINK_RULES: LinkRule[] = [
  { term: "widgets.json", pattern: /widgets\.json/, pages: [`${REFERENCE}schemas/widgets-json.mdx`] },
  { term: "apps.json", pattern: /apps\.json/, pages: [`${REFERENCE}schemas/apps-json.mdx`] },
  { term: "plugin.json", pattern: /plugin\.json/, pages: [`${REFERENCE}schemas/plugin-json.mdx`, `${REFERENCE}plugins/package-and-manifest.mdx`] },
  { term: "agents.json", pattern: /agents\.json/, pages: [`${REFERENCE}schemas/agents-json.mdx`] },
  { term: "the MCP tool link", pattern: /(?<![.\w])mcp_tool(?!\w)|MCP tool link/, pages: [`${REFERENCE}protocols/mcp-tool-link.md`] },
  { term: "raw rows", pattern: /rawDataKey|rawType|`raw`|"raw": true/, pages: [`${REFERENCE}protocols/raw-rows.md`], only: "docs/tutorials/build-a-backend/" },
  { term: "the iframe widget protocol", pattern: /workspace-connect|workspace-auth|postMessage|iframe protocol|iframe widget protocol/, pages: [`${REFERENCE}protocols/iframe-widget.mdx`] },
  { term: "the plugin frame protocol", pattern: /(?<!i)frame protocol|plugin frame/, pages: [`${REFERENCE}protocols/plugin-frame.mdx`] },
  { term: "the FINOS Workspace bridge", pattern: /workspace bridge|bridge protocol|workspace-bridge/i, pages: [`${REFERENCE}protocols/workspace-bridge.mdx`] },
  {
    term: "the agent query protocol",
    pattern: /query protocol|copilot(?:MessageChunk|FunctionCall|StatusUpdate)|\/v1\/query|get_widget_data/,
    pages: [`${REFERENCE}protocols/ines-query.mdx`, `${REFERENCE}protocols/ines-widget-data.mdx`],
  },
  { term: "widget requests", pattern: /optionsMethod|"in": "(?:header|body)"/, pages: [`${REFERENCE}protocols/widget-requests.mdx`] },
  { term: "typed results", pattern: /typed results?/, pages: [`${REFERENCE}protocols/ines-tool-results.mdx`], except: "docs/tutorials/contribute/" },
  { term: "the module contract", pattern: /module contract/, pages: [`${REFERENCE}plugins/module-contract.mdx`] },
  { term: "plugin permissions", pattern: /`core:[a-z]+(?::[a-z]+)*`/, pages: [`${REFERENCE}plugins/commands-and-permissions.mdx`] },
  { term: "the frame policy", pattern: /frame policy|content security policy/, pages: [`${REFERENCE}plugins/frame-policy.mdx`] },
  {
    term: "plugin proxies",
    pattern: /\bproxies\b|(?<!egress )(?<!forward )(?<!reverse )\bproxy\b/,
    pages: [`${REFERENCE}plugins/proxies.mdx`],
    only: "docs/tutorials/plugins/",
  },
];

function linksOf(prose: string, page: string): Set<string> {
  const found = new Set<string>();
  for (const match of prose.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    const target = match[1] as string;
    if (!/^(?:https?:|mailto:|\/)/.test(target)) found.add(relative(fromRepo("."), resolve(dirname(page), target)));
  }
  return found;
}

export function checkReferenceLinks(): void {
  const problems: string[] = [];
  for (const page of pages(fromRepo("docs/tutorials"))) {
    const name = relative(fromRepo("."), page);
    const prose = readFileSync(page, "utf8")
      .replace(/^---\n[\s\S]*?\n---\n/, "")
      .replace(/```[\s\S]*?```/g, "");
    const linked = linksOf(prose, page);
    for (const rule of LINK_RULES) {
      if ((rule.only && !name.startsWith(rule.only)) || (rule.except && name.startsWith(rule.except))) continue;
      if (rule.pattern.test(prose) && !rule.pages.some((target) => linked.has(target))) {
        problems.push(`${name} names ${rule.term} and does not link ${rule.pages[0]}`);
      }
    }
  }
  if (problems.length > 0) throw new Error(`Tutorials name a protocol or a schema without a link to its reference page:\n${problems.join("\n")}`);
}
