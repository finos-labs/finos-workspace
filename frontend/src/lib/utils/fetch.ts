import { getConfig } from "~/lib/runtimeConfig";

export const WORKSPACE_CLIENT_HEADER = "X-Workspace-Client";
export const WORKSPACE_CLIENT = "web";

function parseUrl(url: string | URL): URL | null {
  try {
    return new URL(url, window.location.href);
  } catch {
    return null;
  }
}

export function isApiUrl(url: string | URL): boolean {
  const api = parseUrl(getConfig().urls.backend);
  return api !== null && parseUrl(url)?.origin === api.origin;
}

export function isApiFileUrl(url: string | URL): boolean {
  const api = parseUrl(getConfig().urls.backend);
  const target = parseUrl(url);
  if (!(api && target) || target.origin !== api.origin) return false;
  const basePath = api.pathname.replace(/\/+$/, "");
  return target.pathname.startsWith(`${basePath}/app/files/`);
}

export function isDefaultCopilotUrl(url: string | URL): boolean {
  const aiUrl = getConfig().urls.ai;
  const ai = aiUrl ? parseUrl(aiUrl) : null;
  const target = parseUrl(url);
  if (!(ai && target) || target.origin !== ai.origin) return false;
  const basePath = ai.pathname.replace(/\/+$/, "");
  return target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
}

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
