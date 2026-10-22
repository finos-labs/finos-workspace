/**
 * LLM-as-judge grader. Cheap model scores the agent's final answer
 * against a free-form criterion. Returns pass/fail based on a numeric
 * score >= threshold.
 *
 * The judge model is EVAL_JUDGE_MODEL, else EVAL_MODEL, else DEFAULT_MODEL;
 * none is baked in.
 */

import { generateText } from "ai";
import { resolveModel } from "../../src/lib/providers.ts";
import type { Trace } from "../trace.ts";
import type { GraderSpec } from "./index.ts";

const JUDGE_MODEL =
  process.env.EVAL_JUDGE_MODEL || process.env.EVAL_MODEL || process.env.DEFAULT_MODEL;

export interface LlmJudgeArgs {
  criterion: string;
  threshold?: number;
}

function buildJudgePrompt(criterion: string, trace: Trace): string {
  const toolSummary = trace.toolCalls
    .map((c) => `${c.serverToolName ?? c.name}(${JSON.stringify(c.parameters).slice(0, 200)})`)
    .join("\n");
  const finalText = trace.finalText.slice(0, 4000);

  return [
    "You are scoring an AI agent run against a single criterion.",
    "Return ONLY a JSON object: { \"score\": <0..1>, \"reason\": \"<one sentence>\" }",
    "",
    `Criterion: ${criterion}`,
    "",
    "Tool calls (in order):",
    toolSummary || "(none)",
    "",
    "Final answer text:",
    finalText || "(no final answer)",
    "",
    "Score 0 (clearly fails) to 1 (clearly meets criterion). Be strict.",
  ].join("\n");
}

interface JudgeResult {
  score: number;
  reason: string;
}

function parseJudgeResponse(text: string): JudgeResult | null {
  const cleaned = text.replace(/^```json\n?/, "").replace(/\n?```$/, "");
  try {
    const parsed = JSON.parse(cleaned) as { score?: unknown; reason?: unknown };
    if (typeof parsed.score === "number" && typeof parsed.reason === "string") {
      return { score: parsed.score, reason: parsed.reason };
    }
  } catch {
    // fall through
  }
  return null;
}

async function callJudge(prompt: string): Promise<string> {
  if (!JUDGE_MODEL) {
    throw new Error("No judge model: set EVAL_JUDGE_MODEL, EVAL_MODEL or DEFAULT_MODEL");
  }
  const result = await generateText({
    model: resolveModel(JUDGE_MODEL),
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    maxOutputTokens: 200,
  });
  return result.text;
}

export function llmJudge(args: LlmJudgeArgs): GraderSpec {
  const threshold = args.threshold ?? 0.7;
  return {
    name: `llmJudge(threshold=${threshold})`,
    grader: async (trace: Trace) => {
      const prompt = buildJudgePrompt(args.criterion, trace);
      try {
        const raw = await callJudge(prompt);
        const judged = parseJudgeResponse(raw);
        if (!judged) {
          return { pass: false, message: `Judge returned unparseable: ${raw.slice(0, 100)}` };
        }
        return judged.score >= threshold
          ? { pass: true, message: `score=${judged.score.toFixed(2)} ${judged.reason}` }
          : { pass: false, message: `score=${judged.score.toFixed(2)} (< ${threshold}) ${judged.reason}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { pass: false, message: `judge error: ${msg}` };
      }
    },
  };
}
