import { metrics } from "../../../src/lib/metrics.ts";
import { getLogger } from "./logger.ts";

const logger = getLogger(["mcp", "tools"]);

function isErrorResult(result: unknown): boolean {
  const content = (result as { content?: { text?: unknown }[] } | null)?.content;
  return (content ?? []).some((item) => typeof item.text === "string" && item.text.includes('"$ines_kind":"error"'));
}

export function observed<A, R>(tool: string, handler: (args: A) => Promise<R>): (args: A) => Promise<R> {
  return async (args) => {
    const started = performance.now();
    let outcome = "ok";
    try {
      const result = await handler(args);
      if (isErrorResult(result)) outcome = "error";
      return result;
    } catch (error) {
      outcome = "error";
      throw error;
    } finally {
      const seconds = (performance.now() - started) / 1000;
      metrics.toolCalls.inc({ tool, outcome });
      metrics.toolDuration.observe(seconds, { tool });
      logger.info("Tool {tool} finished: {outcome}", {
        tool,
        outcome,
        durationMs: Math.round(seconds * 1000),
        conversationId: (args as { "x-ines-conversation-id"?: string } | null)?.["x-ines-conversation-id"] ?? null,
      });
    }
  };
}
