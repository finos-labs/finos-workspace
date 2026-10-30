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
