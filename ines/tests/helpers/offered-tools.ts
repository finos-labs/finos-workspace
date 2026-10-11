/**
 * What a model call was told about its tools: the definitions in its tool list, and the catalog of the
 * tools that are not in the list until they are loaded (in the system prompt).
 */

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

/** The tools of the catalog: the names listed after "Tools:" on each line of MORE TOOLS. */
export function catalogToolNamesOf(call: RecordedCall): string[] {
  const section = systemPromptOf(call).split("MORE TOOLS")[1] ?? "";
  return [...section.matchAll(/Tools: ([^\n]+)/g)].flatMap((m) => m[1].split(", "));
}

/** True when the model was given the tool, in its list or by the catalog, under a name that ends as given. */
export function modelKnowsTool(call: RecordedCall, suffix: string): boolean {
  return [...toolNamesOf(call), ...catalogToolNamesOf(call)].some((name) => name.endsWith(suffix));
}
