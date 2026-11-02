import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../auth/middleware.ts";
import { parseJsonResponse, truncate } from "../../lib/llm.ts";
import { getLogger } from "../../lib/logger.ts";
import {
  bodyTooLarge,
  defineRoute,
  invalidRequest,
  json,
  named,
  tooManyRequests,
  unauthorized,
} from "../../lib/openapi.ts";
import { helperLlm, invalidJson, modelField, readJson } from "./helper.ts";

const logger = getLogger(["app", "generate", "widget-info"]);

export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const WIDGET_SAMPLE_CHARS = 3000;

const MEBIBYTE = 1024 * 1024;

export const WidgetInfoSchema = z.object({
  widget_generation_request: z
    .object({
      widget_data: z.string().describe("A sample of the widget's data, as text."),
      metadata: z
        .object({
          name: z.string().max(1000).optional().describe("The widget's name."),
          description: z.string().max(1000).optional().describe("The widget's description."),
          type: z.string().max(1000).optional().describe("The widget's type, for example markdown or html."),
          category: z.string().max(1000).optional().describe("The widget's category."),
          subCategory: z.string().max(1000).optional().describe("The widget's sub-category."),
          endpoint: z.string().max(1000).optional().describe("The endpoint that serves the widget."),
          params: z.array(z.unknown()).optional().describe("Accepted and not used."),
        })
        .optional()
        .describe("What the widget's definition says about it. The prompt includes it, and the fallback uses it."),
      name: z.string().optional().describe("The widget's name, which the fallback uses."),
      description: z.string().optional().describe("The widget's description, which the fallback uses."),
    })
    .describe("The widget to describe."),
  model: modelField,
});

export const widgetInfoRoute = defineRoute({
  method: "POST",
  path: "/v1/generate/widget_info",
  tag: "generate",
  summary: "Describes and classifies a widget from a sample of its data.",
  description: "Tells what a widget shows and which kind of widget it is. The agent makes one call to the model and never runs tools.",
  request: { contentType: "application/json", required: true, schema: named("WidgetInfoRequest", WidgetInfoSchema) },
  responses: [
    {
      code: "200",
      description: "The title, the description, the category and the sub-category of the widget.",
      schema: named(
        "WidgetInfo",
        z.object({
          title: z.string().describe("The name to show for the widget."),
          description: z.string().describe("What the widget shows."),
          category: z.string().describe("The category of the widget, such as Equity or Macro."),
          subcategory: z.string().describe("The sub-category of the widget, such as Price History."),
        }),
        "output",
      ),
    },
    invalidRequest(),
    unauthorized(),
    bodyTooLarge(),
    tooManyRequests(),
  ],
  secured: true,
  helper: {
    detail: `The agent reads the first ${WIDGET_SAMPLE_CHARS.toLocaleString("en-US")} characters of widget_data.`,
    answer: "A JSON object with title, description, category and subcategory.",
    fallback: "An object made from the request's own name, description and metadata, with the category Other.",
  },
});

export const widgetInfoFileRoute = defineRoute({
  method: "POST",
  path: "/v1/generate/widget_info/file",
  tag: "generate",
  summary: "Describes an uploaded file.",
  description: "Tells what an uploaded file holds. The agent makes one call to the model and never runs tools.",
  request: {
    contentType: "multipart/form-data",
    required: true,
    schema: json("WidgetInfoFileRequest", {
      type: "object",
      properties: {
        file: { type: "string", format: "binary", description: "The file to describe." },
      },
      required: ["file"],
    }),
  },
  responses: [
    {
      code: "200",
      description: "The title and the description of the file.",
      schema: named(
        "WidgetInfoFile",
        z.object({
          title: z.string().describe("The name to show for the file."),
          description: z.string().describe("What the file holds."),
        }),
        "output",
      ),
    },
    invalidRequest(),
    unauthorized(),
    bodyTooLarge(),
    tooManyRequests(),
  ],
  secured: true,
  helper: {
    detail:
      `The request is a multipart form with the field file, at most ${MAX_FILE_SIZE / MEBIBYTE} MiB, ` +
      `and the agent reads its first ${WIDGET_SAMPLE_CHARS.toLocaleString("en-US")} characters. ` +
      "A form without the field is answered with 400 and a file that is too large with 413.",
    answer: "A JSON object with title and description.",
    fallback: "The file's name without its extension as the title, and the file's name as the description.",
  },
});

export const widgetInfoRouter = new Hono<AppEnv>();

widgetInfoRouter.post(widgetInfoRoute.path, async (c) => {
  const raw = await readJson(c);
  if (raw === null) return invalidJson(c);
  const parsed = WidgetInfoSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const { widget_generation_request: req, model } = parsed.data;
  const dataSample = truncate(req.widget_data, WIDGET_SAMPLE_CHARS);
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

widgetInfoRouter.post(widgetInfoFileRoute.path, async (c) => {
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
  const sample = truncate(content, WIDGET_SAMPLE_CHARS);
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
