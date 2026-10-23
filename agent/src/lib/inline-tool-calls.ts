import type {
  LanguageModelV3,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3Middleware,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import { getLogger } from "./logger.ts";

const logger = getLogger(["app", "inline-tool-calls"]);

export interface InlineCall {
  name: string;
  input: string;
}

export type InlineSegment = { type: "text"; text: string } | ({ type: "call" } & InlineCall);

interface MarkerFormat {
  open: RegExp;
  close: (open: RegExpExecArray) => RegExp | null;
  read: (body: string, open: RegExpExecArray) => unknown[] | null;
}

const FORMATS: MarkerFormat[] = [
  {
    open: /<(tool_calls?|toolcalls?|function_calls?)>/i,
    close: (open) => new RegExp(`</${open[1]}>`, "i"),
    read: (body) => asCalls(parseJson(body)),
  },
  {
    open: /<function=([\w.:-]+)>/i,
    close: () => /<\/function>/i,
    read: (body, open) => {
      const args = parseJson(body);
      return args === undefined ? null : [{ name: open[1], arguments: args }];
    },
  },
  {
    open: /\[TOOL_CALLS\]/,
    close: () => null,
    read: (body) => asCalls(parseJson(body)),
  },
];

function parseJson(text: string): unknown {
  let body = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fenced) body = fenced[1];
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function asCalls(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return null;
}

function toCall(raw: unknown, toolNames: ReadonlySet<string>): InlineCall | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const inner = record.function && typeof record.function === "object" ? (record.function as Record<string, unknown>) : record;
  const name = inner.name ?? inner.tool ?? inner.tool_name;
  if (typeof name !== "string" || !toolNames.has(name)) return null;
  let args: unknown = inner.arguments ?? inner.parameters ?? inner.input ?? inner.args ?? {};
  if (typeof args === "string") {
    const parsed = parseJson(args);
    if (parsed === undefined) return null;
    args = parsed;
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  return { name, input: JSON.stringify(args) };
}

export function extractInlineToolCalls(
  text: string,
  toolNames: ReadonlySet<string>,
): { segments: InlineSegment[]; dropped: number } {
  const segments: InlineSegment[] = [];
  let dropped = 0;
  let pos = 0;
  const next: (RegExpExecArray | null | undefined)[] = FORMATS.map(() => undefined);
  const globals = FORMATS.map((format) => new RegExp(format.open.source, `${format.open.flags.replace("g", "")}g`));

  const nextMarker = (): { index: number; open: RegExpExecArray } | null => {
    let best: { index: number; open: RegExpExecArray } | null = null;
    for (let i = 0; i < FORMATS.length; i++) {
      let found = next[i];
      if (found === undefined || (found !== null && found.index < pos)) {
        globals[i].lastIndex = pos;
        found = globals[i].exec(text);
        next[i] = found;
      }
      if (found && (best === null || found.index < best.open.index)) best = { index: i, open: found };
    }
    return best;
  };

  for (;;) {
    const marker = nextMarker();
    if (marker === null) break;
    const format = FORMATS[marker.index];
    const open = marker.open;

    const before = text.slice(pos, open.index);
    if (before.trim()) segments.push({ type: "text", text: before });

    const bodyStart = open.index + open[0].length;
    const closePattern = format.close(open);
    let close: RegExpExecArray | null = null;
    if (closePattern) {
      const global = new RegExp(closePattern.source, `${closePattern.flags.replace("g", "")}g`);
      global.lastIndex = bodyStart;
      close = global.exec(text);
    }
    const body = text.slice(bodyStart, close ? close.index : text.length);
    pos = close ? close.index + close[0].length : text.length;

    const raw = format.read(body, open);
    const calls = raw?.map((item) => toCall(item, toolNames)) ?? [];
    if (calls.length === 0 || calls.some((call) => call === null)) {
      dropped++;
      continue;
    }
    for (const call of calls) segments.push({ type: "call", ...(call as InlineCall) });
  }

  const rest = text.slice(pos);
  if (rest.trim()) segments.push({ type: "text", text: rest });
  return { segments, dropped };
}

type ModelTool = { type: string; name?: string };

function offeredToolNames(tools: readonly ModelTool[] | undefined): Set<string> {
  return new Set((tools ?? []).flatMap((tool) => (tool.type === "function" && tool.name ? [tool.name] : [])));
}

const MARKER_HINT = /<(?:tool_?calls?|function_calls?|function=)|\[TOOL_CALLS\]/i;

let nextId = 0;

function finishWithToolCalls(finish: LanguageModelV3FinishReason): LanguageModelV3FinishReason {
  return finish.unified === "stop" ? { ...finish, unified: "tool-calls" } : finish;
}

export const inlineToolCallsMiddleware: LanguageModelV3Middleware = {
  specificationVersion: "v3",

  async wrapGenerate({ doGenerate, params }) {
    const result = await doGenerate();
    const names = offeredToolNames(params.tools as ModelTool[] | undefined);
    if (names.size === 0) return result;
    if (result.content.some((part) => part.type === "tool-call")) return result;

    let called = false;
    const content: LanguageModelV3Content[] = [];
    for (const part of result.content) {
      if (part.type !== "text" || !MARKER_HINT.test(part.text)) {
        content.push(part);
        continue;
      }
      const { segments, dropped } = extractInlineToolCalls(part.text, names);
      if (dropped > 0) logger.warn("Dropped {dropped} inline tool call(s) that could not be read or are not offered", { dropped });
      for (const segment of segments) {
        if (segment.type === "text") {
          content.push({ ...part, text: segment.text });
        } else {
          called = true;
          content.push({ type: "tool-call", toolCallId: `inline-${++nextId}`, toolName: segment.name, input: segment.input });
        }
      }
    }
    return called ? { ...result, content, finishReason: finishWithToolCalls(result.finishReason) } : { ...result, content };
  },

  async wrapStream({ doStream, params }) {
    const result = await doStream();
    const names = offeredToolNames(params.tools as ModelTool[] | undefined);
    if (names.size === 0) return result;

    const held = new Map<string, { start: LanguageModelV3StreamPart; text: string }>();
    const queue: LanguageModelV3StreamPart[] = [];
    let nativeCalls = false;
    let inlineCalls = false;

    const release = (controller: TransformStreamDefaultController<LanguageModelV3StreamPart>) => {
      while (queue.length > 0 && held.size === 0) controller.enqueue(queue.shift()!);
    };

    function finishBlock(id: string, controller: TransformStreamDefaultController<LanguageModelV3StreamPart>): void {
      const block = held.get(id);
      if (!block) return;
      held.delete(id);
      const providerMetadata = (block.start as { providerMetadata?: unknown }).providerMetadata;
      const emitText = (text: string) => {
        const blockId = `${id}-${++nextId}`;
        controller.enqueue({ type: "text-start", id: blockId, ...(providerMetadata ? { providerMetadata } : {}) } as LanguageModelV3StreamPart);
        controller.enqueue({ type: "text-delta", id: blockId, delta: text });
        controller.enqueue({ type: "text-end", id: blockId });
      };
      if (nativeCalls || !MARKER_HINT.test(block.text)) {
        if (block.text) emitText(block.text);
        return;
      }
      const { segments, dropped } = extractInlineToolCalls(block.text, names);
      if (dropped > 0) logger.warn("Dropped {dropped} inline tool call(s) that could not be read or are not offered", { dropped });
      for (const segment of segments) {
        if (segment.type === "text") {
          emitText(segment.text);
        } else {
          inlineCalls = true;
          controller.enqueue({ type: "tool-call", toolCallId: `inline-${++nextId}`, toolName: segment.name, input: segment.input });
        }
      }
    }

    const transform = new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
      transform(part, controller) {
        switch (part.type) {
          case "text-start":
            held.set(part.id, { start: part, text: "" });
            return;
          case "text-delta": {
            const block = held.get(part.id);
            if (block) block.text += part.delta;
            else controller.enqueue(part);
            return;
          }
          case "text-end":
            finishBlock(part.id, controller);
            release(controller);
            return;
          case "tool-call":
            nativeCalls = true;
            break;
          case "finish":
            for (const id of [...held.keys()]) finishBlock(id, controller);
            release(controller);
            controller.enqueue(inlineCalls && !nativeCalls ? { ...part, finishReason: finishWithToolCalls(part.finishReason) } : part);
            return;
        }
        if (held.size > 0) queue.push(part);
        else controller.enqueue(part);
      },
      flush(controller) {
        for (const id of [...held.keys()]) finishBlock(id, controller);
        for (const part of queue.splice(0)) controller.enqueue(part);
      },
    });

    return { ...result, stream: result.stream.pipeThrough(transform) };
  },
};

export function withInlineToolCalls(model: LanguageModelV3): LanguageModelV3 {
  return wrapLanguageModel({ model, middleware: inlineToolCallsMiddleware });
}
