/**
 * A fetch is an outgoing request, and text in a page or a file can steer the model into making one that
 * carries the user's data out in its address. The agent signs the addresses it can point to in what the
 * model was given (src/agent/known-urls.ts); this tool does not fetch one that lacks the signature.
 *
 * INES_SCOPE_SECRET is shared with the agent. Without it (a deployment without users) every address is
 * fetched, and INES_FETCH_ANY_URL=true opens a deployment that has users to every address as well.
 */

import { z } from "zod";
import { verifyUrl } from "../../../src/lib/scope";
import { getLogger } from "./logger";

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
): string | null {
  if (!secret || anyUrl) return null;
  if (signature && verifyUrl(secret, url, signature)) return null;
  logger.warn("Refused a fetch of an address that was not given in the conversation");
  return (
    "That address was not given in this conversation, so it was not fetched. Fetch only an address the user wrote, " +
    "or one that a search, a page or a widget listed, exactly as it was written there; to find one, use web_search."
  );
}
