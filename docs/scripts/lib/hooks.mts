import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DataAttribute, HookEntry, HooksData } from "../../src/data/types.ts";
import { fromRepo, repoRelative } from "./paths.mts";

const SOURCE_DIR = "frontend/src";
const SVG_TAGS = new Set([
  "svg",
  "symbol",
  "path",
  "g",
  "defs",
  "linearGradient",
  "radialGradient",
  "clipPath",
  "mask",
  "circle",
  "rect",
  "use",
  "stop",
  "filter",
  "pattern",
  "line",
  "polygon",
  "polyline",
  "ellipse",
  "text",
  "tspan",
  "title",
  "desc",
]);

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories)\./.test(entry.name)) found.push(path);
  }
  return found;
}

function add(map: Map<string, Set<string>>, value: string, file: string): void {
  if (!map.has(value)) map.set(value, new Set());
  (map.get(value) as Set<string>).add(file);
}

function entries(map: Map<string, Set<string>>): HookEntry[] {
  return [...map.entries()]
    .map(([value, files]) => ({ value, files: [...files].sort() }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

export function collectHooks(): HooksData {
  const testIds = new Map<string, Set<string>>();
  const ids = new Map<string, Set<string>>();
  const attributes = new Map<string, number>();

  for (const path of sourceFiles(fromRepo(SOURCE_DIR))) {
    const text = readFileSync(path, "utf8");
    const file = repoRelative(path);
    for (const match of text.matchAll(/data-testid=(?:"([^"{}$]+)"|\{"([^"{}$]+)"\}|\{'([^'{}$]+)'\})/g)) {
      add(testIds, (match[1] ?? match[2] ?? match[3]) as string, file);
    }
    for (const match of text.matchAll(/\sid="([A-Za-z][\w:.-]*)"/g)) {
      const before = text.slice(Math.max(0, (match.index ?? 0) - 600), match.index);
      const open = before.lastIndexOf("<");
      const tag = /^<([A-Za-z][\w.]*)/.exec(before.slice(open))?.[1];
      if (tag !== undefined && SVG_TAGS.has(tag)) continue;
      add(ids, match[1] as string, file);
    }
    for (const match of text.matchAll(/\b(data-(?!testid\b)[a-z][a-z0-9-]*)=/g)) {
      const name = match[1] as string;
      attributes.set(name, (attributes.get(name) ?? 0) + 1);
    }
  }

  const dataAttributes: DataAttribute[] = [...attributes.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { testIds: entries(testIds), ids: entries(ids), dataAttributes };
}
