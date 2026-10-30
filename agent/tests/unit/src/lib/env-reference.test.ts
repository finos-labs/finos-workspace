import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "expect";
import { EMBEDDING_PROVIDER_NAMES } from "../../../../mcp-server/src/tools/backend/documents/retrieve.ts";
import { ENV_REFERENCE } from "../../../../src/lib/env-reference.ts";
import { TRANSCRIBE_PROVIDER_NAMES } from "../../../../src/lib/transcribe.ts";

const AGENT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SOURCES = ["src", "mcp-server/src"];
const NOT_CONFIGURATION = new Set(["PATH"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const NAME = "([A-Z][A-Z0-9_]*)";
const READS = [
  new RegExp(`process\\.env\\.${NAME}`, "g"),
  new RegExp(`process\\.env\\[["']${NAME}["']\\]`, "g"),
  new RegExp(`(?<![.\\w])env\\.${NAME}`, "g"),
  new RegExp(`\\(env, *"${NAME}"`, "g"),
  new RegExp(`keyEnv: *"${NAME}"`, "g"),
];

function namesRead(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const directory of SOURCES) {
    for (const path of sourceFiles(join(AGENT, directory))) {
      const text = readFileSync(path, "utf8");
      for (const pattern of READS) {
        for (const match of text.matchAll(pattern)) {
          const name = match[1] as string;
          if (NOT_CONFIGURATION.has(name)) continue;
          if (!found.has(name)) found.set(name, new Set());
          (found.get(name) as Set<string>).add(path.slice(AGENT.length + 1));
        }
      }
    }
  }
  return found;
}

describe("the environment reference", () => {
  const names = ENV_REFERENCE.map((entry) => entry.name);

  it("names each variable once", () => {
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => !/^[A-Z][A-Z0-9_]*$/.test(name))).toEqual([]);
  });

  it("describes each variable in sentences", () => {
    const problems = ENV_REFERENCE.filter(
      (entry) =>
        entry.description.trim() === "" ||
        !entry.description.trimEnd().endsWith(".") ||
        entry.group === "" ||
        entry.readBy.length === 0,
    ).map((entry) => entry.name);
    expect(problems).toEqual([]);
  });

  it("lists the values of each variable that takes one of a few", () => {
    const problems = ENV_REFERENCE.filter((entry) => {
      const enumerated = entry.type === "enum" ? (entry.choices?.length ?? 0) > 1 : entry.choices === null;
      const modelled = entry.type.startsWith("model") ? (entry.providers?.length ?? 0) > 0 : entry.providers === null;
      return !(enumerated && modelled);
    }).map((entry) => entry.name);
    expect(problems).toEqual([]);
  });

  it("is what the code reads, no less and no more", () => {
    const read = namesRead();
    const missing = [...read.keys()].filter((name) => !names.includes(name));
    const unread = names.filter((name) => !read.has(name));
    expect({ missing, unread }).toEqual({ missing: [], unread: [] });
  });

  it("says which process reads each variable", () => {
    const read = namesRead();
    const problems = ENV_REFERENCE.filter((entry) => {
      const files = [...(read.get(entry.name) ?? [])];
      const inServer = files.some((file) => file.startsWith("mcp-server/"));
      const outside = files.some((file) => !file.startsWith("mcp-server/"));
      const onlyServer = entry.readBy.length === 1 && entry.readBy[0] === "mcp-server";
      return (inServer && !entry.readBy.includes("mcp-server")) || (onlyServer && outside);
    }).map((entry) => entry.name);
    expect(problems).toEqual([]);
  });

  it("names the providers that the code has", () => {
    const providers = (name: string) => ENV_REFERENCE.find((entry) => entry.name === name)?.providers;
    const registered = [...readFileSync(join(AGENT, "src/lib/providers.ts"), "utf8").matchAll(/prefix: "([a-z]+)"/g)].map(
      (match) => match[1],
    );
    expect(providers("DEFAULT_MODEL")).toEqual(registered);
    expect(providers("AGENT_MODELS")).toEqual(registered);
    expect(providers("AGENT_TRANSCRIBE_MODEL")).toEqual(TRANSCRIBE_PROVIDER_NAMES);
    expect(providers("AGENT_EMBED_MODEL")).toEqual(EMBEDDING_PROVIDER_NAMES);
  });
});
