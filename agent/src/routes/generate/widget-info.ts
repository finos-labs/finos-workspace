import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../auth/middleware";
import { parseJsonResponse, truncate } from "../../lib/llm";
import { getLogger } from "../../lib/logger";
import { helperLlm, invalidJson, readJson } from "./helper";

const logger = getLogger(["app", "generate", "widget-info"]);

const MAX_FILE_SIZE = 25 * 1024 * 1024;

const WidgetInfoSchema = z.object({
  widget_generation_request: z.object({
    widget_data: z.string(),
    metadata: z.object({
      name: z.string().max(1000).optional(),
      description: z.string().max(1000).optional(),
      type: z.string().max(1000).optional(),
      category: z.string().max(1000).optional(),
      subCategory: z.string().max(1000).optional(),
      endpoint: z.string().max(1000).optional(),
      params: z.array(z.unknown()).optional(),
    }).optional(),
    name: z.string().optional(),
    description: z.string().optional(),
  }),
  model: z.string().max(200).optional(),
});

export const widgetInfoRouter = new Hono<AppEnv>();

widgetInfoRouter.post("/v1/generate/widget_info", async (c) => {
  const raw = await readJson(c);
  if (raw === null) return invalidJson(c);
  const parsed = WidgetInfoSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const { widget_generation_request: req, model } = parsed.data;
  const dataSample = truncate(req.widget_data, 3000);
  const meta = req.metadata;

  const metaBlock = meta
    ? `\nMetadata: name=${meta.name ?? "?"}, description=${meta.description ?? "?"}, type=${meta.type ?? "?"}, category=${meta.category ?? "?"}, subCategory=${meta.subCategory ?? "?"}, endpoint=${meta.endpoint ?? "?"}`
    : "";

  const prompt =
    "Classify this financial data widget. Return a JSON object with these fields:\n" +
    '{ "title": "short display name (max 50 chars)", "description": "one-sentence description", ' +
    '"category": "one of: Equity, Fixed Income, Macro, Crypto, Alternatives, Derivatives, Other", ' +
    '"subcategory": "specific label e.g. Price History, Fundamentals, News" }\n\n' +
    "Return ONLY valid JSON, no markdown fences." +
    metaBlock +
    `\n\nData sample:\n${dataSample}`;

  const fallback = {
    title: req.name ?? meta?.name ?? "Untitled Widget",
    description: req.description ?? meta?.description ?? "",
    category: meta?.category ?? "Other",
    subcategory: meta?.subCategory ?? "",
  };

  try {
    const text = await helperLlm(c, prompt, { model, functionId: "generate.widget-info" });
    const result = parseJsonResponse(text, fallback);
    logger.info("widget_info generated", { title: result.title });
    return c.json(result);
  } catch (err) {
    logger.warn("widget_info failed", { error: err instanceof Error ? err.message : String(err) });
    return c.json(fallback);
  }
});

widgetInfoRouter.post("/v1/generate/widget_info/file", async (c) => {
  const formData = await c.req.formData().catch(() => null);
  if (!formData) return c.json({ error: "Invalid form data" }, 400);
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return c.json({ error: "Missing 'file' field in form data" }, 400);
  }
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, 413);
  }

  const content = await file.text();
  const sample = truncate(content, 3000);
  const filename = file.name || "unknown";

  const prompt =
    "Classify this uploaded financial data file. Return a JSON object:\n" +
    '{ "title": "short display name (max 50 chars)", "description": "one-sentence description" }\n\n' +
    "Return ONLY valid JSON, no markdown fences.\n\n" +
    `Filename: ${filename}\n` +
    `Content sample:\n${sample}`;

  const fallback = { title: filename.replace(/\.[^.]+$/, ""), description: filename };

  try {
    const text = await helperLlm(c, prompt, { functionId: "generate.widget-info.fallback" });
    const result = parseJsonResponse(text, fallback);
    logger.info("widget_info/file generated", { title: result.title, filename });
    return c.json(result);
  } catch (err) {
    logger.warn("widget_info/file failed", { error: err instanceof Error ? err.message : String(err) });
    return c.json(fallback);
  }
});
