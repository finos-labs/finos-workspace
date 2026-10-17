import { getConfig } from "~/lib/runtimeConfig";

/**
 * Names the client on every request that rides the session cookie; the API reads the web
 * session cookie only when it says "web". Being a custom header, it also makes a
 * cross-origin request pass a CORS preflight, which only allowlisted origins pass.
 */
export const WORKSPACE_CLIENT_HEADER = "X-Workspace-Client";
export const WORKSPACE_CLIENT = "web";

function parseUrl(url: string | URL): URL | null {
  try {
    return new URL(url, window.location.href);
  } catch {
    return null;
  }
}

/**
 * Whether `url` is on the Workspace API's origin: an exact origin match, never a prefix
 * or substring test. Workspace credentials and the client header go to this origin only.
 */
export function isApiUrl(url: string | URL): boolean {
  const api = parseUrl(getConfig().urls.backend);
  return api !== null && parseUrl(url)?.origin === api.origin;
}

/**
 * Whether `url` is one of the API's own file routes (`/app/files/...` under the API's
 * URL): the only URLs a widget names that may get the Workspace session.
 */
export function isApiFileUrl(url: string | URL): boolean {
  const api = parseUrl(getConfig().urls.backend);
  const target = parseUrl(url);
  if (!(api && target) || target.origin !== api.origin) return false;
  const basePath = api.pathname.replace(/\/+$/, "");
  return target.pathname.startsWith(`${basePath}/app/files/`);
}

/**
 * Whether `url` is the default Copilot's (AI_API_URL): the same origin and, on it, the
 * AI_API_URL path or a path below it.
 */
export function isDefaultCopilotUrl(url: string | URL): boolean {
  const aiUrl = getConfig().urls.ai;
  const ai = aiUrl ? parseUrl(aiUrl) : null;
  const target = parseUrl(url);
  if (!(ai && target) || target.origin !== ai.origin) return false;
  const basePath = ai.pathname.replace(/\/+$/, "");
  return target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
}

/**
 * Whether `url` is on the data backend's own origin. A widget names its source by id and
 * its URL separately, and shared content can pair any id with any URL, so a source's
 * credentials go to its own origin only. A relative URL is on the backend.
 */
export function isOnSourceOrigin(
  url: string | null | undefined,
  sourceUrl: string | null | undefined,
) {
  if (!url || !sourceUrl) return false;
  try {
    return new URL(url, sourceUrl).origin === new URL(sourceUrl).origin;
  } catch {
    return false;
  }
}
