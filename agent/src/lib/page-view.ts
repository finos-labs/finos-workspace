import { createRequire } from "node:module";
import TurndownService from "turndown";
import { collapseSpace, cut } from "./page-text.ts";

interface DomElement {
  tagName: string;
  textContent: string | null;
  outerHTML: string;
  getAttribute(name: string): string | null;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
}
interface DomDocument extends DomElement {
  body: DomElement | null;
  documentElement: DomElement | null;
}
const domino = createRequire(import.meta.url)("@mixmark-io/domino") as {
  createDocument(html?: string, force?: boolean): DomDocument;
};

export const MAX_MARKDOWN_CHARS = 1_500_000;
const MAX_REGION_ELEMENTS = 50;
const MAX_JSON_SOURCE_CHARS = 5_000_000;

export const MAX_TABLES_PER_VIEW = 5;
export const MAX_TABLE_ROWS = 2000;
export const MAX_TABLE_COLUMNS = 60;

export interface DataSource {
  index: number;
  kind: string;
  bytes: number;
  summary: string;
}

export interface PageOverview {
  title: string;
  description: string;
  language: string;
  outline: Array<{ level: number; text: string }>;
  counts: { links: number; tables: number; images: number; forms: number };
  data: DataSource[];
  markdown: string;
}

export type PageRequest =
  | { view: "region"; selector: string }
  | { view: "select"; selector: string; offset: number; limit: number }
  | { view: "links"; selector?: string; query?: string; offset: number; limit: number }
  | { view: "tables"; selector?: string; offset: number; limit: number; name: string }
  | { view: "data"; path?: string; limit: number };

export interface PageViewResult {
  text: string;
  markdown?: string;
  tables?: Array<{ name: string; rows: Record<string, string>[] }>;
}

export type ChildInput =
  | { op: "overview"; html: string; url: string; contentType?: string }
  | { op: "view"; html: string; url: string; contentType?: string; request: PageRequest };

const NOT_READ = ["script", "style", "noscript", "nav", "footer", "header", "iframe", "svg", "template"];

function isHtml(contentType: string | undefined): boolean {
  return !contentType || /html|xml/i.test(contentType);
}

function parse(html: string): DomDocument {
  return domino.createDocument(html, true);
}

function toMarkdown(html: string): string {
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  td.remove(NOT_READ);
  return td.turndown(html).slice(0, MAX_MARKDOWN_CHARS);
}

function attr(el: DomElement, name: string): string {
  return el.getAttribute(name) ?? "";
}

function all(root: DomElement, selector: string): DomElement[] {
  return Array.from(root.querySelectorAll(selector));
}

function select(root: DomElement, selector: string): DomElement[] | null {
  try {
    return all(root, selector);
  } catch {
    return null;
  }
}

const BAD_SELECTOR = "That is not a valid CSS selector.";

function jsonSources(doc: DomDocument, html: string, contentType: string | undefined): Array<{ kind: string; value: unknown; bytes: number }> {
  const found: Array<{ kind: string; value: unknown; bytes: number }> = [];
  if (!isHtml(contentType)) {
    if (/json/i.test(contentType ?? "") && html.length <= MAX_JSON_SOURCE_CHARS) {
      try {
        found.push({ kind: "JSON", value: JSON.parse(html), bytes: html.length });
      } catch {
      }
    }
    return found;
  }
  for (const el of all(doc, 'script[type="application/ld+json"], script[type="application/json"], script#__NEXT_DATA__')) {
    const text = el.textContent ?? "";
    if (!text.trim() || text.length > MAX_JSON_SOURCE_CHARS) continue;
    try {
      const type = attr(el, "type").toLowerCase();
      found.push({
        kind: type.includes("ld+json") ? "JSON-LD" : attr(el, "id") === "__NEXT_DATA__" ? "Next.js data" : "JSON",
        value: JSON.parse(text),
        bytes: text.length,
      });
    } catch {
    }
  }
  return found;
}

function describeSource(kind: string, value: unknown): string {
  if (kind === "JSON-LD") {
    const items = Array.isArray(value) ? value : [value];
    const types = items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const graph = Array.isArray(record["@graph"]) ? (record["@graph"] as unknown[]) : [record];
      return graph.flatMap((node) => {
        const type = node && typeof node === "object" ? (node as Record<string, unknown>)["@type"] : undefined;
        return typeof type === "string" ? [type] : Array.isArray(type) ? type.filter((t): t is string => typeof t === "string") : [];
      });
    });
    if (types.length > 0) return cut([...new Set(types)].slice(0, 8).join(", "), 100);
  }
  if (Array.isArray(value)) return `list of ${value.length}`;
  if (value && typeof value === "object") return cut(Object.keys(value).slice(0, 8).join(", "), 100);
  return typeof value;
}

export function overviewOf(html: string, _url: string, contentType?: string): PageOverview {
  if (!isHtml(contentType)) {
    const doc = parse("");
    const sources = jsonSources(doc, html, contentType);
    return {
      title: "",
      description: "",
      language: "",
      outline: [],
      counts: { links: 0, tables: 0, images: 0, forms: 0 },
      data: sources.map((s, index) => ({ index, kind: s.kind, bytes: s.bytes, summary: describeSource(s.kind, s.value) })),
      markdown: html.slice(0, MAX_MARKDOWN_CHARS),
    };
  }
  const doc = parse(html);
  const meta = (selector: string) => collapseSpace(doc.querySelector(selector)?.getAttribute("content") ?? "");
  const sources = jsonSources(doc, html, contentType);
  return {
    title: collapseSpace(doc.querySelector("title")?.textContent ?? ""),
    description: cut(meta('meta[name="description"]') || meta('meta[property="og:description"]'), 300),
    language: attr(doc.documentElement ?? doc, "lang"),
    outline: all(doc, "h1, h2, h3, h4")
      .slice(0, 40)
      .flatMap((h) => {
        const text = cut(collapseSpace(h.textContent ?? ""), 100);
        return text ? [{ level: Number(h.tagName.slice(1)), text }] : [];
      }),
    counts: {
      links: all(doc, "a[href]").length,
      tables: all(doc, "table").length,
      images: all(doc, "img").length,
      forms: all(doc, "form").length,
    },
    data: sources.map((s, index) => ({ index, kind: s.kind, bytes: s.bytes, summary: describeSource(s.kind, s.value) })),
    markdown: toMarkdown(doc.body ? doc.body.outerHTML : html),
  };
}

function openTag(el: DomElement): string {
  const names = ["id", "class", "href", "src", "alt", "title", "name", "content", "datetime", "value", "type", "role", "aria-label"];
  const attrs = names.flatMap((name) => {
    const value = el.getAttribute(name);
    return value ? [`${name}="${cut(collapseSpace(value), 120)}"`] : [];
  });
  return `<${el.tagName.toLowerCase()}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
}

function pageBase(doc: DomDocument, url: string): string {
  const href = doc.querySelector("base[href]")?.getAttribute("href");
  if (href) {
    try {
      return new URL(href, url).href;
    } catch {
    }
  }
  return url;
}

function rangeLine(label: string, offset: number, shown: number, total: number): string {
  return shown === 0 ? `${label}: ${total} in all, none from ${offset + 1}.` : `${label} ${offset + 1}–${offset + shown} of ${total}:`;
}

function jsonValue(sourceValue: unknown, path: string): { found: true; value: unknown } | { found: false; keys: string[] } {
  let current = sourceValue;
  for (const segment of path.split(".").filter(Boolean)) {
    if (Array.isArray(current)) {
      const index = /^\d+$/.test(segment) ? Number(segment) : -1;
      if (index < 0 || index >= current.length) return { found: false, keys: [`0–${current.length - 1}`] };
      current = current[index];
    } else if (current && typeof current === "object" && Object.hasOwn(current, segment)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return { found: false, keys: current && typeof current === "object" ? Object.keys(current).slice(0, 40).map((k) => cut(k, 40)) : [] };
    }
  }
  return { found: true, value: current };
}

function compact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 300)}… (${value.length} characters)` : value;
  if (Array.isArray(value)) {
    if (depth >= 6) return `[a list of ${value.length}]`;
    const head = value.slice(0, 10).map((item) => compact(item, depth + 1));
    return value.length > 10 ? [...head, `… ${value.length - 10} more items`] : head;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (depth >= 6) return `{an object with ${entries.length} keys}`;
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(0, 40)) out[key] = compact(item, depth + 1);
    if (entries.length > 40) out["…"] = `${entries.length - 40} more keys`;
    return out;
  }
  return value;
}

function tablesOf(root: DomElement): Array<{ caption: string; rows: Record<string, string>[]; columns: string[] }> {
  const out: Array<{ caption: string; rows: Record<string, string>[]; columns: string[] }> = [];
  for (const table of all(root, "table")) {
    const rowEls = all(table, "tr");
    if (rowEls.length < 2) continue;
    const cellsOf = (tr: DomElement) => all(tr, "th, td").slice(0, MAX_TABLE_COLUMNS).map((cell) => collapseSpace(cell.textContent ?? ""));
    const first = rowEls[0];
    const headerFirst = all(first, "th").length > 0;
    const headers = headerFirst ? cellsOf(first) : cellsOf(first).map((_, i) => `column_${i + 1}`);
    const seen = new Set<string>();
    const columns = headers.map((h, i) => {
      let name = h || `column_${i + 1}`;
      while (seen.has(name)) name = `${name}_${i + 1}`;
      seen.add(name);
      return name;
    });
    const body = (headerFirst ? rowEls.slice(1) : rowEls).slice(0, MAX_TABLE_ROWS);
    const rows = body.map((tr) => {
      const cells = cellsOf(tr);
      const row: Record<string, string> = {};
      columns.forEach((name, i) => {
        row[name] = cells[i] ?? "";
      });
      return row;
    });
    if (rows.length === 0) continue;
    out.push({ caption: collapseSpace(table.querySelector("caption")?.textContent ?? ""), rows, columns });
  }
  return out;
}

export function viewOf(html: string, url: string, request: PageRequest, contentType?: string): PageViewResult {
  const doc = parse(isHtml(contentType) ? html : "");

  switch (request.view) {
    case "region": {
      const matches = select(doc, request.selector);
      if (matches === null) return { text: BAD_SELECTOR };
      if (matches.length === 0) return { text: "Nothing on the page matches that selector." };
      return { text: "", markdown: toMarkdown(matches.slice(0, MAX_REGION_ELEMENTS).map((el) => el.outerHTML).join("\n")) };
    }

    case "select": {
      const matches = select(doc, request.selector);
      if (matches === null) return { text: BAD_SELECTOR };
      if (matches.length === 0) return { text: "Nothing on the page matches that selector." };
      const shown = matches.slice(request.offset, request.offset + request.limit);
      const lines = shown.map((el, i) => `[${request.offset + i + 1}] ${openTag(el)} ${cut(collapseSpace(el.textContent ?? ""), 300)}`.trimEnd());
      return { text: [rangeLine("Elements", request.offset, shown.length, matches.length), ...lines].join("\n") };
    }

    case "links": {
      const scope = request.selector ? select(doc, request.selector) : [doc];
      if (scope === null) return { text: BAD_SELECTOR };
      const base = pageBase(doc, url);
      const needle = request.query?.trim().toLowerCase();
      const seen = new Set<string>();
      const links: Array<{ text: string; url: string }> = [];
      for (const root of scope) {
        for (const a of all(root, "a[href]")) {
          let absolute: string;
          try {
            const target = new URL(attr(a, "href"), base);
            if (target.protocol !== "http:" && target.protocol !== "https:") continue;
            target.hash = "";
            absolute = target.href;
          } catch {
            continue;
          }
          if (seen.has(absolute)) continue;
          const text = cut(collapseSpace(a.textContent ?? "") || collapseSpace(attr(a, "aria-label") || attr(a, "title")) || "(no text)", 100);
          if (needle && !text.toLowerCase().includes(needle) && !absolute.toLowerCase().includes(needle)) continue;
          seen.add(absolute);
          links.push({ text, url: absolute });
        }
      }
      if (links.length === 0) return { text: "No links." };
      const shown = links.slice(request.offset, request.offset + request.limit);
      return {
        text: [rangeLine("Links", request.offset, shown.length, links.length), ...shown.map((l, i) => `[${request.offset + i + 1}] ${l.text} — ${l.url}`)].join("\n"),
      };
    }

    case "tables": {
      const scope = request.selector ? select(doc, request.selector) : [doc];
      if (scope === null) return { text: BAD_SELECTOR };
      const found = scope.flatMap((root) => tablesOf(root));
      if (found.length === 0) return { text: "No tables." };
      const shown = found.slice(request.offset, request.offset + Math.min(request.limit, MAX_TABLES_PER_VIEW));
      const tables = shown.map((t, i) => ({ name: `${request.name}_t${request.offset + i + 1}`, rows: t.rows }));
      const lines = shown.map((t, i) => {
        const preview = t.rows.slice(0, 3).map((row) => `    ${t.columns.map((c) => cut(row[c] ?? "", 40)).join(" | ")}`);
        return [
          `[${request.offset + i + 1}] ${t.caption ? `${cut(t.caption, 100)} — ` : ""}${t.rows.length} rows × ${t.columns.length} columns: ${t.columns.map((c) => cut(c, 30)).join(", ")}`,
          ...preview,
        ].join("\n");
      });
      return { text: [rangeLine("Tables", request.offset, shown.length, found.length), ...lines].join("\n"), tables };
    }

    case "data": {
      const sources = jsonSources(doc, html, contentType);
      if (sources.length === 0) return { text: "The page embeds no JSON." };
      const path = (request.path ?? "").trim();
      if (!path) {
        return {
          text: ["JSON in the page (read one with a path that starts with its number, such as 0.name):", ...sources.map((s, i) => `[${i}] ${s.kind}, ${s.bytes} characters: ${describeSource(s.kind, s.value)}`)].join("\n"),
        };
      }
      const [first, ...rest] = path.split(".");
      const source = /^\d+$/.test(first) ? sources[Number(first)] : undefined;
      if (!source) return { text: `There is no such source. The sources are numbered 0–${sources.length - 1}.` };
      const result = jsonValue(source.value, rest.join("."));
      if (!result.found) return { text: `There is nothing at that path. What is there: ${result.keys.join(", ") || "(a value, not a container)"}.` };
      return { text: JSON.stringify(compact(result.value), null, 2).slice(0, request.limit) };
    }
  }
}
