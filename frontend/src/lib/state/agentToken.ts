import { apiClient } from "~/api/api";
import { isDefaultCopilotUrl } from "~/lib/utils/fetch";

export const RENEW_WHEN_LEFT_MS = 20 * 60 * 1000;

type HeldToken = { token: string; expiresAt: number };

let held: HeldToken | null = null;
let minting: Promise<HeldToken> | null = null;
let generation = 0;

async function mintAgentToken(): Promise<HeldToken> {
  const { data } = await apiClient.post<{ token: string; expires_in: number }>(
    "/app/copilot/token",
  );
  return { token: data.token, expiresAt: Date.now() + data.expires_in * 1000 };
}

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
