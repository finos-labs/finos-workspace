import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../auth/middleware.ts";
import { truncate } from "../../lib/llm.ts";
import { getLogger } from "../../lib/logger.ts";
import {
  bodyTooLarge,
  defineRoute,
  invalidRequest,
  named,
  tooManyRequests,
  unauthorized,
} from "../../lib/openapi.ts";
import { helperLlm, invalidJson, modelField, readJson } from "./helper.ts";

const logger = getLogger(["app", "generate", "chat-title"]);

export const CHAT_TITLE_MESSAGES = 5;
export const CHAT_TITLE_MESSAGE_CHARS = 500;
export const CHAT_TITLE_FALLBACK = "New Chat";

export const ChatTitleSchema = z.object({
  messages: z
    .array(z.unknown())
    .min(1)
    .max(1000)
    .describe("The conversation. The agent reads the messages that have the role human and a text as their content."),
  model: modelField,
});

export const chatTitleRoute = defineRoute({
  method: "POST",
  path: "/v1/generate/chat/title",
  tag: "generate",
  summary: "Names a chat.",
  description: "Names the chat that the messages belong to. The agent makes one call to the model and never runs tools.",
  request: { contentType: "application/json", required: true, schema: named("ChatTitleRequest", ChatTitleSchema) },
  responses: [
    {
      code: "200",
      description: "The title of the chat, as a JSON string.",
      schema: named("ChatTitle", z.string().describe("The title of the chat."), "output"),
    },
    invalidRequest(),
    unauthorized(),
    bodyTooLarge(),
    tooManyRequests(),
  ],
  secured: true,
  helper: {
    detail: `The agent reads the last ${CHAT_TITLE_MESSAGES} messages that have the role human, each cut to ${CHAT_TITLE_MESSAGE_CHARS} characters.`,
    answer: 'A JSON string that holds the title, for example "Revenue by region".',
    fallback: `"${CHAT_TITLE_FALLBACK}", also when there is no human message.`,
  },
});

export const chatTitleRouter = new Hono<AppEnv>();

chatTitleRouter.post(chatTitleRoute.path, async (c) => {
  const raw = await readJson(c);
  if (raw === null) return invalidJson(c);
  const parsed = ChatTitleSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const { messages, model } = parsed.data;

  const userMessages = (messages as Array<{ role?: string; content?: string }>)
    .filter((m) => m.role === "human" && typeof m.content === "string")
    .slice(-CHAT_TITLE_MESSAGES)
    .map((m) => truncate(m.content as string, CHAT_TITLE_MESSAGE_CHARS));

  if (userMessages.length === 0) return c.json(CHAT_TITLE_FALLBACK);

  const prompt =
    "Generate a short chat title (3-6 words) that summarizes this conversation. " +
    "Return ONLY the title text, no quotes, no JSON, no explanation.\n\n" +
    "User messages:\n" +
    userMessages.map((m, i) => `${i + 1}. ${m}`).join("\n");

  try {
    const title = await helperLlm(c, prompt, { model, functionId: "generate.chat-title" });
    const cleaned = title.replace(/^["']|["']$/g, "");
    logger.info("chat/title generated", { title: cleaned });
    return c.json(cleaned);
  } catch (err) {
    logger.warn("chat/title failed", { error: err instanceof Error ? err.message : String(err) });
    return c.json(CHAT_TITLE_FALLBACK);
  }
});
