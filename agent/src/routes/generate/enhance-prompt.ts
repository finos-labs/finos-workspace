import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../auth/middleware";
import { truncate } from "../../lib/llm";
import { getLogger } from "../../lib/logger";
import { helperLlm, invalidJson, MAX_HELPER_TEXT_CHARS, readJson } from "./helper";

const logger = getLogger(["app", "generate", "enhance-prompt"]);

const EnhancePromptSchema = z.object({
  messages: z.array(z.unknown()).min(1).max(1000),
  widgets: z.unknown().optional(),
  context: z.unknown().optional(),
  urls: z.array(z.string()).optional(),
  workspace_state: z.unknown().optional(),
  workspace_options: z.record(z.string(), z.union([z.boolean(), z.string()])).optional(),
  timezone: z.string().optional(),
  tools: z.array(z.unknown()).optional(),
  model: z.string().max(200).optional(),
});

function extractWidgetNames(widgets: unknown): string[] {
  if (!widgets || typeof widgets !== "object") return [];
  const w = widgets as Record<string, unknown>;
  const names: string[] = [];
  for (const tier of ["primary", "secondary", "extra"]) {
    const arr = w[tier];
    if (Array.isArray(arr)) {
      for (const widget of arr) {
        if (widget && typeof widget === "object" && "name" in widget && typeof widget.name === "string") {
          names.push(truncate(widget.name, 100));
        }
      }
    }
  }
  return names.slice(0, 30);
}

export const enhancePromptRouter = new Hono<AppEnv>();

enhancePromptRouter.post("/v1/enhance_prompt", async (c) => {
  const raw = await readJson(c);
  if (raw === null) return invalidJson(c);
  const parsed = EnhancePromptSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const { messages, widgets, model } = parsed.data;

  const lastHuman = (messages as Array<{ role?: string; content?: string }>)
    .filter((m) => m.role === "human" && typeof m.content === "string")
    .at(-1);

  if (!lastHuman?.content) return c.text("");

  const widgetNames = extractWidgetNames(widgets);
  const contextLine = widgetNames.length > 0
    ? `\nAvailable data sources: ${widgetNames.join(", ")}`
    : "";

  const prompt =
    "You are enhancing a query for a financial AI assistant. " +
    "Rewrite the query below to be more specific and actionable. " +
    "Do NOT change the user's intent. Return ONLY the enhanced prompt text, nothing else.\n" +
    contextLine +
    `\n\nOriginal query: ${truncate(lastHuman.content, MAX_HELPER_TEXT_CHARS)}`;

  try {
    const enhanced = await helperLlm(c, prompt, { model, functionId: "generate.enhance-prompt" });
    const cleaned = enhanced.replace(/^["']|["']$/g, "");
    logger.info("enhance_prompt done", { original: truncate(lastHuman.content, 100), enhanced: truncate(cleaned, 100) });
    return c.text(cleaned);
  } catch (err) {
    logger.warn("enhance_prompt failed", { error: err instanceof Error ? err.message : String(err) });
    return c.text(lastHuman.content);
  }
});
