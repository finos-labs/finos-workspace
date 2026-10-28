import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
    { page: "docs/plugins/reference/commands-and-permissions.mdx", what: "host commands", tokens: commands.map((name) => `\`${name}\``) },
    { page: "docs/plugins/reference/module-contract.mdx", what: "default traits", tokens: plugins.traits.map((name) => `| \`${name}\` |`) },
    {
      page: "docs/plugins/reference/package-and-manifest.mdx",
      what: "host versions in the example manifest",
      tokens: [`"host": { "api": ${values["host.api"]}, "afm": "${values["host.afm"]}" }`],
    },
    {
      page: "docs/plugins/build-your-first-widget-plugin.md",
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
