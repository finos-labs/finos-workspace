interface RecordedCall {
  tools?: unknown;
  messages?: unknown;
}

export const toolNamesOf = (call: RecordedCall): string[] =>
  ((call.tools ?? []) as { name: string }[]).map((t) => t.name);

export function systemPromptOf(call: RecordedCall): string {
  const system = ((call.messages ?? []) as { role: string; content: unknown }[]).find((m) => m.role === "system");
  return typeof system?.content === "string" ? system.content : JSON.stringify(system?.content ?? "");
}

export function catalogToolNamesOf(call: RecordedCall): string[] {
  const section = systemPromptOf(call).split("MORE TOOLS")[1] ?? "";
  return [...section.matchAll(/Tools: ([^\n]+)/g)].flatMap((m) => m[1].split(", "));
}

export function modelKnowsTool(call: RecordedCall, suffix: string): boolean {
  return [...toolNamesOf(call), ...catalogToolNamesOf(call)].some((name) => name.endsWith(suffix));
}
