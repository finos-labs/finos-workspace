import { z } from "zod";
import { verifyUrl } from "../../../src/lib/scope.ts";
import { getLogger } from "./logger.ts";
import { scopeSecretProblem } from "./scope-check.ts";

const logger = getLogger(["mcp", "url-check"]);

export const urlSigSchema = z
  .string()
  .optional()
  .describe("INTERNAL — populated by agent decoration. Do not set.");

export function urlProblem(
  url: string,
  signature: string | undefined,
  secret: string | undefined = process.env.AGENT_SCOPE_SECRET,
  anyUrl: boolean = process.env.AGENT_FETCH_ANY_URL === "true",
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (anyUrl) return null;
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
