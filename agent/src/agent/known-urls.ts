import type { Message, ToolMessage } from "../protocol/types.ts";

const MAX_KEYS = 20_000;
const MAX_TOKEN_CHARS = 2048;
const MAX_DEPTH = 8;
const MAX_SCAN_CHARS = 2_000_000;
const MAX_TOTAL_SCAN_CHARS = 8_000_000;
const MAX_STRIPS = 4;
const MAX_WORK = 4_000_000;

const READING_TOOLS = ["web_search", "fetch_webpage", "inspect_webpage", "query_documents", "get_widget_data"] as const;
const READING_FUNCTIONS = new Set(["get_widget_data"]);

const SCHEME_AT = /https?:\/\//gi;
const TOKEN_CHARS = new RegExp(`[^\\s<>"'\`]{1,${MAX_TOKEN_CHARS + 1}}`, "y");
const BARE_SPLIT = /[\s<>"'`()[\]{},;]+/;
const BARE_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d{1,5})?(?:[/?#].*)?$/i;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}*_]$/;

export function urlKey(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.host.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${path}${url.search}`;
}

function* variants(token: string): Generator<string> {
  let t = token;
  yield t;
  const close = t.search(/[)\]]/);
  if (close > 0) yield t.slice(0, close);
  for (let strips = 0; strips < MAX_STRIPS && t.length > 1 && TRAILING_PUNCTUATION.test(t); strips++) {
    t = t.slice(0, -1);
    yield t;
  }
}

interface ScanBudget {
  left: number;
}

export function addressesIn(whole: string, into: Set<string>, budget: ScanBudget = { left: Infinity }): void {
  if (budget.left <= 0) return;
  const cap = Math.min(MAX_SCAN_CHARS, budget.left);
  const text = whole.length > cap ? whole.slice(0, cap) : whole;
  budget.left -= text.length;
  const add = (candidate: string): void => {
    if (into.size >= MAX_KEYS) return;
    const key = urlKey(candidate);
    if (key) into.add(key);
  };

  let work = MAX_WORK;
  SCHEME_AT.lastIndex = 0;
  let found: RegExpExecArray | null;
  while (into.size < MAX_KEYS && (found = SCHEME_AT.exec(text)) !== null) {
    TOKEN_CHARS.lastIndex = found.index;
    const token = TOKEN_CHARS.exec(text)?.[0];
    work -= token?.length ?? 1;
    if (work < 0) break;
    if (!token || token.length > MAX_TOKEN_CHARS) continue;
    for (const v of variants(token)) add(v);
  }

  for (const piece of text.split(BARE_SPLIT)) {
    work -= piece.length + 1;
    if (into.size >= MAX_KEYS || work < 0) return;
    if (piece.length < 4 || piece.length > MAX_TOKEN_CHARS || piece.includes("://")) continue;
    for (const v of variants(piece)) {
      if (BARE_HOST.test(v)) add(`https://${v}`);
    }
  }
}

function addressesInValue(value: unknown, into: Set<string>, budget: ScanBudget, depth = 0): void {
  if (into.size >= MAX_KEYS || budget.left <= 0 || depth > MAX_DEPTH || value == null) return;
  if (typeof value === "string") {
    addressesIn(value, into, budget);
  } else if (Array.isArray(value)) {
    for (const item of value) addressesInValue(item, into, budget, depth + 1);
  } else if (typeof value === "object") {
    for (const item of Object.values(value)) addressesInValue(item, into, budget, depth + 1);
  }
}

function isTool(name: unknown, canonical: string): boolean {
  return typeof name === "string" && (name === canonical || name.endsWith(`_${canonical}`));
}

export function isFetchTool(name: string): boolean {
  return isTool(name, "fetch_webpage");
}

function isReadingResult(message: ToolMessage): boolean {
  if (READING_FUNCTIONS.has(message.function)) return true;
  if (message.function !== "execute_agent_tool") return false;
  const tool = message.input_arguments?.tool_name;
  return READING_TOOLS.some((canonical) => isTool(tool, canonical));
}

export function addressesGiven(
  request: { messages: readonly Message[]; context?: unknown[]; urls?: string[] },
  pages: readonly string[] = [],
): Set<string> {
  const keys = new Set<string>();
  const budget: ScanBudget = { left: MAX_TOTAL_SCAN_CHARS };
  for (const url of request.urls ?? []) addressesIn(url, keys, budget);
  addressesInValue(request.context, keys, budget);
  for (const page of pages) addressesIn(page, keys, budget);
  for (let i = request.messages.length - 1; i >= 0 && budget.left > 0; i--) {
    const message = request.messages[i];
    if (message.role === "human") addressesInValue((message as { content?: unknown }).content, keys, budget);
    else if (message.role === "tool" && isReadingResult(message)) addressesInValue(message.data, keys, budget);
  }
  return keys;
}

export function isGivenAddress(url: string, given: ReadonlySet<string>): boolean {
  const key = urlKey(url);
  return key !== null && given.has(key);
}
