import type { CitationCollection, CopilotArtifact, SSEEvent, Widget } from "./types.ts";

// Defensive strip of placeholder-tag patterns the model could hallucinate
// from training data. Ines's protocol does not use inline artifact tags
// (artifacts ride alongside on the SSE stream), so anything matching here
// is a leak — either a hallucinated tag or a future regression that
// introduces a placeholder protocol without sanitizing. Pattern is
// intentionally narrow (artifact/citation placeholders plus inline image tags)
// so prose like "the artifact" still passes through. Open and close tags both
// stripped where applicable.
// Three patterns: XML-style `<artifact>`, pipe-delimited marker pairs like
// `<|start_artifact_id|>uuid<|end_artifact_id|>`, and standalone pipe tags.
// (GPT models hallucinate the latter format). The tag-name lists are exported
// as the single source of truth: the streaming text sink (`text-sink.ts`)
// builds its incremental withhold-to-terminator detectors from the SAME names,
// so a new placeholder kind is added here once and both the bulk strip and the
// streaming strip pick it up.
export const PLACEHOLDER_TAG_NAMES = [
  "artifact_id", "artifact", "copilot_table", "ines_artifact",
  "citation_id", "citation", "chart", "suggestions", "suggestion",
] as const;
export const PAIRED_PIPE_PLACEHOLDER_NAMES = [
  "artifact_id", "artifact", "copilot_table", "citation_id", "citation",
] as const;

// The patterns for a tag (`<name …>`) are applied only up to the last `>` of the text (see `upToLastGt`).
// Without that, a text with many `<artifact ` and no `>` after them makes the pattern run to the end of the
// text from each of them: time with the square of the text, which is minutes for a megabyte, and the text
// is a model's, a page's or a client's. The same goes for the paired and image patterns, which are scanned
// (`removePairedPipePlaceholders`, `removeDataImages`) rather than matched.
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

/**
 * What a pattern that ends in `>` can match lies before the last `>`: the text up to it, and the rest, which
 * the pattern leaves as it is.
 */
function upToLastGt(text: string): [string, string] {
  const end = text.lastIndexOf(">") + 1;
  return end === 0 ? ["", text] : [text.slice(0, end), text.slice(end)];
}

/** The first match of a pattern that ends in `>`, found without the quadratic search for one that is not there. */
export function firstTag(pattern: RegExp, text: string): RegExpExecArray | null {
  return pattern.exec(upToLastGt(text)[0]);
}

function replaceTags(text: string, pattern: RegExp, replacement: string): string {
  const [head, tail] = upToLastGt(text);
  return head === "" ? text : head.replace(pattern, replacement) + tail;
}

/**
 * `<|start_NAME|>…<|end_NAME|>`, interior included, as the pattern `<\|start_(NAME)\|>[\s\S]*?<\|end_\1\|>`
 * removes it, but in one pass: that pattern looks for the end to the end of the text from every start that has none.
 * An end that no start precedes, and a start without an end, are left for the standalone pipe pattern.
 */
function removePairedPipePlaceholders(text: string): string {
  if (!text.includes("<|")) return text;
  const ends = new Map<string, { pattern: RegExp; last: number }>(); // for each name: where its last end is
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
    if (end.last < from) continue; // no end ahead for this name
    end.pattern.lastIndex = from;
    const found = end.pattern.exec(text)!;
    out += text.slice(kept, start.index);
    kept = found.index + found[0].length;
    PAIRED_PIPE_START_PATTERN.lastIndex = kept;
  }
  return out + text.slice(kept);
}

/**
 * `![alt](data:image/…)`, as `!\[[^\]]*]\(data:image\/[^)]*\)` removes it, but in one pass (that pattern looks
 * for the `]` to the end of the text from every `![` that has none).
 */
function removeDataImages(text: string): string {
  let at = text.indexOf("![");
  if (at === -1) return text;
  let out = "";
  let kept = 0;
  let close = -2; // the first "]" after the alt text being looked at
  let lastParen = -2; // the last ")" of the text
  while (at !== -1) {
    const altStart = at + 2;
    if (close < altStart) {
      close = text.indexOf("]", altStart);
      if (close === -1) break;
    }
    if (text.slice(close, close + DATA_IMAGE_PREFIX.length).toLowerCase() === DATA_IMAGE_PREFIX) {
      if (lastParen === -2) lastParen = text.lastIndexOf(")");
      const from = close + DATA_IMAGE_PREFIX.length;
      if (lastParen < from) break; // no ")" ahead: no later image is closed either
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

/**
 * `suggestion>` and `suggestions>` (and runs of them) at the end of a tag that is not there: the pattern
 * `(?:suggestions?)+>` removes them. Taken backwards from each `>`, which is linear (the pattern is not: it
 * runs to the end of a long run of "suggestion" from each of them). A run ending in "s" can only end in
 * "suggestions", and one ending in "n" only in "suggestion", so it is read one way.
 */
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

/** Takes the place of the `!` of an image: nothing shows, and no `!` is left to be joined to a `[` after it. */
const IMAGE_BANG_REPLACEMENT = "\u200B";

/**
 * `![alt](address)` and `![alt][reference]`: the chat window loads such an image by itself, from any address,
 * so an answer can send the user's data out in the address (text in a page can steer the model into writing
 * one). The `!` is replaced by a zero-width space, and what is left is a link that the user may follow if
 * they want to. It is replaced, not removed: with the `!` gone, a `]` before it and the `[` after it would
 * join (`![a]![b](u)` would turn into the image `![a][b]`).
 *
 * The scan is linear however the text is built. `![alt]` alone (a shortcut reference, which needs a
 * definition elsewhere in the text) is left as it is: it is not how the model writes an image, and it
 * appears in code.
 */
export function neutralizeImages(text: string): string {
  let at = text.indexOf("![");
  if (at === -1) return text;
  let out = "";
  let kept = 0; // what lies before this index is already in `out`
  let close = -2; // the first "]" after the alt text being looked at
  while (at !== -1) {
    const altStart = at + 2;
    if (close < altStart) {
      close = text.indexOf("]", altStart);
      if (close === -1) break; // no "]" ahead, so no later "![" is closed either
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

/** For text that is given up on as prose while an image may still be open in it: every `!` before a `[` goes. */
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

/**
 * Non-stripping message chunk for the streaming text sink. The sink is the
 * SOLE sanitizer on the streaming path: it has already run the placeholder
 * strip incrementally and extracted any `<suggestions>` block, so re-running
 * `stripPlaceholderTags` here would be wrong — the `(?:suggestions?)+>` dangling
 * pattern is not `<`-anchored and would delete legitimate prose mid-stream.
 * Static fallback strings keep `messageChunk`, which strips.
 */
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

/**
 * Extract follow-up suggestions from the model's final text and return the
 * cleaned text plus the parsed suggestions array. Non-greedy match so nested
 * tags don't confuse the parser. Returns the original text unchanged when no
 * suggestions block is found.
 */
export function parseSuggestions(text: string): { cleanText: string; suggestions: string[] } {
  const openMatch = firstTag(/<suggestions\b[^>]*>/i, text);
  if (!openMatch) return { cleanText: text, suggestions: [] };

  const blockStart = openMatch.index + openMatch[0].length;
  const rest = text.slice(blockStart);
  const closeMatch = /<\/suggestions>/i.exec(rest);
  const block = closeMatch ? rest.slice(0, closeMatch.index) : rest;
  const afterBlock = closeMatch ? rest.slice(closeMatch.index + closeMatch[0].length) : "";
  const cleanText = `${text.slice(0, openMatch.index)}${afterBlock}`.trimEnd();

  // If the enclosing block is malformed, fail closed: remove the whole
  // suggestions tail from visible text, but do not emit possibly-corrupted
  // prompt suggestions.
  if (!closeMatch) return { cleanText, suggestions: [] };

  // A block of suggestions is a few lines. One that is not is not one, and the patterns below look for a close
  // from each open tag.
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

/**
 * Generic native workspace-bridge function call, emitted verbatim: the
 * frontend routes `function` + `input_arguments` to its
 * `useWorkspaceBridgeCommandHandler`, which consumes the bridge command
 * shape directly (no per-command legacy renames).
 *
 * Mirrors the `copilot_function_call_arguments` echo the previous per-tool
 * helpers used so the frontend's existing `extra_state` reader keeps
 * working unchanged. Bridge ops round-trip — the browser re-POSTs the
 * command result — so `extraState` must carry the continuation keys from
 * `buildContinuationExtraState`.
 */
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
