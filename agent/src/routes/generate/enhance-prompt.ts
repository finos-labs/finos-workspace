import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../auth/middleware.ts";
import { truncate } from "../../lib/llm.ts";
import { getLogger } from "../../lib/logger.ts";
import { helperLlm, invalidJson, MAX_HELPER_TEXT_CHARS, modelField, readJson } from "./helper.ts";

const logger = getLogger(["app", "generate", "enhance-prompt"]);

export const ENHANCE_WIDGET_NAMES = 30;
export const ENHANCE_WIDGET_NAME_CHARS = 100;

export const EnhancePromptSchema = z.object({
  messages: z
    .array(z.unknown())
    .min(1)
    .max(1000)
    .describe("The conversation. The agent rewrites the last message that has the role human and a text as its content."),
  widgets: z
    .unknown()
    .optional()
    .describe("The widgets in the tiers primary, secondary and extra, as in a query. The agent uses their names as hints."),
  context: z.unknown().optional().describe("Accepted and not used."),
  urls: z.array(z.string()).optional().describe("Accepted and not used."),
  workspace_state: z.unknown().optional().describe("Accepted and not used."),
  workspace_options: z.record(z.string(), z.union([z.boolean(), z.string()])).optional().describe("Accepted and not used."),
  timezone: z.string().optional().describe("Accepted and not used."),
  tools: z.array(z.unknown()).optional().describe("Accepted and not used."),
  model: modelField,
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
          names.push(truncate(widget.name, ENHANCE_WIDGET_NAME_CHARS));
        }
      }
    }
  }
  return names.slice(0, ENHANCE_WIDGET_NAMES);
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
