import { tool } from "ai";
import { z } from "zod";
import { metrics } from "../../lib/metrics.ts";
import type { TranscriptEntry } from "../history.ts";
import { displaySummarySchema } from "./progress.ts";

const MAX_LAST = 10;
const MAX_RESULTS = 6;
const MAX_ENTRY_CHARS = 6_000;
const MAX_TOTAL_CHARS = 20_000;
const SNIPPET_BEFORE = 300;
const SNIPPET_AFTER = 500;

const recallConversationSchema = z.object({
  display_summary: displaySummarySchema,
  last: z
    .number()
    .int()
    .min(1)
    .max(MAX_LAST)
    .optional()
    .describe("Read the latest earlier messages: 2 is the previous question and its answer."),
  query: z
    .string()
    .optional()
    .describe("Words to look for in the earlier messages (a name, a number, a topic). Returns the best matches."),
  from: z.number().int().min(1).optional().describe("Read earlier messages by number, from this one."),
  to: z.number().int().min(1).optional().describe("…up to and including this one (default: the same as from)."),
});

const recallConversationDescription =
  "Read the earlier part of this conversation, which you are not shown (you see only the current question and this turn). " +
  "Use it before answering anything that refers back to what was said or done earlier. " +
  "`last`: the latest earlier messages; `query`: search them by words; `from`/`to`: numbered messages. A call returns a limited amount: narrow it down.";

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function search(entries: TranscriptEntry[], query: string): TranscriptEntry[] {
  const sets = entries.map((entry) => new Set(words(entry.text)));
  const terms = [...new Set(words(query))];
  const documentFrequency = new Map(terms.map((term) => [term, sets.filter((set) => set.has(term)).length]));
  return entries
    .map((entry, i) => ({
      entry,
      score: terms.reduce(
        (sum, term) => (sets[i].has(term) ? sum + Math.log(1 + entries.length / (documentFrequency.get(term) || 1)) : sum),
        0,
      ),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.number - a.entry.number)
    .slice(0, MAX_RESULTS)
    .map((match) => match.entry);
}

function snippet(text: string, query: string): string {
  if (text.length <= SNIPPET_BEFORE + SNIPPET_AFTER) return text;
  const lower = text.toLowerCase();
  const at = words(query)
    .map((term) => lower.indexOf(term))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (at ?? 0) - SNIPPET_BEFORE);
  const end = Math.min(text.length, start + SNIPPET_BEFORE + SNIPPET_AFTER);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function render(entries: TranscriptEntry[], textOf: (entry: TranscriptEntry) => string): string {
  const parts: string[] = [];
  let total = 0;
  for (const entry of entries) {
    let text = textOf(entry);
    if (text.length > MAX_ENTRY_CHARS) {
      text = `${text.slice(0, MAX_ENTRY_CHARS)}… [${text.length - MAX_ENTRY_CHARS} more characters of #${entry.number}]`;
    }
    if (total + text.length > MAX_TOTAL_CHARS && parts.length > 0) {
      parts.push("[More matches were left out to keep this short. Ask for fewer, or for particular numbers.]");
      break;
    }
    total += text.length;
    parts.push(`#${entry.number} ${entry.role}: ${text}`);
  }
  return parts.join("\n\n");
}

export function makeRecallConversationTool(earlier: TranscriptEntry[]) {
  const count = earlier.length;
  return tool({
    description: recallConversationDescription,
    inputSchema: recallConversationSchema,
    execute: async (args) => {
      if (count === 0) return "There are no earlier messages: this is the first question of the conversation.";
      const header = `The conversation has ${count} earlier messages (numbered 1-${count}).`;

      if (args.query?.trim()) {
        metrics.recalls.inc({ mode: "words" });
        const found = search(earlier, args.query);
        if (found.length === 0) {
          return `${header} None of them contains those words. Try other words, or read by number or with last.`;
        }
        return `${header} The best matches for "${args.query.trim()}", best first:\n\n${render(found, (entry) => snippet(entry.text, args.query!))}`;
      }

      if (args.from !== undefined || args.to !== undefined) {
        metrics.recalls.inc({ mode: "numbers" });
        const from = args.from ?? args.to!;
        const to = Math.min(args.to ?? from, from + MAX_RESULTS - 1);
        if (from > count) return `${header} There is no message ${from}.`;
        const picked = earlier.filter((entry) => entry.number >= from && entry.number <= to);
        return `${header}\n\n${render(picked, (entry) => entry.text)}`;
      }

      metrics.recalls.inc({ mode: "latest" });
      const picked = earlier.slice(-(args.last ?? 2));
      return `${header} The latest ${picked.length}:\n\n${render(picked, (entry) => entry.text)}`;
    },
  });
}
