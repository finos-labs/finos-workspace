import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream, type LanguageModel } from "ai";
import type {
  LanguageModelV3Content,
  LanguageModelV3GenerateResult,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";

type ToolCallSpec = {
  toolCallId?: string;
  toolName: string;
  input: unknown;
};

type LlmStep = {
  text?: string;
  textDeltas?: string[];
  toolCalls?: ToolCallSpec[];
  finishReason?: "stop" | "tool-calls" | "length" | "content-filter" | "error";
};

function stepText(step: LlmStep): string | undefined {
  if (step.textDeltas != null) return step.textDeltas.join("");
  return step.text;
}

const DEFAULT_USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
  totalTokens: 2,
};

function unifiedFinish(
  finishReason: LlmStep["finishReason"],
  hasToolCalls: boolean,
): LanguageModelV3FinishReason {
  const u = finishReason ?? (hasToolCalls ? "tool-calls" : "stop");
  return { unified: u, raw: u };
}

function buildResult(step: LlmStep): LanguageModelV3GenerateResult {
  const content: LanguageModelV3Content[] = [];
  const text = stepText(step);
  if (text != null) content.push({ type: "text", text });
  let toolCallIdx = 0;
  for (const tc of step.toolCalls ?? []) {
    content.push({
      type: "tool-call",
      toolCallId: tc.toolCallId ?? `c${++toolCallIdx}`,
      toolName: tc.toolName,
      input: typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input),
    });
  }
  return {
    content,
    finishReason: unifiedFinish(step.finishReason, (step.toolCalls?.length ?? 0) > 0),
    usage: DEFAULT_USAGE,
    warnings: [],
  } as unknown as LanguageModelV3GenerateResult;
}

function buildStream(step: LlmStep): { stream: ReadableStream<LanguageModelV3StreamPart> } {
  const chunks: LanguageModelV3StreamPart[] = [{ type: "stream-start", warnings: [] }];
  const textParts = step.textDeltas ?? (step.text != null ? [step.text] : null);
  if (textParts != null) {
    chunks.push({ type: "text-start", id: "t0" });
    for (const part of textParts) {
      chunks.push({ type: "text-delta", id: "t0", delta: part });
    }
    chunks.push({ type: "text-end", id: "t0" });
  }
  let toolCallIdx = 0;
  for (const tc of step.toolCalls ?? []) {
    chunks.push({
      type: "tool-call",
      toolCallId: tc.toolCallId ?? `c${++toolCallIdx}`,
      toolName: tc.toolName,
      input: typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input),
    });
  }
  chunks.push({
    type: "finish",
    finishReason: unifiedFinish(step.finishReason, (step.toolCalls?.length ?? 0) > 0),
    usage: DEFAULT_USAGE,
  });
  return { stream: simulateReadableStream({ chunks }) };
}

export function makeMockLlm(step: LlmStep): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => buildResult(step),
    doStream: async () => buildStream(step),
  } as unknown as ConstructorParameters<typeof MockLanguageModelV3>[0]) as unknown as LanguageModel;
}

export function makeErroringStreamMockLlm(error: unknown): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => buildResult({ finishReason: "error" }),
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "error", error } as unknown as LanguageModelV3StreamPart,
        ],
      }),
    }),
  } as unknown as ConstructorParameters<typeof MockLanguageModelV3>[0]) as unknown as LanguageModel;
}

export function makeSequencedMockLlm(steps: LlmStep[]): LanguageModel {
  let genIdx = 0;
  let streamIdx = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => buildResult(steps[Math.min(genIdx++, steps.length - 1)]),
    doStream: async () => buildStream(steps[Math.min(streamIdx++, steps.length - 1)]),
  } as unknown as ConstructorParameters<typeof MockLanguageModelV3>[0]) as unknown as LanguageModel;
}

export interface SpyMockLlm {
  model: LanguageModel;
  calls: Array<{ tools?: Record<string, unknown>; messages?: unknown }>;
}

export function makeSpyMockLlm(step: LlmStep): SpyMockLlm {
  const calls: SpyMockLlm["calls"] = [];
  const capture = (opts: Record<string, unknown>) =>
    calls.push({ tools: opts.tools as Record<string, unknown>, messages: opts.prompt });
  const model = new MockLanguageModelV3({
    doGenerate: async (opts: Record<string, unknown>) => {
      capture(opts);
      return buildResult(step);
    },
    doStream: async (opts: Record<string, unknown>) => {
      capture(opts);
      return buildStream(step);
    },
  } as unknown as ConstructorParameters<typeof MockLanguageModelV3>[0]) as unknown as LanguageModel;
  return { model, calls };
}

export function makeSequencedSpyMockLlm(steps: LlmStep[]): SpyMockLlm {
  const calls: SpyMockLlm["calls"] = [];
  const capture = (opts: Record<string, unknown>) =>
    calls.push({ tools: opts.tools as Record<string, unknown>, messages: opts.prompt });
  let genIdx = 0;
  let streamIdx = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (opts: Record<string, unknown>) => {
      capture(opts);
      return buildResult(steps[Math.min(genIdx++, steps.length - 1)]);
    },
    doStream: async (opts: Record<string, unknown>) => {
      capture(opts);
      return buildStream(steps[Math.min(streamIdx++, steps.length - 1)]);
    },
  } as unknown as ConstructorParameters<typeof MockLanguageModelV3>[0]) as unknown as LanguageModel;
  return { model, calls };
}


export function llmEmitsText(text: string): LlmStep {
  return { text, finishReason: "stop" };
}

export function llmEmitsTextInDeltas(parts: string[]): LlmStep {
  return { textDeltas: parts, finishReason: "stop" };
}

export function llmCallsTool(toolName: string, input: unknown): LlmStep {
  return { toolCalls: [{ toolName, input }], finishReason: "tool-calls" };
}

export function llmCallsToolWithText(
  toolName: string,
  input: unknown,
  text: string,
): LlmStep {
  return { text, toolCalls: [{ toolName, input }], finishReason: "tool-calls" };
}
