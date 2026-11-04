import type { PageOverview } from "./page-view.ts";

export function collapseSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatKb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function sliceChars(text: string, offset: number, limit: number): { chunk: string; start: number; end: number; total: number } {
  const start = Math.min(Math.max(0, Math.floor(offset)), text.length);
  const end = Math.min(text.length, start + Math.max(1, Math.floor(limit)));
  return { chunk: text.slice(start, end), start, end, total: text.length };
}

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

export const MAX_COUNTED_MATCHES = 1000;

interface TextMatch {
  at: number;
  snippet: string;
}

export function findInText(
  text: string,
  query: string,
  options: { skip?: number; max: number; context?: number },
): { total: number; counted: string; matches: TextMatch[] } {
  const { skip = 0, max, context = 120 } = options;
  const needle = query.trim();
  if (!needle) return { total: 0, counted: "0", matches: [] };
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

export function readText(text: string, offset: number, limit: number): string {
  const { chunk, start, end, total } = sliceChars(text, offset, limit);
  if (total === 0) return "The page has no readable text.";
  if (start >= total) return `The text is ${total} characters long and ends before that offset.`;
  return `${chunk}\n\n[characters ${start}–${end} of ${total}.${end < total ? ` Continue at offset ${end}.` : " That is the end."}]`;
}

export const OVERVIEW_EXCERPT_CHARS = 3000;

export function renderOverview(input: {
  url: string;
  title: string;
  status: number;
  contentType: string;
  bytes: number;
  overview: PageOverview;
  pageId: string | null;
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
