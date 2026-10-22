import { apiClient } from "~/api/api";
import { isDefaultCopilotUrl } from "~/lib/utils/fetch";

/**
 * The short-lived agent token for the default Copilot (AI_API_URL). The agent service is
 * another origin and never sees the API's session cookie, so the page mints this token
 * from the API (POST /app/copilot/token) and sends it as a bearer to the default Copilot
 * only. The API accepts it on GET /app/user, PUT /app/usage and POST
 * /app/copilot/authorize, nothing else. It lives in this module's memory, is never
 * persisted, and is renewed when less than 20 minutes of its 30 remain.
 */

const RENEW_WHEN_LEFT_MS = 20 * 60 * 1000;

type HeldToken = { token: string; expiresAt: number };

let held: HeldToken | null = null;
let minting: Promise<HeldToken> | null = null;
// Bumped by clearAgentToken so a mint that finishes after sign-out is not kept
let generation = 0;

async function mintAgentToken(): Promise<HeldToken> {
  const { data } = await apiClient.post<{ token: string; expires_in: number }>(
    "/app/copilot/token",
  );
  return { token: data.token, expiresAt: Date.now() + data.expires_in * 1000 };
}

/** The current agent token, minting a new one when none is held, it runs low, or `renew` is set. */
export async function getAgentToken(renew = false): Promise<string> {
  if (!renew && held && held.expiresAt - Date.now() > RENEW_WHEN_LEFT_MS) {
    return held.token;
  }
  if (!minting) {
    const mintGeneration = generation;
    minting = mintAgentToken()
      .then((minted) => {
        if (mintGeneration === generation) held = minted;
        return minted;
      })
      .finally(() => {
        if (mintGeneration === generation) minting = null;
      });
  }
  return (await minting).token;
}

export function clearAgentToken() {
  generation += 1;
  held = null;
  minting = null;
}

/**
 * fetch for agent endpoints. A request to the default Copilot's origin carries the agent
 * token as its bearer and is sent once more with a fresh token after a 401. Any other
 * URL (a custom agent) is fetched exactly as given, with no Workspace credential.
 */
export async function fetchAgent(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  if (!isDefaultCopilotUrl(input)) return fetch(input, init);

  const send = async (renew: boolean) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await getAgentToken(renew)}`);
    return fetch(input, { ...init, headers });
  };

  const response = await send(false);
  return response.status === 401 ? send(true) : response;
}
