import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import type { CssStats, TokenUsage } from "../../src/data/types.ts";
import type { ParsedCss } from "./css.mts";
import { fromRepo, repoRelative } from "./paths.mts";

const TAILWIND_CONFIG = "frontend/tailwind.config.ts";
const SOURCE_DIR = "frontend/src";
const PREFIXES =
  "bg|text|border|border-[xytrbl]|ring|ring-offset|outline|fill|stroke|divide|placeholder|shadow|from|via|to|caret|accent|decoration";
const MAX_CLASSES = 6;
const MAX_FILES = 3;

interface Tree {
  [key: string]: Tree | string;
}

interface SourceFile {
  path: string;
  name: string;
  text: string;
}

interface UtilityUse {
  uses: number;
  files: Map<string, number>;
  prefixes: Map<string, number>;
}

function skipSpace(text: string, start: number): number {
  let index = start;
  while (index < text.length && /\s/.test(text[index] as string)) index++;
  return index;
}

function parseString(text: string, start: number): [string, number] {
  const quote = text[start] as string;
  let index = start + 1;
  let value = "";
  while (text[index] !== quote) {
    if (text[index] === "\\") index++;
    value += text[index];
    index++;
  }
  return [value, index + 1];
}

function skipExpression(text: string, start: number): number {
  let index = start;
  let depth = 0;
  while (index < text.length) {
    const char = text[index] as string;
    if (char === '"' || char === "'" || char === "`") {
      index = parseString(text, index)[1];
      continue;
    }
    if (depth === 0 && (char === "," || char === "}")) return index;
    if ("([{".includes(char)) depth++;
    if (")]}".includes(char)) depth--;
    index++;
  }
  return index;
}

function parseObject(text: string, start: number): [Tree, number] {
  const tree: Tree = {};
  let index = start + 1;
  for (;;) {
    index = skipSpace(text, index);
    const char = text[index] as string;
    if (char === "}") return [tree, index + 1];
    if (char === ",") {
      index++;
      continue;
    }
    if (text.startsWith("...", index)) {
      index = skipExpression(text, index);
      continue;
    }
    let key: string;
    if (char === '"' || char === "'") [key, index] = parseString(text, index);
    else {
      const match = /^(?:[A-Za-z_$][\w$]*|\d+)/.exec(text.slice(index));
      if (match === null) throw new Error(`Unexpected ${char} at ${index}`);
      key = match[0];
      index += key.length;
    }
    index = skipSpace(text, index);
    if (text[index] !== ":") throw new Error(`Expected : after ${key}`);
    index = skipSpace(text, index + 1);
    const first = text[index] as string;
    if (first === "{") {
      const [value, next] = parseObject(text, index);
      tree[key] = value;
      index = next;
    } else if (first === '"' || first === "'" || first === "`") {
      const [value, next] = parseString(text, index);
      tree[key] = value;
      index = next;
    } else {
      index = skipExpression(text, index);
    }
  }
}

function flatten(tree: Tree, path: string[], found: Map<string, string>): void {
  for (const [key, value] of Object.entries(tree)) {
    const next = key === "DEFAULT" ? path : [...path, key];
    if (typeof value === "string") {
      const match = /var\((--[\w-]+)/.exec(value);
      if (match !== null) found.set(next.join("-"), match[1] as string);
    } else {
      flatten(value, next, found);
    }
  }
}

function tailwindColours(): Map<string, string> {
  const text = readFileSync(fromRepo(TAILWIND_CONFIG), "utf8");
  const start = text.indexOf("colors: {");
  const [tree] = parseObject(text, text.indexOf("{", start));
  const found = new Map<string, string>();
  flatten(tree, [], found);
  return found;
}

function sourceFiles(directory: string): SourceFile[] {
  const found: SourceFile[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (/\.(ts|tsx|css)$/.test(entry.name) && !/\.(test|stories|d)\./.test(entry.name)) {
      found.push({
        path: repoRelative(path),
        name: repoRelative(path).replace(/^frontend\/src\//, "").replace(/\.tsx?$/, ""),
        text: readFileSync(path, "utf8"),
      });
    }
  }
  return found;
}

function cssReferences(files: SourceFile[], counts: Map<string, number>): void {
  for (const file of files) {
    if (!file.path.endsWith(".css")) continue;
    postcss.parse(file.text).walkDecls((declaration) => {
      if (declaration.prop.startsWith("--")) return;
      for (const match of declaration.value.matchAll(/var\((--[\w-]+)/g)) {
        const name = match[1] as string;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    });
  }
}

function configReferences(counts: Map<string, number>): void {
  const text = readFileSync(fromRepo(TAILWIND_CONFIG), "utf8");
  const start = text.indexOf("colors: {");
  const [, end] = parseObject(text, text.indexOf("{", start));
  const outside = text.slice(0, start) + text.slice(end);
  for (const match of outside.matchAll(/var\((--[\w-]+)/g)) {
    const name = match[1] as string;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countUtility(name: string, files: SourceFile[]): UtilityUse {
  const pattern = new RegExp(`(?<![A-Za-z0-9_-])(${PREFIXES})-${escape(name)}(?![A-Za-z0-9_-])`, "g");
  const use: UtilityUse = { uses: 0, files: new Map(), prefixes: new Map() };
  for (const file of files) {
    if (!file.text.includes(name)) continue;
    for (const match of file.text.matchAll(pattern)) {
      use.uses++;
      use.files.set(file.name, (use.files.get(file.name) ?? 0) + 1);
      const prefix = match[1] as string;
      use.prefixes.set(prefix, (use.prefixes.get(prefix) ?? 0) + 1);
    }
  }
  return use;
}

function topNames(counts: Map<string, number>, limit: number): string[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

export function addUsage(css: ParsedCss): { stats: CssStats } {
  const files = sourceFiles(fromRepo(SOURCE_DIR));
  const utilities = tailwindColours();
  for (const file of css.tokenFiles) {
    if (!file.file.endsWith("styles/tokens.css")) continue;
    for (const token of file.tokens) {
      const match = /^--color-([a-z]+(?:-[a-z]+)?-\d+)$/.exec(token.name);
      if (match !== null) utilities.set(match[1] as string, token.name);
    }
  }
  const uses = new Map<string, UtilityUse>();
  for (const name of utilities.keys()) uses.set(name, countUtility(name, files));

  const byProperty = new Map<string, string[]>();
  for (const [name, property] of utilities) {
    if (!byProperty.has(property)) byProperty.set(property, []);
    byProperty.get(property)?.push(name);
  }

  const declared = css.tokenFiles.flatMap((file) => file.tokens);
  const aliases = new Map<string, Set<string>>();
  for (const token of declared) {
    for (const value of [token.light, token.dark, token.forceLight]) {
      for (const match of (value ?? "").matchAll(/var\((--[\w-]+)/g)) {
        const target = match[1] as string;
        if (!aliases.has(target)) aliases.set(target, new Set());
        aliases.get(target)?.add(token.name);
      }
    }
  }

  const references = new Map<string, number>();
  cssReferences(files, references);
  configReferences(references);
  for (const token of declared) {
    const names = byProperty.get(token.name) ?? [];
    const fileCounts = new Map<string, number>();
    const classCounts = new Map<string, number>();
    let total = 0;
    for (const name of names) {
      const use = uses.get(name) as UtilityUse;
      total += use.uses;
      for (const [file, count] of use.files) fileCounts.set(file, (fileCounts.get(file) ?? 0) + count);
      for (const [prefix, count] of use.prefixes) classCounts.set(`${prefix}-${name}`, count);
    }
    let direct = references.get(token.name) ?? 0;
    const reference = `var(${token.name}`;
    for (const file of files) {
      if (file.path.endsWith(".css") || !file.text.includes(reference)) continue;
      direct += file.text.split(reference).length - 1;
    }
    const usage: TokenUsage = {
      classes: topNames(classCounts, MAX_CLASSES),
      uses: total,
      files: fileCounts.size,
      top: topNames(fileCounts, MAX_FILES),
      direct,
      aliasedBy: aliases.get(token.name)?.size ?? 0,
    };
    token.usage = usage;
  }

  for (const utility of css.utilities) {
    if (!utility.name.startsWith("ws-")) continue;
    const pattern = new RegExp(`(?<![\\w-])(?<!@utility )${escape(utility.name)}(?![\\w-])`, "g");
    const fileCounts = new Map<string, number>();
    let total = 0;
    for (const file of files) {
      if (!file.text.includes(utility.name)) continue;
      const count = (file.text.match(pattern) ?? []).length;
      if (count === 0) continue;
      total += count;
      fileCounts.set(file.name, count);
    }
    utility.uses = total;
    utility.files = fileCounts.size;
    utility.top = topNames(fileCounts, MAX_FILES);
  }

  let variableUses = 0;
  const variableFilesSeen = new Set<string>();
  for (const use of uses.values()) {
    variableUses += use.uses;
    for (const file of use.files.keys()) variableFilesSeen.add(file);
  }

  const builtIn = new RegExp(
    `(?<![A-Za-z0-9_-])(?:${PREFIXES})-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3})(?![A-Za-z0-9_-])`,
    "g",
  );
  let builtInUses = 0;
  const builtInFilesSeen = new Set<string>();
  for (const file of files) {
    const count = (file.text.match(builtIn) ?? []).length;
    if (count === 0) continue;
    builtInUses += count;
    builtInFilesSeen.add(file.name);
  }

  const stats: CssStats = {
    variableUtilities: utilities.size,
    variableUses,
    variableFiles: variableFilesSeen.size,
    builtInUses,
    builtInFiles: builtInFilesSeen.size,
  };
  return { stats };
}
