/**
 * The tools that keep state for a chat (the document store, the fetched pages) file it under the chat's
 * scope key, which names the user (see src/lib/scope.ts). The browser makes the calls to the tools, so
 * it could put any key in one; the agent signs the key it means, and these tools do not act on one that
 * lacks the signature.
 *
 * INES_SCOPE_SECRET is shared with the agent, which requires it (see src/lib/config.ts). This server
 * requires it too, and says so at start (`scopeSecretProblem`): without it every key a client sends
 * would be taken as given, and one user would reach another user's documents and pages. The one
 * deployment that has no secret is the one that has no users, INES_AUTH=none, which is the same named
 * opt-out the agent takes.
 */

import { z } from "zod";
import { verifyScope } from "../../../src/lib/scope";
import { getLogger } from "./logger";
import { errorItem, type ContentItem } from "./typed";

const logger = getLogger(["mcp", "scope"]);

/** As short a secret as the agent accepts (src/lib/config.ts), so that the two agree on what is configured. */
const MIN_SECRET_CHARS = 16;

export const scopeSigSchema = z
  .string()
  .optional()
  .describe("INTERNAL — populated by agent decoration. Do not set.");

interface Scoped {
  "x-ines-conversation-id"?: string;
  "x-ines-scope-sig"?: string;
}

/**
 * Why this server may not serve the tools that keep state for a chat, or null when it may.
 *
 * Checked once at start, so that a deployment that is missing the secret says what is wrong instead of
 * running with every scope check open.
 */
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

/**
 * Why a call may not go on, or null when it may.
 *
 * Without a secret there is nothing to check a scope against, so what happens then is decided by
 * whether the deployment has users: one that has none (INES_AUTH=none) has nobody to keep apart and
 * every call goes on; one that has them refuses, rather than taking whatever scope the caller sent.
 * The server does not start in that state (`scopeSecretProblem`), so this is the second lock on the
 * same door — but it is the one that is on the path of every call.
 */
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

/** The handler, but only for a call whose chat scope the agent signed. */
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
