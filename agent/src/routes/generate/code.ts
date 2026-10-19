import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../auth/middleware";
import { parseJsonResponse, truncate } from "../../lib/llm";
import { getLogger } from "../../lib/logger";
import { helperLlm, invalidJson, MAX_HELPER_TEXT_CHARS, readJson } from "./helper";

// Code and a schema are longer than a question, but not unbounded: they are part of a prompt that is paid for.
const MAX_CODE_CHARS = 30_000;
const MAX_SCHEMA_CHARS = 10_000;

const logger = getLogger(["app", "generate", "code"]);

const GenerateCodeSchema = z.object({
  widget_uuid: z.string(),
  user_prompt: z.string().min(1).max(20_000),
  current_code: z.string().nullish(),
  language: z.enum(["sql", "python"]),
  sql_schema: z.record(z.string(), z.unknown()).nullish(),
  data_sample: z.array(z.record(z.string(), z.unknown())).nullish(),
  model: z.string().max(200).optional(),
});

export const codeRouter = new Hono<AppEnv>();

codeRouter.post("/v1/generate/code", async (c) => {
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
    prompt += `\n\nData sample (first ${Math.min(data_sample.length, 5)} rows):\n${truncate(JSON.stringify(data_sample.slice(0, 5), null, 2), MAX_SCHEMA_CHARS)}`;
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
