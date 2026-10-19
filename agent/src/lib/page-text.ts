/**
 * The string work of reading a page in parts: a slice of its text, where a phrase occurs, an excerpt.
 * Plain functions of a string and no dependencies, each linear in the text, so the agent and the tool
 * server can run them on a page of megabytes without the DOM that reading the page itself needs
 * (page-view.ts, which runs in a child process).
 */

import type { PageOverview } from "./page-view";

export function collapseSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function formatKb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Characters `offset` up to `offset + limit` of a text, and where they are in it. */
export function sliceChars(text: string, offset: number, limit: number): { chunk: string; start: number; end: number; total: number } {
  const start = Math.min(Math.max(0, Math.floor(offset)), text.length);
  const end = Math.min(text.length, start + Math.max(1, Math.floor(limit)));
  return { chunk: text.slice(start, end), start, end, total: text.length };
}

/** The start of a text, cut at a paragraph or a sentence when there is one near the end. */
export function excerpt(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const floor = Math.floor(max * 0.75);
  const paragraph = head.lastIndexOf("\n\n");
  if (paragraph >= floor) return head.slice(0, paragraph);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf(".\n"));
  if (sentence >= floor) return head.slice(0, sentence + 1);
  return head;
}

/** Counting stops here: a page that says "the" a hundred thousand times has no use for the count. */
export const MAX_COUNTED_MATCHES = 1000;

export interface TextMatch {
  /** Where the match starts, in the text it was found in. */
  at: number;
  /** The match with some of the text around it, on one line. */
  snippet: string;
}

/**
 * Where a word or phrase occurs (a literal, without regard to case: a pattern a model writes would be one a
 * page can make slow), from the `skip`th match on. Matches that fall inside the context shown for the one
 * before it are one match.
 */
export function findInText(
  text: string,
  query: string,
  options: { skip?: number; max: number; context?: number },
): { total: number; counted: string; matches: TextMatch[] } {
  const { skip = 0, max, context = 120 } = options;
  const needle = query.trim();
  if (!needle) return { total: 0, counted: "0", matches: [] };
  // Lower-casing can change the length of a text ("İ"), which would put every offset after it in the wrong place.
  const lowered = text.toLowerCase();
  const exact = lowered.length === text.length;
  const haystack = exact ? lowered : text;
  const target = exact ? needle.toLowerCase() : needle;

  const matches: TextMatch[] = [];
  let total = 0;
  let from = 0;
  let at = haystack.indexOf(target, from);
  while (at !== -1 && total < MAX_COUNTED_MATCHES) {
    if (total >= skip && matches.length < max) {
      const start = Math.max(0, at - context);
      const end = Math.min(text.length, at + target.length + context);
      matches.push({
        at,
        snippet: `${start > 0 ? "…" : ""}${collapseSpace(text.slice(start, end))}${end < text.length ? "…" : ""}`,
      });
    }
    total++;
    from = at + Math.max(target.length, context);
    at = haystack.indexOf(target, from);
  }
  return { total, counted: at !== -1 ? `${MAX_COUNTED_MATCHES}+` : String(total), matches };
}

/** The text of a page from an offset, as a view of it: what is shown, where it is, and where to go on. */
export function readText(text: string, offset: number, limit: number): string {
  const { chunk, start, end, total } = sliceChars(text, offset, limit);
  if (total === 0) return "The page has no readable text.";
  if (start >= total) return `The text is ${total} characters long and ends before that offset.`;
  return `${chunk}\n\n[characters ${start}–${end} of ${total}.${end < total ? ` Continue at offset ${end}.` : " That is the end."}]`;
}

/** How much of a page's text an overview shows: enough to say what the page is, not to read it. */
export const OVERVIEW_EXCERPT_CHARS = 3000;

/**
 * An overview of a page for a model: what it is, what it contains, and the start of its text. Not the page:
 * the rest is read in parts (see the `inspect_webpage` tool). Everything in it is the page's own, or a count.
 */
export function renderOverview(input: {
  url: string;
  title: string;
  status: number;
  contentType: string;
  bytes: number;
  overview: PageOverview;
  /** The id that `inspect_webpage` takes, or null when the page is not held. */
  pageId: string | null;
  /** What to do next, when there is more of the text than is shown. */
  more: (shown: number, total: number) => string;
}): string {
  const { overview } = input;
  const lines = [`Fetched ${input.url} (HTTP ${input.status}, ${input.contentType || "unknown type"}, ${formatKb(input.bytes)}).`];
  if (input.pageId) lines.push(`page_id: ${input.pageId}`);
  lines.push(`Title: ${input.title}`);
  if (overview.description) lines.push(`Description: ${overview.description}`);
  if (overview.outline.length > 0) {
    lines.push("Outline:");
    for (const heading of overview.outline) lines.push(`${"  ".repeat(Math.max(0, heading.level - 1))}- ${heading.text}`);
  }
  const { links, tables, images, forms } = overview.counts;
  const contains = [
    [links, "links"],
    [tables, "tables"],
    [images, "images"],
    [forms, "forms"],
  ].flatMap(([n, name]) => (Number(n) > 0 ? [`${n} ${name}`] : []));
  if (contains.length > 0) lines.push(`Contains: ${contains.join(", ")}.`);
  if (overview.data.length > 0) {
    lines.push(`Embedded JSON: ${overview.data.map((d) => `[${d.index}] ${d.kind} (${d.summary})`).join("; ")}.`);
  }
  const text = overview.markdown;
  if (!text.trim()) {
    lines.push("The page has no readable text.");
  } else if (text.length <= OVERVIEW_EXCERPT_CHARS + 500) {
    lines.push(`Readable text (all ${text.length} characters):`, text);
  } else {
    const shown = excerpt(text, OVERVIEW_EXCERPT_CHARS);
    lines.push(`Readable text (${text.length} characters in all; the first ${shown.length}):`, shown, "", `[${input.more(shown.length, text.length)}]`);
  }
  return lines.join("\n");
}
