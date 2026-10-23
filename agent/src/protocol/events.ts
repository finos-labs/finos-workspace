import type { CitationCollection, CopilotArtifact, SSEEvent, Widget } from "./types.ts";

export const PLACEHOLDER_TAG_NAMES = [
  "artifact_id", "artifact", "copilot_table", "ines_artifact",
  "citation_id", "citation", "chart", "suggestions", "suggestion",
] as const;
export const PAIRED_PIPE_PLACEHOLDER_NAMES = [
  "artifact_id", "artifact", "copilot_table", "citation_id", "citation",
] as const;

const PLACEHOLDER_TAG_PATTERN = new RegExp(
  `<\\/?(${PLACEHOLDER_TAG_NAMES.join("|")})\\b[^>]*>`,
  "gi",
);
const PAIRED_PIPE_START_PATTERN = new RegExp(
  `<\\|start_(${PAIRED_PIPE_PLACEHOLDER_NAMES.join("|")})\\|>`,
  "gi",
);
const PIPE_PLACEHOLDER_PATTERN = new RegExp(
  `<\\|(start|end)_(${PAIRED_PIPE_PLACEHOLDER_NAMES.join("|")})\\|>`,
  "gi",
);
const INLINE_IMAGE_TAG_PATTERN = /<img\b[^>]*>/gi;
const DATA_IMAGE_PREFIX = "](data:image/";

function upToLastGt(text: string): [string, string] {
  const end = text.lastIndexOf(">") + 1;
  return end === 0 ? ["", text] : [text.slice(0, end), text.slice(end)];
}

export function firstTag(pattern: RegExp, text: string): RegExpExecArray | null {
  return pattern.exec(upToLastGt(text)[0]);
}

function replaceTags(text: string, pattern: RegExp, replacement: string): string {
  const [head, tail] = upToLastGt(text);
  return head === "" ? text : head.replace(pattern, replacement) + tail;
}

function removePairedPipePlaceholders(text: string): string {
  if (!text.includes("<|")) return text;
  const ends = new Map<string, { pattern: RegExp; last: number }>();
  let out = "";
  let kept = 0;
  PAIRED_PIPE_START_PATTERN.lastIndex = 0;
  let start: RegExpExecArray | null;
  while ((start = PAIRED_PIPE_START_PATTERN.exec(text)) !== null) {
    const name = start[1].toLowerCase();
    let end = ends.get(name);
    if (end === undefined) {
      const pattern = new RegExp(`<\\|end_${name}\\|>`, "gi");
      let last = -1;
      for (const found of text.matchAll(pattern)) last = found.index;
      end = { pattern, last };
      ends.set(name, end);
    }
    const from = start.index + start[0].length;
    if (end.last < from) continue;
    end.pattern.lastIndex = from;
    const found = end.pattern.exec(text)!;
    out += text.slice(kept, start.index);
    kept = found.index + found[0].length;
    PAIRED_PIPE_START_PATTERN.lastIndex = kept;
  }
  return out + text.slice(kept);
}

function removeDataImages(text: string): string {
  let at = text.indexOf("![");
  if (at === -1) return text;
  let out = "";
  let kept = 0;
  let close = -2;
  let lastParen = -2;
  while (at !== -1) {
    const altStart = at + 2;
    if (close < altStart) {
      close = text.indexOf("]", altStart);
      if (close === -1) break;
    }
    if (text.slice(close, close + DATA_IMAGE_PREFIX.length).toLowerCase() === DATA_IMAGE_PREFIX) {
      if (lastParen === -2) lastParen = text.lastIndexOf(")");
      const from = close + DATA_IMAGE_PREFIX.length;
      if (lastParen < from) break;
      const end = text.indexOf(")", from) + 1;
      out += text.slice(kept, at);
      kept = end;
      at = text.indexOf("![", end);
      continue;
    }
    at = text.indexOf("![", altStart);
  }
  return out + text.slice(kept);
}

function removeDanglingSuggestionFragments(text: string): string {
  let gt = text.indexOf(">");
  if (gt === -1) return text;
  let out = "";
  let kept = 0;
  while (gt !== -1) {
    let at = gt;
    for (;;) {
      if (at - 11 >= kept && text.slice(at - 11, at).toLowerCase() === "suggestions") at -= 11;
      else if (at - 10 >= kept && text.slice(at - 10, at).toLowerCase() === "suggestion") at -= 10;
      else break;
    }
    if (at < gt) {
      out += text.slice(kept, at);
      kept = gt + 1;
    }
    gt = text.indexOf(">", gt + 1);
  }
  return out + text.slice(kept);
}

const IMAGE_BANG_REPLACEMENT = "\u200B";

export function neutralizeImages(text: string): string {
  let at = text.indexOf("![");
  if (at === -1) return text;
  let out = "";
  let kept = 0;
  let close = -2;
  while (at !== -1) {
    const altStart = at + 2;
    if (close < altStart) {
      close = text.indexOf("]", altStart);
      if (close === -1) break;
    }
    const next = text[close + 1];
    if (next === "(" || next === "[") {
      out += text.slice(kept, at) + IMAGE_BANG_REPLACEMENT;
      kept = at + 1;
    }
    at = text.indexOf("![", altStart);
  }
  return out + text.slice(kept);
}

export function defuseImageStarts(text: string): string {
  return text.replace(/!(?=\[)/g, IMAGE_BANG_REPLACEMENT);
}

export function stripPlaceholderTags(text: string): string {
  let out = removePairedPipePlaceholders(text);
  out = replaceTags(out, PLACEHOLDER_TAG_PATTERN, "");
  out = out.replace(PIPE_PLACEHOLDER_PATTERN, "");
  out = removeDanglingSuggestionFragments(out);
  out = replaceTags(out, INLINE_IMAGE_TAG_PATTERN, "");
  out = removeDataImages(out);
  return neutralizeImages(out);
}

export function messageChunk(delta: string): SSEEvent {
  return {
    event: "copilotMessageChunk",
    data: { delta: stripPlaceholderTags(delta) },
  };
}

export function streamingMessageChunk(delta: string): SSEEvent {
  return {
    event: "copilotMessageChunk",
    data: { delta },
  };
}

export function reasoningStep(
  message: string,
  eventType: "INFO" | "WARNING" | "ERROR" = "INFO",
  details?: Record<string, unknown> | Array<Record<string, unknown>> | string,
  artifacts?: CopilotArtifact[],
): SSEEvent {
  return {
    event: "copilotStatusUpdate",
    data: {
      eventType,
      message,
      group: "reasoning",
      ...(details != null ? { details: Array.isArray(details) ? details : [details] } : {}),
      ...(artifacts && artifacts.length > 0 ? { artifacts } : {}),
    },
  };
}

export function planningStep(
  message: string,
  eventType: "INFO" | "WARNING" | "ERROR" = "INFO",
  details?: Record<string, unknown> | Array<Record<string, unknown>> | string,
): SSEEvent {
  return {
    event: "copilotStatusUpdate",
    data: {
      eventType,
      message,
      group: "planning",
      ...(details != null ? { details: Array.isArray(details) ? details : [details] } : {}),
    },
  };
}

export function messageArtifact(artifact: CopilotArtifact): SSEEvent {
  return {
    event: "copilotMessageArtifact",
    data: artifact as unknown as Record<string, unknown>,
  };
}

export function getSkillContent(
  slug: string,
  reason?: string,
  extraState?: Record<string, unknown>,
): SSEEvent {
  return {
    event: "copilotFunctionCall",
    data: {
      function: "get_skill_content",
      input_arguments: { slug, ...(reason && { reason }) },
      ...(extraState && Object.keys(extraState).length > 0 ? { extra_state: extraState } : {}),
    },
  };
}

export function executeAgentTool(
  serverId: string,
  toolName: string,
  parameters: Record<string, unknown>,
  extraState?: Record<string, unknown>,
): SSEEvent {
  return {
    event: "copilotFunctionCall",
    data: {
      function: "execute_agent_tool",
      input_arguments: {
        server_id: serverId,
        tool_name: toolName,
        parameters,
      },
      ...(extraState && Object.keys(extraState).length > 0 ? { extra_state: extraState } : {}),
    },
  };
}

export function promptSuggestions(suggestions: string[]): SSEEvent {
  return {
    event: "copilotPromptSuggestions",
    data: { suggestions },
  };
}

const MAX_SUGGESTIONS_BLOCK_CHARS = 20_000;

export function parseSuggestions(text: string): { cleanText: string; suggestions: string[] } {
  const openMatch = firstTag(/<suggestions\b[^>]*>/i, text);
  if (!openMatch) return { cleanText: text, suggestions: [] };

  const blockStart = openMatch.index + openMatch[0].length;
  const rest = text.slice(blockStart);
  const closeMatch = /<\/suggestions>/i.exec(rest);
  const block = closeMatch ? rest.slice(0, closeMatch.index) : rest;
  const afterBlock = closeMatch ? rest.slice(closeMatch.index + closeMatch[0].length) : "";
  const cleanText = `${text.slice(0, openMatch.index)}${afterBlock}`.trimEnd();

  if (!closeMatch) return { cleanText, suggestions: [] };

  if (block.length > MAX_SUGGESTIONS_BLOCK_CHARS) return { cleanText, suggestions: [] };
  const suggestions: string[] = [];
  const suggestionOpenCount = [...upToLastGt(block)[0].matchAll(/<suggestion\b[^>]*>/gi)].length;
  const suggestionCloseCount = [...block.matchAll(/<\/suggestion>/gi)].length;
  if (suggestionOpenCount !== suggestionCloseCount) {
    return { cleanText, suggestions: [] };
  }
  const consumed = block.replace(/<suggestion\b[^>]*>([\s\S]*?)<\/suggestion>/gi, (_full, body) => {
    const trimmed = String(body).trim();
    if (trimmed) suggestions.push(trimmed);
    return "";
  });
  if (consumed.trim()) {
    return { cleanText, suggestions: [] };
  }
  return { cleanText, suggestions };
}

export function citationCollection(collection: CitationCollection): SSEEvent {
  return {
    event: "copilotCitationCollection",
    data: collection as unknown as Record<string, unknown>,
  };
}

export function getWidgetData(widgets: Widget[], extraState?: Record<string, unknown>): SSEEvent {
  return {
    event: "copilotFunctionCall",
    data: {
      function: "get_widget_data",
      input_arguments: {
        data_sources: widgets.map((w) => ({
          widget_uuid: w.uuid,
          origin: w.origin,
          id: w.widget_id,
          input_args: Object.fromEntries(
            w.params.map((p) => [p.name, p.current_value ?? p.default_value]),
          ),
        })),
      },
      extra_state: {
        copilot_function_call_arguments: {
          widget_queries: widgets.map((w) => ({ widget_uuid: w.uuid })),
        },
        ...(extraState ?? {}),
      },
    },
  };
}

export function workspaceCommand(
  name: string,
  args: Record<string, unknown>,
  extraState?: Record<string, unknown>,
): SSEEvent {
  return {
    event: "copilotFunctionCall",
    data: {
      function: name,
      input_arguments: args,
      extra_state: {
        copilot_function_call_arguments: args,
        ...(extraState ?? {}),
      },
    },
  };
}
