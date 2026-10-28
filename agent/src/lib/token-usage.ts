import { z } from "zod";
import type { LanguageModelUsage } from "ai";
import type { SSEEvent } from "../protocol/types.ts";

export interface UsageCounts {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export const ZERO_USAGE_COUNTS: UsageCounts = Object.freeze({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
});

export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  modelId: z.string(),
  loopCount: z.number().int().nonnegative(),
  stepCount: z.number().int().nonnegative(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export function flattenUsage(usage: LanguageModelUsage): UsageCounts {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const details = usage.inputTokenDetails;
  const rawRead = details?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;
  const rawWrite = details?.cacheWriteTokens ?? 0;
  const cachedInputTokens = Math.max(0, Math.min(rawRead, input));
  const cacheWriteTokens = Math.max(0, Math.min(rawWrite, input - cachedInputTokens));
  return {
    inputTokens: input,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens: output,
    totalTokens: input + output,
  };
}

export function accumulateUsage(acc: UsageCounts, next: UsageCounts): UsageCounts {
  return {
    inputTokens: acc.inputTokens + next.inputTokens,
    cachedInputTokens: acc.cachedInputTokens + next.cachedInputTokens,
    cacheWriteTokens: acc.cacheWriteTokens + next.cacheWriteTokens,
    outputTokens: acc.outputTokens + next.outputTokens,
    totalTokens: acc.totalTokens + next.totalTokens,
  };
}

export function cacheHitRate(usage: {
  inputTokens: number;
  cachedInputTokens: number;
}): number {
  if (usage.inputTokens <= 0) return 0;
  return Number((usage.cachedInputTokens / usage.inputTokens).toFixed(4));
}

export interface TurnUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
  postCount: number;
}

export const ZERO_TURN_USAGE: TurnUsage = Object.freeze({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  postCount: 0,
});

const TurnUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  postCount: z.number().int().nonnegative(),
});

export function readTurnUsage(raw: unknown): TurnUsage {
  const parsed = TurnUsageSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...ZERO_TURN_USAGE };
}

export function usageHiddenEvent(usage: TokenUsage): SSEEvent {
  const hitRate = cacheHitRate(usage);
  return {
    event: "copilotStatusUpdate",
    data: {
      eventType: "INFO",
      message: "token_usage",
      group: "reasoning",
      hidden: true,
      details: [
        { label: "Model", value: usage.modelId },
        { label: "Input tokens", value: usage.inputTokens },
        { label: "Cached input tokens", value: usage.cachedInputTokens },
        { label: "Cache hit rate", value: `${(hitRate * 100).toFixed(1)}%` },
        { label: "Output tokens", value: usage.outputTokens },
        { label: "Total tokens", value: usage.totalTokens },
        { label: "Loop count", value: usage.loopCount },
        { label: "Step count", value: usage.stepCount },
      ],
    },
  };
}

export function usageVisibleEvent(usage: TokenUsage): SSEEvent {
  return {
    event: "copilotStatusUpdate",
    data: {
      eventType: "INFO",
      message: `Used ${usage.totalTokens.toLocaleString()} tokens`,
      group: "reasoning",
    },
  };
}
