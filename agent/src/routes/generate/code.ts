import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../auth/middleware.ts";
import { parseJsonResponse, truncate } from "../../lib/llm.ts";
import { getLogger } from "../../lib/logger.ts";
import {
  bodyTooLarge,
  defineRoute,
  invalidRequest,
  named,
  tooManyRequests,
  unauthorized,
} from "../../lib/openapi.ts";
import { helperLlm, invalidJson, MAX_HELPER_TEXT_CHARS, modelField, readJson } from "./helper.ts";

const MAX_CODE_CHARS = 30_000;
const MAX_SCHEMA_CHARS = 10_000;
const DATA_SAMPLE_ROWS = 5;

const logger = getLogger(["app", "generate", "code"]);

export const GenerateCodeSchema = z.object({
  widget_uuid: z.string().describe("Accepted and not used."),
  user_prompt: z.string().min(1).max(20_000).describe("What the code should do."),
  current_code: z.string().nullish().describe("The code to change or improve."),
  language: z.enum(["sql", "python"]).describe("The language of the code."),
  sql_schema: z.record(z.string(), z.unknown()).nullish().describe("The tables and columns that the code may use."),
  data_sample: z.array(z.record(z.string(), z.unknown())).nullish().describe(`Rows of the data. The agent reads the first ${DATA_SAMPLE_ROWS}.`),
  model: modelField,
});

export const codeRoute = defineRoute({
  method: "POST",
  path: "/v1/generate/code",
  tag: "generate",
  summary: "Writes or changes SQL or Python code for a widget.",
  description:
    "Writes the code that answers a widget, or changes the code that the widget has. The agent makes one call to the model and never runs tools.",
  request: { contentType: "application/json", required: true, schema: named("GenerateCodeRequest", GenerateCodeSchema) },
  responses: [
    {
      code: "200",
      description: "The code that the model wrote, or the reason why it wrote none.",
      schema: named(
        "GenerateCode",
        z.object({
          success: z.boolean().describe("Whether the model wrote the code."),
          generated_code: z.string().optional().describe("The code that the model wrote."),
          error_message: z.string().optional().describe("Why the model wrote no code."),
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
    detail: "The language is sql or python.",
    answer: '{"success": true, "generated_code": "..."} or {"success": false, "error_message": "..."}.',
    fallback: '{"success": false, "error_message": "Code generation failed"}.',
  },
});

export const codeRouter = new Hono<AppEnv>();

codeRouter.post(codeRoute.path, async (c) => {
  const raw = await readJson(c);
  if (raw === null) return invalidJson(c);
  const parsed = GenerateCodeSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const { user_prompt, language, current_code, sql_schema, data_sample, model } = parsed.data;

  let prompt =
    `Generate ${language} code based on the user's instruction. ` +
    "Return a JSON object:\n" +
    'On success: { "success": true, "generated_code": "..." }\n' +
    'On failure: { "success": false, "error_message": "..." }\n\n' +
    "Return ONLY valid JSON, no markdown fences.\n\n" +
    `Language: ${language}\n` +
    `Instruction: ${truncate(user_prompt, MAX_HELPER_TEXT_CHARS)}`;

  if (sql_schema) prompt += `\n\nSQL Schema:\n${truncate(JSON.stringify(sql_schema, null, 2), MAX_SCHEMA_CHARS)}`;
  if (data_sample && data_sample.length > 0) {
    prompt += `\n\nData sample (first ${Math.min(data_sample.length, DATA_SAMPLE_ROWS)} rows):\n${truncate(JSON.stringify(data_sample.slice(0, DATA_SAMPLE_ROWS), null, 2), MAX_SCHEMA_CHARS)}`;
  }
  if (current_code) prompt += `\n\nCurrent code to modify/improve:\n${truncate(current_code, MAX_CODE_CHARS)}`;

  const fallback = { success: false as const, error_message: "Code generation failed" };

  try {
    const text = await helperLlm(c, prompt, { model, maxTokens: 2048, functionId: "generate.code" });
    const result = parseJsonResponse(text, fallback);
    logger.info("code generated", { language, success: result.success });
    return c.json(result);
  } catch (err) {
    logger.warn("code generation failed", { error: err instanceof Error ? err.message : String(err) });
    return c.json(fallback);
  }
});
