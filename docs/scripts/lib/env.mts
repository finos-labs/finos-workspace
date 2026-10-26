import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EnvData, EnvEntry, EnvExample, ProcessEnvEntry } from "../../src/data/types.ts";
import { fromRepo, repoRelative } from "./paths.mts";

const BACKEND_EXAMPLE = "backend-api/backend/envs/.env.example";
const AGENT_EXAMPLE = "agent/.env.example";
const AGENT_SOURCES = ["agent/src", "agent/mcp-server/src"];

const KEY_LINE = /^(# )?([A-Z][A-Z0-9_]*)=(.*)$/;
const HASH_SECTION = /^###\s*(.+?)\s*###$/;
const DASH_SECTION = /^#\s*---\s*(.+?)\s*---$/;
const RULE_SECTION = /^#\s*─+\s*(.*?)\s*[─�]*$/;

function parseExample(file: string): EnvExample {
  const lines = readFileSync(fromRepo(file), "utf8").split("\n");
  const entries: EnvEntry[] = [];
  let section = "";
  let sub = "";
  let comments: string[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === "") {
      comments = [];
      continue;
    }
    const hash = HASH_SECTION.exec(line);
    if (hash) {
      comments = [];
      sub = "";
      section = /\bEND$/.test(hash[1] as string) ? "" : (hash[1] as string);
      continue;
    }
    const dash = DASH_SECTION.exec(line);
    if (dash) {
      comments = [];
      sub = dash[1] as string;
      continue;
    }
    const rule = line.startsWith("# ─") ? RULE_SECTION.exec(line) : null;
    if (rule) {
      comments = [];
      sub = "";
      section = rule[1] as string;
      continue;
    }
    const key = KEY_LINE.exec(line);
    if (key) {
      const [value, ...inline] = (key[3] as string).split(/\s+#\s+/);
      const description = [...comments, ...inline].join(" ").replace(/\s+/g, " ").trim();
      entries.push({
        name: key[2] as string,
        example: (value as string).trim(),
        commented: key[1] !== undefined,
        description,
        section: [section, sub].filter(Boolean).join(" / "),
      });
      comments = [];
      continue;
    }
    if (line.startsWith("#")) comments.push(line.replace(/^#\s?/, ""));
  }
  return { file, entries };
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

function processEnv(example: EnvExample): ProcessEnvEntry[] {
  const found = new Map<string, Set<string>>();
  for (const directory of AGENT_SOURCES) {
    for (const path of sourceFiles(fromRepo(directory))) {
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[["']([A-Z][A-Z0-9_]*)["']\])/g)) {
        const name = (match[1] ?? match[2]) as string;
        if (!found.has(name)) found.set(name, new Set());
        (found.get(name) as Set<string>).add(repoRelative(path));
      }
    }
  }
  const described = new Map(example.entries.map((entry) => [entry.name, entry]));
  return [...found.entries()]
    .map(([name, files]) => ({
      name,
      files: [...files].sort(),
      description: described.get(name)?.description ?? "",
      inExample: described.has(name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function collectEnv(): EnvData {
  const agent = parseExample(AGENT_EXAMPLE);
  return { backend: parseExample(BACKEND_EXAMPLE), agent, agentProcessEnv: processEnv(agent) };
}
