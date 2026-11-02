import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export const MAX_REDIRECTS = 3;
export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

const private_ = new BlockList();
for (const [network, prefix, family] of [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["64:ff9b::", 96, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
] as const) {
  private_.addSubnet(network, prefix, family);
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return private_.check(address, family === 6 ? "ipv6" : "ipv4");
}

function isInternalName(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, "");
  return (
    !name.includes(".") ||
    name === "localhost" ||
    /\.(localhost|local|internal|lan|home\.arpa)$/.test(name)
  );
}

interface FetchPolicy {
  workspace?: { publicUrl: string; internalUrl: string; origin: string };
  resolve?: (hostname: string) => Promise<string[]>;
}

let policy: FetchPolicy = {};

export function configureFetchPolicy(next: FetchPolicy): void {
  policy = next;
}

async function addressesOf(hostname: string): Promise<string[]> {
  if (policy.resolve) return policy.resolve(hostname);
  const found = await lookup(hostname, { all: true });
  return found.map((entry) => entry.address);
}

function describe(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function withOrigin(init: RequestInit, origin: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Origin", origin);
  return { ...init, headers };
}

function workspaceFileUrl(url: URL): URL | null {
  const workspace = policy.workspace;
  if (!workspace || url.origin !== new URL(workspace.publicUrl).origin) return null;
  if (!url.pathname.startsWith("/app/files/")) return null;
  const internal = new URL(workspace.internalUrl);
  return new URL(`${url.pathname}${url.search}`, `${internal.origin}/`);
}

async function publicAddresses(url: URL): Promise<string[] | null> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Refusing to fetch ${describe(url)}: only http and https URLs are fetched.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Error(`Refusing to fetch ${describe(url)}: it is not a public address.`);
    return null;
  }
  if (isInternalName(host)) throw new Error(`Refusing to fetch ${describe(url)}: it is an internal name.`);
  let addresses: string[];
  try {
    addresses = await addressesOf(host);
  } catch {
    throw new Error(`Could not look up ${url.hostname}.`);
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new Error(`Refusing to fetch ${describe(url)}: it does not resolve to a public address.`);
  }
  return addresses;
}

async function fetchPinned(url: URL, addresses: string[], init: RequestInit): Promise<Response> {
  let failure: unknown;
  for (const address of addresses) {
    const target = new URL(url.href);
    target.hostname = address.includes(":") ? `[${address}]` : address;
    const headers = new Headers(init.headers);
    headers.set("Host", url.host);
    try {
      return await fetch(target.href, {
        ...init,
        headers,
        ...(url.protocol === "https:" ? { tls: { serverName: url.hostname } } : {}),
      } as RequestInit);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

function capped(response: Response, maxBytes: number): Response {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel();
    throw new Error(`The response is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
  if (!response.body) return response;
  let seen = 0;
  const limited = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          controller.error(new Error(`The response is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(limited, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function withFinalUrl(response: Response, url: string): Response {
  Object.defineProperty(response, "url", { value: url });
  return response;
}

export async function fetchClientUrl(
  input: string,
  init: RequestInit & { maxBytes?: number } = {},
): Promise<Response> {
  const { maxBytes = DEFAULT_MAX_BYTES, signal: callerSignal, ...rest } = init;
  const signal = callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)]) : AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const requestInit: RequestInit = { ...rest, signal, redirect: "manual" };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Not a URL.");
  }
  let trusted = false;
  const own = workspaceFileUrl(url);
  if (own) {
    url = own;
    trusted = true;
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const addresses = trusted ? null : await publicAddresses(url);
    const response = addresses
      ? await fetchPinned(url, addresses, requestInit)
      : await fetch(url.href, trusted && policy.workspace ? withOrigin(requestInit, policy.workspace.origin) : requestInit);
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      void response.body?.cancel();
      url = new URL(location, url);
      trusted = false;
      continue;
    }
    return withFinalUrl(capped(response, maxBytes), url.href);
  }
  throw new Error("Too many redirects.");
}
