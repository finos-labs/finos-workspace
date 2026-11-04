import { generateText } from "ai";
import { PROVIDER_OPTIONS, resolveModel } from "./providers.ts";
import { aiTelemetry } from "./telemetry.ts";

const DEFAULT_TIMEOUT_MS = 60_000;

export async function singleShotLlm(
  prompt: string,
  opts?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    functionId?: string;
    onUsage?: (usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => void;
  },
): Promise<string> {
  const modelId = opts?.model || process.env.DEFAULT_MODEL;
  if (!modelId) {
    throw new Error("No model configured: set DEFAULT_MODEL.");
  }
  const model = resolveModel(modelId);
  const result = await generateText({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: opts?.temperature ?? 0.1,
    maxOutputTokens: opts?.maxTokens ?? 1024,
    providerOptions: PROVIDER_OPTIONS,
    abortSignal: AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    experimental_telemetry: aiTelemetry(opts?.functionId ?? "single-shot", {
      model: modelId,
    }),
  });
  if (opts?.onUsage) {
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    opts.onUsage({ inputTokens, outputTokens, totalTokens: result.usage.totalTokens ?? inputTokens + outputTokens });
  }
  return result.text.trim();
}

export function parseJsonResponse<T>(raw: string, fallback: T): T {
  const cleaned = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
