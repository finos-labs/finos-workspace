/**
 * The most of one tool or widget result that goes into the model's input.
 *
 * A file, a feed or a tool can return megabytes. The model is given the start of it, and told how much it
 * was not given, so that it asks for the rest in a way that costs less (a search, a narrower query) instead
 * of the request growing past what the model accepts and being refused, at the user's expense.
 */

/** Text of one widget (a TXT/MD/HTML file, a feed) in the model's input. */
export const MAX_INLINE_TEXT_CHARS = 30_000;

/** The result of one MCP tool call in the model's input. */
export const MAX_TOOL_RESULT_CHARS = 40_000;

export function clipForModel(text: string, max: number, hint = ""): string {
  if (text.length <= max) return text;
  const omitted = text.length - max;
  return `${text.slice(0, max)}\n[… ${omitted} more characters are not shown${hint ? `; ${hint}` : ""}]`;
}
