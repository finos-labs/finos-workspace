import type { Context } from "hono";
import { z } from "zod";
import { ANONYMOUS, type AppEnv } from "../../auth/middleware.ts";
import { singleShotLlm } from "../../lib/llm.ts";
import { getLogger } from "../../lib/logger.ts";
import { metrics } from "../../lib/metrics.ts";
import { AGENT_ID } from "../agents.ts";

const audit = getLogger(["audit"]);

export const MAX_HELPER_TEXT_CHARS = 4_000;

export const modelField = z
  .string()
  .max(200)
  .optional()
  .describe(
    "A model to use instead of DEFAULT_MODEL, written <provider>:<model>. Ines uses it only when this deployment offers it and the user's roles allow it.",
  );

export async function readJson(c: Context<AppEnv>): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

export const invalidJson = (c: Context<AppEnv>) => c.json({ error: "Invalid JSON" }, 400);

async function modelFor(c: Context<AppEnv>, requested: string | undefined): Promise<string | undefined> {
  const fallback = process.env.DEFAULT_MODEL;
  if (!requested || requested === fallback) return fallback;
  const services = c.get("services");
  const principal = c.get("principal") ?? ANONYMOUS;
  let allowed = !services || services.config.models.includes(requested);
  if (allowed && services?.workspace) {
    const authorization = await services.workspace.authorize(principal.token, { agentId: AGENT_ID, model: requested, tools: [] });
    allowed = authorization.ok && !authorization.value.deniedModel;
  }
  if (allowed) return requested;
  audit.info("A helper asked for the model {model}, which is not allowed here: the default is used", { model: requested });
  return fallback;
}

export async function helperLlm(
  c: Context<AppEnv>,
  prompt: string,
  opts: { model?: string; maxTokens?: number; functionId: string },
): Promise<string> {
  const services = c.get("services");
  const principal = c.get("principal") ?? ANONYMOUS;
  const model = await modelFor(c, opts.model);
  return singleShotLlm(prompt, {
    model,
    maxTokens: opts.maxTokens,
    functionId: opts.functionId,
    onUsage: (usage) => {
      metrics.modelTokens.inc({ direction: "input" }, usage.inputTokens);
      metrics.modelTokens.inc({ direction: "output" }, usage.outputTokens);
      if (services?.workspace) void services.workspace.recordTokens(principal.token, usage.totalTokens);
    },
  });
}
