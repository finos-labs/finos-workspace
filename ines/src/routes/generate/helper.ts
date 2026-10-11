/**
 * What every helper route (/v1/generate/*, /v1/enhance_prompt) does around its model call.
 *
 * A helper is a small single-shot call made for the signed-in user, paid for with the operator's provider
 * keys, so it follows the same rules as a question: the model is one the deployment offers and the user's
 * roles allow (a client's `model` is a request, not a command), and its tokens count against the user.
 */

import type { Context } from "hono";
import { ANONYMOUS, type AppEnv } from "../../auth/middleware";
import { singleShotLlm } from "../../lib/llm";
import { getLogger } from "../../lib/logger";
import { metrics } from "../../lib/metrics";
import { AGENT_ID } from "../agents";

const audit = getLogger(["audit"]);

/** The most of a client's text that goes into a helper's prompt: a helper is a one-line question, not a document. */
export const MAX_HELPER_TEXT_CHARS = 4_000;

/** A JSON body, or null when there is none that parses. */
export async function readJson(c: Context<AppEnv>): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

export const invalidJson = (c: Context<AppEnv>) => c.json({ error: "Invalid JSON" }, 400);

/**
 * The model for a helper: the one the client asks for if this deployment offers it and the user's roles
 * allow it, else DEFAULT_MODEL. With neither there is no model, and the call says so.
 */
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

/** A helper's model call, on behalf of the signed-in user, counted against them. */
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
