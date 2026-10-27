import { z } from "zod";
import { verifyScope } from "../../../src/lib/scope.ts";
import { getLogger } from "./logger.ts";
import { errorItem, type ContentItem } from "./typed.ts";

const logger = getLogger(["mcp", "scope"]);

export const MIN_SECRET_CHARS = 16;

export const conversationIdSchema = z
  .string()
  .optional()
  .describe("The chat, filed under the user and the chat id. The agent sets it.");

export const scopeSigSchema = z
  .string()
  .optional()
  .describe(
    "An HMAC of the chat key, made with the agent's INES_SCOPE_SECRET. A tool checks it, so that a call cannot use another user's chat. The agent sets it.",
  );

interface Scoped {
  "x-ines-conversation-id"?: string;
  "x-ines-scope-sig"?: string;
}

export function scopeSecretProblem(env: Record<string, string | undefined> = process.env): string | null {
  const mode = (env.INES_AUTH ?? "workspace").trim();
  if (mode === "none") return null;
  const secret = (env.INES_SCOPE_SECRET ?? "").trim();
  if (!secret) {
    return "INES_SCOPE_SECRET is not set. It is shared with the agent and is what keeps one user's chat from another; without it the tools that keep state for a chat would act on any scope a client sends. Set it (`python -m scripts.create_local_env` in backend-api/backend writes it), or run without users with INES_AUTH=none.";
  }
  if (secret.length < MIN_SECRET_CHARS) {
    return `INES_SCOPE_SECRET must be at least ${MIN_SECRET_CHARS} characters.`;
  }
  return null;
}

export function scopeProblem(
  args: Scoped,
  secret: string | undefined = process.env.INES_SCOPE_SECRET,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!secret) {
    return scopeSecretProblem(env) === null
      ? null
      : "This server has no chat-scope secret, so it cannot tell one user's chat from another.";
  }
  const key = args["x-ines-conversation-id"];
  const signature = args["x-ines-scope-sig"];
  if (!key || !signature) return "The call carries no signed chat scope.";
  return verifyScope(secret, key, signature) ? null : "The call's chat scope was not signed by the agent.";
}

export function requireScope<A extends Scoped, R extends { content: ContentItem[] }>(
  handler: (args: A) => Promise<R>,
): (args: A) => Promise<R | { content: ContentItem[] }> {
  return async (args) => {
    const problem = scopeProblem(args);
    if (problem === null) return handler(args);
    logger.warn("Refused a tool call: {problem}", { problem });
    return {
      content: [
        errorItem({
          code: "SCOPE_REJECTED",
          message: `${problem} Tools that keep state for a chat only act on calls made through the agent.`,
        }),
      ],
    };
  };
}
