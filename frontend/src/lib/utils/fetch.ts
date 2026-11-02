import { getConfig } from "~/lib/runtimeConfig";
import { type BackendRequest, requestInit } from "~/lib/utils/widgetRequest";

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

type AgentHolderRef = { uuid: string; url: string };

let agentHolders: () => AgentHolderRef[] = () => [];

export function setAgentHolders(holders: () => AgentHolderRef[]) {
  agentHolders = holders;
}

export function agentHolderFor(url: string | URL): AgentHolderRef | undefined {
  const target = parseUrl(url);
  if (!target) return undefined;
  const pathOf = (holder: AgentHolderRef) =>
    parseUrl(holder.url)?.pathname.replace(/\/+$/, "") ?? "";
  const sameOrigin = agentHolders().filter(
    (holder) => parseUrl(holder.url)?.origin === target.origin,
  );
  return (
    sameOrigin
      .filter((holder) => target.pathname.startsWith(pathOf(holder)))
      .sort((a, b) => pathOf(b).length - pathOf(a).length)[0] ?? sameOrigin[0]
  );
}

export function relayToAgent(
  holder: AgentHolderRef,
  url: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const base = getConfig().urls.backend.replace(/\/+$/, "");
  const headers = new Headers(init.headers);
  headers.set(WORKSPACE_CLIENT_HEADER, WORKSPACE_CLIENT);
  return fetch(
    `${base}/app/custom-copilot/${holder.uuid}/relay?target=${encodeURIComponent(String(url))}`,
    { ...init, credentials: "include", headers },
  );
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

const SOURCE_API = "/app/data-connectors";

export const MAX_PROXIED_IN_FLIGHT = 6;

let inFlight = 0;
const waiting: Array<() => void> = [];

function abortError(signal: AbortSignal) {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

async function takeSlot(signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  if (inFlight < MAX_PROXIED_IN_FLIGHT) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const handOver = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      waiting.splice(waiting.indexOf(handOver), 1);
      reject(abortError(signal as AbortSignal));
    };
    waiting.push(handOver);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function giveSlot() {
  const next = waiting.shift();
  if (next) next();
  else inFlight--;
}

async function postToApi(
  path: string,
  body: unknown,
  signal?: AbortSignal | null,
): Promise<Response> {
  await takeSlot(signal);
  try {
    return await postNow(path, body, signal);
  } finally {
    giveSlot();
  }
}

export const HEADERS_TIMEOUT_MS = 60_000;

function postNow(
  path: string,
  body: unknown,
  signal?: AbortSignal | null,
): Promise<Response> {
  const base = getConfig().urls.backend.replace(/\/+$/, "");
  const controller = new AbortController();
  const forward = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("The data connection did not answer in time", "TimeoutError"),
      ),
    HEADERS_TIMEOUT_MS,
  );
  return fetch(`${base}${SOURCE_API}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      [WORKSPACE_CLIENT_HEADER]: WORKSPACE_CLIENT,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

function sourceCall(request: BackendRequest, accept?: string | null) {
  return {
    url: request.url,
    method: request.method,
    headers: request.paramHeaders,
    ...(request.body === undefined ? {} : { body: request.body }),
    ...(accept ? { accept } : {}),
  };
}

let sourceUrlLookup: (sourceId: string) => string | undefined = () => undefined;

export function setSourceUrlLookup(lookup: (sourceId: string) => string | undefined) {
  sourceUrlLookup = lookup;
}

function viaSource(
  request: BackendRequest,
): request is BackendRequest & { sourceId: string } {
  if (!request.sourceId) return false;
  const sourceUrl = sourceUrlLookup(request.sourceId);
  return !sourceUrl || isOnSourceOrigin(request.url, sourceUrl);
}

export function fetchRequest(
  request: BackendRequest,
  init: RequestInit = {},
): Promise<Response> {
  if (!viaSource(request)) return fetch(request.url, requestInit(request, init));
  const accept = new Headers(init.headers).get("Accept");
  return postToApi(
    `/api-source/${request.sourceId}/request`,
    sourceCall(request, accept),
    init.signal,
  );
}

export function sourceStreamHref(request: BackendRequest): string {
  if (!viaSource(request)) return request.url;
  const base = getConfig().urls.backend.replace(/\/+$/, "");
  return `${base}${SOURCE_API}/api-source/${request.sourceId}/stream?url=${encodeURIComponent(request.url)}`;
}

type SourceHeaderRow = { key: string; value?: string; location?: "headers" | "query" };

export function fetchFromSource(
  source: { id?: string; url: string; endpointHeaders?: SourceHeaderRow[] | null },
  url: string,
  init: { signal?: AbortSignal | null; method?: "GET" | "OPTIONS" } = {},
): Promise<Response> {
  const request: BackendRequest = {
    url,
    method: init.method ?? "GET",
    paramHeaders: {},
  };
  const typed = (source.endpointHeaders ?? []).some((header) => header.value);
  if (source.id && !typed)
    return postToApi(
      `/api-source/${source.id}/request`,
      sourceCall(request),
      init.signal,
    );
  return postToApi(
    "/api-source-test/request",
    {
      ...(source.id ? { id: source.id } : {}),
      url: source.url,
      endpointHeaders: (source.endpointHeaders ?? []).map(
        ({ key, value, location }) => ({
          key,
          value: value ?? "",
          location: location ?? "headers",
        }),
      ),
      request: sourceCall(request),
    },
    init.signal,
  );
}
