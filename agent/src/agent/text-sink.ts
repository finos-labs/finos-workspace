import type { SSEEvent } from "../protocol/types.ts";
import {
  PAIRED_PIPE_PLACEHOLDER_NAMES,
  PLACEHOLDER_TAG_NAMES,
  defuseImageStarts,
  firstTag,
  parseSuggestions,
  streamingMessageChunk,
  stripPlaceholderTags,
} from "../protocol/events.ts";

export interface TextSinkContext {
  deferredAnswerArtifactEvents: SSEEvent[];
  onArtifactEmitted: () => void;
}

interface TextSink {
  pushDelta(text: string): SSEEvent[];
  flushTail(): SSEEvent[];
  takeSuggestions(): { cleanTail: string; suggestions: string[] };
  readonly textEmitted: boolean;
  readonly text: string;
}

const TAG_NAMES = [...PLACEHOLDER_TAG_NAMES, "img"];

const MAX_HOLD = 16 * 1024;

const MAX_SLICE = 4 * 1024;

const SUGGESTIONS_OPEN = /<suggestions\b[^>]*>/i;
const PAIRED_PIPE_START = new RegExp(`<\\|start_(${PAIRED_PIPE_PLACEHOLDER_NAMES.join("|")})\\|>`, "gi");
const PAIRED_PIPE_END = new Map(
  PAIRED_PIPE_PLACEHOLDER_NAMES.map((name) => [name, new RegExp(`<\\|end_${name}\\|>`, "gi")] as const),
);
const SUGGESTIONS_WORD = "suggestions";
const MAX_RUN_TOKENS = 20;
const DATA_IMAGE_SCHEME = "data:image/";
const MERMAID_FENCE_OPEN = /```(?:mermaid|mmd)\b/gi;
const TRAILING_FENCE_LANG = /```([a-z]*)$/i;
const PARAGRAPH_BREAK = /\n{2,}/;
const CLOSED_MERMAID_FENCE = /```(?:mermaid|mmd)\s*\n[\s\S]*?\n```/gi;
const WORD_CHAR = /[a-z0-9_]/;

function couldBeTagStart(tail: string): boolean {
  let s = tail.slice(1);
  if (s.startsWith("/")) s = s.slice(1);
  if (s.startsWith("|")) return true;
  const lower = s.toLowerCase();
  for (const name of TAG_NAMES) {
    if (name.startsWith(lower)) return true;
    if (lower.startsWith(name)) {
      const after = lower[name.length];
      if (after !== undefined && !WORD_CHAR.test(after)) return true;
    }
  }
  return false;
}

function pairedPipeHoldStart(buf: string): number {
  if (!buf.includes("<|")) return -1;
  const lastEnd = new Map<string, number>();
  PAIRED_PIPE_START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PAIRED_PIPE_START.exec(buf)) !== null) {
    const name = m[1].toLowerCase() as (typeof PAIRED_PIPE_PLACEHOLDER_NAMES)[number];
    let last = lastEnd.get(name);
    if (last === undefined) {
      last = -1;
      const endRe = PAIRED_PIPE_END.get(name)!;
      endRe.lastIndex = 0;
      let e: RegExpExecArray | null;
      while ((e = endRe.exec(buf)) !== null) last = e.index;
      lastEnd.set(name, last);
    }
    if (last < m.index + m[0].length) return m.index;
  }
  return -1;
}

function imageHoldStart(buf: string): number {
  let idx = buf.indexOf("![");
  let close = -2;
  let lastParen = -2;
  while (idx >= 0) {
    const altStart = idx + 2;
    if (close < altStart) close = buf.indexOf("]", altStart);
    if (close === -1) return idx;
    if (close + 1 === buf.length) return idx;
    if (buf[close + 1] === "(") {
      const from = close + 2;
      const scheme = buf.slice(from, from + DATA_IMAGE_SCHEME.length).toLowerCase();
      if (scheme.length < DATA_IMAGE_SCHEME.length) {
        if (DATA_IMAGE_SCHEME.startsWith(scheme)) return idx;
      } else if (scheme === DATA_IMAGE_SCHEME) {
        if (lastParen === -2) lastParen = buf.lastIndexOf(")");
        if (lastParen < from + DATA_IMAGE_SCHEME.length) return idx;
      }
    }
    idx = buf.indexOf("![", altStart);
  }
  if (buf.endsWith("!")) return buf.length - 1;
  return -1;
}

function mermaidHoldStart(buf: string): number {
  MERMAID_FENCE_OPEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MERMAID_FENCE_OPEN.exec(buf)) !== null) {
    const close = buf.indexOf("```", m.index + m[0].length);
    if (close < 0) return m.index;
    MERMAID_FENCE_OPEN.lastIndex = close + 3;
  }
  const partial = TRAILING_FENCE_LANG.exec(buf);
  if (partial) {
    const lang = partial[1].toLowerCase();
    if (lang === "" || "mermaid".startsWith(lang) || "mmd".startsWith(lang)) {
      return partial.index;
    }
  }
  return -1;
}

function trailingSuggestionRunStart(buf: string): number {
  let best = -1;
  for (let started = 0; started <= SUGGESTIONS_WORD.length && started <= buf.length; started++) {
    if (started > 0 && buf.slice(buf.length - started).toLowerCase() !== SUGGESTIONS_WORD.slice(0, started)) continue;
    let at = buf.length - started;
    for (let tokens = 0; tokens < MAX_RUN_TOKENS; tokens++) {
      if (at >= 11 && buf.slice(at - 11, at).toLowerCase() === SUGGESTIONS_WORD) at -= 11;
      else if (at >= 10 && buf.slice(at - 10, at).toLowerCase() === "suggestion") at -= 10;
      else break;
    }
    if (at < buf.length && (best === -1 || at < best)) best = at;
  }
  return best;
}

function computeHoldStart(buf: string): number {
  let hold = buf.length;
  const consider = (i: number): void => {
    if (i >= 0 && i < hold) hold = i;
  };

  consider(pairedPipeHoldStart(buf));
  const lt = buf.lastIndexOf("<");
  if (lt > buf.lastIndexOf(">") && couldBeTagStart(buf.slice(lt))) consider(lt);
  consider(imageHoldStart(buf));
  consider(trailingSuggestionRunStart(buf));
  consider(mermaidHoldStart(buf));

  return hold;
}

function stripClosedMermaidFences(text: string): string {
  return text.replace(CLOSED_MERMAID_FENCE, "");
}

export function mergeMessageChunks(events: SSEEvent[]): SSEEvent[] {
  const out: SSEEvent[] = [];
  for (const event of events) {
    const last = out.at(-1);
    if (event.event === "copilotMessageChunk" && last?.event === "copilotMessageChunk") {
      out[out.length - 1] = streamingMessageChunk(
        `${(last.data as { delta: string }).delta}${(event.data as { delta: string }).delta}`,
      );
    } else {
      out.push(event);
    }
  }
  return out;
}

export function makeTextSink(ctx: TextSinkContext): TextSink {
  let pending = "";
  let suggestionsMode = false;
  let suggestionsHold = "";
  let weaveBuf = "";
  let artifactsWoven = false;
  let everHadArtifacts = false;
  let emitted = false;
  let shown = "";

  function flushArtifacts(): SSEEvent[] {
    const out: SSEEvent[] = [];
    while (ctx.deferredAnswerArtifactEvents.length > 0) {
      out.push(ctx.deferredAnswerArtifactEvents.shift()!);
      ctx.onArtifactEmitted();
    }
    artifactsWoven = true;
    return out;
  }

  function chunk(text: string): SSEEvent {
    emitted = true;
    shown += text;
    return streamingMessageChunk(text);
  }

  function splitForArtifactInsertion(text: string): { before: string; after: string } {
    const paragraph = PARAGRAPH_BREAK.exec(text);
    if (paragraph && paragraph.index > 0) {
      const splitAt = paragraph.index + paragraph[0].length;
      return { before: text.slice(0, splitAt), after: text.slice(splitAt) };
    }
    const sentence = /^([\s\S]{40,280}?[.!?])\s+/.exec(text);
    if (sentence?.[1]) {
      return { before: text.slice(0, sentence[0].length), after: text.slice(sentence[0].length) };
    }
    return { before: "", after: text };
  }

  function emitSafe(rawSafe: string, final: boolean): SSEEvent[] {
    if (ctx.deferredAnswerArtifactEvents.length > 0) everHadArtifacts = true;

    let clean = stripPlaceholderTags(rawSafe);
    if (everHadArtifacts) clean = stripClosedMermaidFences(clean);

    const artifactPending = ctx.deferredAnswerArtifactEvents.length > 0 && !artifactsWoven;
    const events: SSEEvent[] = [];

    if (artifactPending) {
      weaveBuf += clean;
      const para = PARAGRAPH_BREAK.exec(weaveBuf);
      if (para && para.index > 0) {
        const splitAt = para.index + para[0].length;
        const before = weaveBuf.slice(0, splitAt);
        const after = weaveBuf.slice(splitAt);
        weaveBuf = "";
        if (before) events.push(chunk(before));
        events.push(...flushArtifacts());
        if (after) events.push(chunk(after));
        return events;
      }
      if (final) {
        const { before, after } = splitForArtifactInsertion(weaveBuf);
        weaveBuf = "";
        if (before) events.push(chunk(before));
        events.push(...flushArtifacts());
        if (after) events.push(chunk(after));
        return events;
      }
      return events;
    }

    if (clean) events.push(chunk(clean));
    return events;
  }

  function pushDelta(text: string): SSEEvent[] {
    if (text.length <= MAX_SLICE) return pushSlice(text);
    const events: SSEEvent[] = [];
    for (let i = 0; i < text.length; i += MAX_SLICE) events.push(...pushSlice(text.slice(i, i + MAX_SLICE)));
    return events;
  }

  function pushSlice(text: string): SSEEvent[] {
    if (suggestionsMode) {
      suggestionsHold += text;
      return [];
    }
    pending += text;

    const open = firstTag(SUGGESTIONS_OPEN, pending);
    if (open) {
      const before = pending.slice(0, open.index);
      suggestionsHold = pending.slice(open.index);
      pending = "";
      suggestionsMode = true;
      return emitSafe(before, true);
    }

    const hold = computeHoldStart(pending);
    let safe = pending.slice(0, hold);
    pending = pending.slice(hold);
    if (pending.length > MAX_HOLD) {
      safe += defuseImageStarts(pending);
      pending = "";
    }
    return emitSafe(safe, false);
  }

  function flushTail(): SSEEvent[] {
    if (suggestionsMode) {
      return ctx.deferredAnswerArtifactEvents.length > 0 ? flushArtifacts() : [];
    }
    const out = emitSafe(pending, true);
    pending = "";
    return out;
  }

  function takeSuggestions(): { cleanTail: string; suggestions: string[] } {
    if (!suggestionsMode) return { cleanTail: "", suggestions: [] };
    const { cleanText, suggestions } = parseSuggestions(suggestionsHold);
    return { cleanTail: stripPlaceholderTags(cleanText), suggestions };
  }

  return {
    pushDelta,
    flushTail,
    takeSuggestions,
    get textEmitted() {
      return emitted;
    },
    get text() {
      return shown;
    },
  };
}
