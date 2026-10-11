import { z } from "zod";
import type { LanguageModelUsage } from "ai";
import type { SSEEvent } from "../protocol/types";

/**
 * Token counts for one or more model calls.
 *
 * `cachedInputTokens` and `cacheWriteTokens` are SUBSETS of `inputTokens`, not
 * additions to it — every provider reports prompt-cache reads as a slice of
 * the prompt it already billed. Treating them as separate would double-count
 * both the token total and the cost.
 */
export interface UsageCounts {
  inputTokens: number;
  /** Input tokens served from the provider's prompt cache (subset of `inputTokens`). */
  cachedInputTokens: number;
  /** Input tokens written INTO an explicit cache (Anthropic-style; subset of `inputTokens`). */
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

/**
 * Normalize one call's usage into `UsageCounts`.
 *
 * Cache reads come from `inputTokenDetails.cacheReadTokens`, falling back to
 * the deprecated flat `cachedInputTokens` so a provider adapter that has not
 * moved to the detailed shape still reports hits instead of silent zeros.
 *
 * Both cache figures are clamped into `inputTokens`. A provider reporting more
 * cached tokens than prompt tokens is a bug on their side, but left unclamped
 * it produces a hit rate above 100% and a negative uncached-token count.
 */
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

/**
 * Share of input tokens served from the prompt cache, 0..1.
 *
 * This is the number that says whether the system-prompt prefix is holding: a
 * multi-step turn re-sends the same system-prompt-plus-tools prefix on every
 * step and every re-POST, so a healthy turn trends toward 1 as it goes. A rate
 * that collapses mid-turn means something in `buildSystemPrompt` changed
 * between calls and invalidated the prefix.
 *
 * Returns 0 rather than NaN for a turn with no input tokens, so the value is
 * always safe to hand to a span attribute.
 */
export function cacheHitRate(usage: {
  inputTokens: number;
  cachedInputTokens: number;
}): number {
  if (usage.inputTokens <= 0) return 0;
  return Number((usage.cachedInputTokens / usage.inputTokens).toFixed(4));
}

/**
 * Token usage for a whole logical turn — i.e. summed across every re-POST the
 * round-trip protocol produced, not just the current request. Rides
 * `extra_state.turn_usage` so it survives the browser hop.
 *
 * Input tokens grow on each re-POST because `buildMessages` re-renders the
 * conversation (including earlier tool results) every time. The turn total is
 * therefore the sum of a growing series, which is what you actually pay and
 * what per-request logging structurally hides. Cached input is what makes that
 * growth affordable, so it rides along: the raw turn total reads far more
 * alarming than the invoice once a warm cache is serving most of the prefix.
 */
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

/**
 * Cache fields default to 0 rather than being required: a turn already in
 * flight when this deploy lands echoes the older four-field shape, and
 * rejecting it would zero a running turn's counter mid-conversation.
 */
const TurnUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  postCount: z.number().int().nonnegative(),
});

/**
 * Read the echoed turn total. Untrusted (browser-echoed) input: anything
 * malformed resets to zero rather than throwing, because a bad counter must
 * never cost the user their turn.
 */
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
