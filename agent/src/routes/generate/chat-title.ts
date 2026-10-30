import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../auth/middleware.ts";
import { truncate } from "../../lib/llm.ts";
import { getLogger } from "../../lib/logger.ts";
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

export const chatTitleRouter = new Hono<AppEnv>();

chatTitleRouter.post("/v1/generate/chat/title", async (c) => {
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
