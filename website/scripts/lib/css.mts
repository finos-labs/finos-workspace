import { readFileSync } from "node:fs";
import postcss, { type AtRule, type Container, type Rule } from "postcss";
import type { CssData, FontFace, Selector, Token, TokenFile, Utility } from "../../src/data/types.ts";
import { fromRepo } from "./paths.mts";

const TOKEN_FILES = [
  "frontend/src/styles/tokens.css",
  "frontend/src/index.css",
  "frontend/src/components/AI/tritanopia-dark.css",
];
const SELECTOR_FILES = [
  "frontend/src/index.css",
  "frontend/src/admin.css",
  "frontend/src/components/AI/tritanopia-dark.css",
];
const REPORT_FILE = "agent/src/skills/html-report.md";
const BASE_FILES = ["frontend/src/styles/tokens.css", "frontend/src/index.css"];

type Scope = "light" | "dark" | "forceLight";

const SCOPES: Record<string, Scope> = {
  ":root": "light",
  ".dark": "dark",
  ".dark:root": "dark",
  ".force-light": "forceLight",
};

interface Collected {
  selectors: Selector[];
  utilities: Utility[];
  keyframes: { file: string; name: string }[];
  fontFaces: FontFace[];
  tokens: Record<Scope, Map<string, string>> | null;
  order: string[];
}

function emptyCollected(withTokens: boolean): Collected {
  return {
    selectors: [],
    utilities: [],
    keyframes: [],
    fontFaces: [],
    tokens: withTokens ? { light: new Map(), dark: new Map(), forceLight: new Map() } : null,
    order: [],
  };
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function declarationLines(container: Container, skipCustom: boolean): string[] {
  const lines: string[] = [];
  for (const node of container.nodes ?? []) {
    if (node.type === "decl") {
      if (skipCustom && node.prop.startsWith("--")) continue;
      lines.push(`${node.prop}: ${clean(node.value)}${node.important ? " !important" : ""}`);
    }
    if (node.type === "atrule" && node.name === "apply") lines.push(`@apply ${clean(node.params)}`);
  }
  return lines;
}

function resolveSelector(selector: string, parent: string | null): string {
  const text = clean(selector);
  if (parent === null) return text;
  return text.includes("&") ? text.split("&").join(parent) : `${parent} ${text}`;
}

function flattenNested(container: Container, parent: string | null): { selector: string; declarations: string[] }[] {
  const found: { selector: string; declarations: string[] }[] = [];
  for (const node of container.nodes ?? []) {
    if (node.type !== "rule") continue;
    const selector = parent === null ? clean(node.selector) : resolveSelector(node.selector, parent);
    const declarations = declarationLines(node, false);
    if (declarations.length > 0) found.push({ selector, declarations });
    found.push(...flattenNested(node, selector));
  }
  return found;
}

function handleRule(rule: Rule, file: string, context: string[], parent: string | null, out: Collected): void {
  const selector = resolveSelector(rule.selector, parent);
  const scope = parent === null && out.tokens !== null ? SCOPES[selector] : undefined;
  if (scope !== undefined && out.tokens !== null) {
    for (const node of rule.nodes ?? []) {
      if (node.type === "decl" && node.prop.startsWith("--")) {
        if (!out.order.includes(node.prop)) out.order.push(node.prop);
        out.tokens[scope].set(node.prop, clean(node.value));
      }
    }
  }
  const declarations = declarationLines(rule, scope !== undefined);
  if (declarations.length > 0) out.selectors.push({ file, context, selector, declarations });
  visit(rule, file, context, selector, out);
}

function handleAtRule(node: AtRule, file: string, context: string[], parent: string | null, out: Collected): void {
  if (node.name === "utility") {
    out.utilities.push({
      file,
      name: clean(node.params),
      declarations: declarationLines(node, false),
      nested: flattenNested(node, null),
    });
    return;
  }
  if (node.name === "keyframes") {
    out.keyframes.push({ file, name: clean(node.params) });
    return;
  }
  if (node.name === "font-face") {
    const get = (prop: string): string => {
      let value = "";
      node.walkDecls(prop, (decl) => {
        value = clean(decl.value);
      });
      return value;
    };
    out.fontFaces.push({
      file,
      family: get("font-family").replace(/^"|"$/g, ""),
      style: get("font-style"),
      weight: get("font-weight"),
      source: get("src"),
    });
    return;
  }
  if (["layer", "media", "supports", "container"].includes(node.name)) {
    visit(node, file, [...context, clean(`@${node.name} ${node.params}`)], parent, out);
  }
}

function visit(container: Container, file: string, context: string[], parent: string | null, out: Collected): void {
  for (const node of container.nodes ?? []) {
    if (node.type === "rule") handleRule(node, file, context, parent, out);
    if (node.type === "atrule") handleAtRule(node, file, context, parent, out);
  }
}

function isColor(value: string): boolean {
  return /^(#[0-9a-f]{3,8}|(rgb|hsl|oklch|oklab|color)a?\(.*\))$/i.test(value);
}

function resolveValue(value: string, map: Map<string, string>): string {
  let current = value;
  for (let step = 0; step < 10; step++) {
    const next = current.replace(/var\((--[a-z0-9-]+)(?:\s*,[^)]*)?\)/gi, (whole, name: string) => map.get(name) ?? whole);
    if (next === current) break;
    current = next;
  }
  return current;
}

function tokenGroup(name: string): string {
  const parts = name.slice(2).split("-");
  return parts[0] === "color" && parts.length > 1 ? `--${parts[0]}-${parts[1]}-` : `--${parts[0]}-`;
}

function buildTokenFile(file: string, out: Collected, light: Map<string, string>, dark: Map<string, string>): TokenFile {
  const scopes = out.tokens as Record<Scope, Map<string, string>>;
  const tokens: Token[] = out.order.map((name) => {
    const token: Token = { name, group: tokenGroup(name) };
    const lightValue = scopes.light.get(name);
    const darkValue = scopes.dark.get(name);
    const forceLight = scopes.forceLight.get(name);
    if (lightValue !== undefined) token.light = lightValue;
    if (darkValue !== undefined) token.dark = darkValue;
    if (forceLight !== undefined) token.forceLight = forceLight;
    if (lightValue !== undefined) {
      const resolved = resolveValue(lightValue, light);
      if (isColor(resolved)) token.lightColor = resolved;
    }
    if (darkValue !== undefined) {
      const resolved = resolveValue(darkValue, dark);
      if (isColor(resolved)) token.darkColor = resolved;
    }
    return token;
  });
  return { file, tokens };
}

function parseFile(file: string, withTokens: boolean): Collected {
  const out = emptyCollected(withTokens);
  visit(postcss.parse(readFileSync(fromRepo(file), "utf8")), file, [], null, out);
  return out;
}

export type ParsedCss = Omit<CssData, "stats" | "report" | "pluginTokens">;

export function collectCss(): ParsedCss {
  const parsed = new Map<string, Collected>();
  for (const file of new Set([...TOKEN_FILES, ...SELECTOR_FILES])) {
    parsed.set(file, parseFile(file, TOKEN_FILES.includes(file)));
  }

  const baseLight = new Map<string, string>();
  const baseDark = new Map<string, string>();
  for (const file of BASE_FILES) {
    const tokens = (parsed.get(file) as Collected).tokens as Record<Scope, Map<string, string>>;
    for (const [name, value] of tokens.light) baseLight.set(name, value);
  }
  for (const [name, value] of baseLight) baseDark.set(name, value);
  for (const file of BASE_FILES) {
    const tokens = (parsed.get(file) as Collected).tokens as Record<Scope, Map<string, string>>;
    for (const [name, value] of tokens.dark) baseDark.set(name, value);
  }

  const tokenFiles = TOKEN_FILES.map((file) => {
    const out = parsed.get(file) as Collected;
    if (BASE_FILES.includes(file)) return buildTokenFile(file, out, baseLight, baseDark);
    const tokens = out.tokens as Record<Scope, Map<string, string>>;
    const own = new Map(tokens.light);
    const ownDark = new Map([...tokens.light, ...tokens.dark]);
    return buildTokenFile(file, out, own, ownDark);
  });

  const selectors: Selector[] = [];
  const utilities: Utility[] = [];
  const keyframes: { file: string; name: string }[] = [];
  const fontFaces: FontFace[] = [];
  for (const file of SELECTOR_FILES) {
    const out = parsed.get(file) as Collected;
    selectors.push(...out.selectors);
    utilities.push(...out.utilities);
    keyframes.push(...out.keyframes);
    fontFaces.push(...out.fontFaces);
  }

  const reportClasses: Selector[] = [];
  const markdown = readFileSync(fromRepo(REPORT_FILE), "utf8");
  for (const match of markdown.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const out = emptyCollected(false);
    visit(postcss.parse(match[1]), REPORT_FILE, [], null, out);
    reportClasses.push(...out.selectors);
  }

  return { tokenFiles, selectors, utilities, keyframes, fontFaces, reportClasses };
}
