/**
 * A fetch is an outgoing request, and text in a page or a file can steer the model into making one that
 * carries the user's data out in its address. The agent signs the addresses it can point to in what the
 * model was given (src/agent/known-urls.ts); this tool does not fetch one that lacks the signature.
 *
 * INES_SCOPE_SECRET is shared with the agent. A deployment without users (INES_AUTH=none) has no user
 * whose data could be carried out, so there every address is fetched; a deployment that has users and
 * no secret cannot tell a given address from one the model invented, and so fetches none.
 * INES_FETCH_ANY_URL=true opens a deployment that has users to every address, by name.
 */

import { z } from "zod";
import { verifyUrl } from "../../../src/lib/scope.ts";
import { getLogger } from "./logger.ts";
import { scopeSecretProblem } from "./scope-check.ts";

const logger = getLogger(["mcp", "url-check"]);

export const urlSigSchema = z
  .string()
  .optional()
  .describe("INTERNAL — populated by agent decoration. Do not set.");

/** Why an address may not be fetched, or null when it may. The reason never repeats the address. */
export function urlProblem(
  url: string,
  signature: string | undefined,
  secret: string | undefined = process.env.INES_SCOPE_SECRET,
  anyUrl: boolean = process.env.INES_FETCH_ANY_URL === "true",
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (anyUrl) return null;
  // No secret: fetch anything only where there are no users to carry anything out of.
  if (!secret) {
    if (scopeSecretProblem(env) === null) return null;
    logger.warn("Refused a fetch: this server has no secret to tell a given address from any other");
    return "That address was not fetched: this server is not configured to tell which addresses were given in the conversation.";
  }
  if (signature && verifyUrl(secret, url, signature)) return null;
  logger.warn("Refused a fetch of an address that was not given in the conversation");
  return (
    "That address was not given in this conversation, so it was not fetched. Fetch only an address the user wrote, " +
    "or one that a search, a page or a widget listed, exactly as it was written there; to find one, use web_search."
  );
}
