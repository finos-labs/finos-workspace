/**
 * The tools that keep state for a chat (the code sandbox, the document store) file it under the chat's
 * scope key, which names the user (see src/lib/scope.ts). The browser makes the calls to the tools, so
 * it could put any key in one; the agent signs the key it means, and these tools do not act on one that
 * lacks the signature.
 *
 * INES_SCOPE_SECRET is shared with the agent. Without it (a deployment without users) every call goes on.
 */

import { z } from "zod";
import { verifyScope } from "../../../src/lib/scope";
import { getLogger } from "./logger";
import { errorItem, type ContentItem } from "./typed";

const logger = getLogger(["mcp", "scope"]);

export const scopeSigSchema = z
  .string()
  .optional()
  .describe("INTERNAL — populated by agent decoration. Do not set.");

interface Scoped {
  "x-ines-conversation-id"?: string;
  "x-ines-scope-sig"?: string;
}

/** Why a call may not go on, or null when it may. */
export function scopeProblem(args: Scoped, secret: string | undefined = process.env.INES_SCOPE_SECRET): string | null {
  if (!secret) return null;
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
