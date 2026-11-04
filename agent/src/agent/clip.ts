export const MAX_INLINE_TEXT_CHARS = 30_000;

export const MAX_TOOL_RESULT_CHARS = 40_000;

export function clipForModel(text: string, max: number, hint = ""): string {
  if (text.length <= max) return text;
  const omitted = text.length - max;
  return `${text.slice(0, max)}\n[… ${omitted} more characters are not shown${hint ? `; ${hint}` : ""}]`;
}
