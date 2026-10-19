/**
 * The URL that a guarded fetch (src/lib/safe-fetch.ts) was asked for. It connects to an address it has checked
 * and says the name in the Host header, so a stub of the network sees the address; this gives back the name.
 */
export function logicalUrl(input: string | URL | Request, init?: RequestInit): string {
  const url = new URL(String(input));
  const host = new Headers(init?.headers).get("host");
  const isAddress = /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith("[");
  return host && isAddress ? `${url.protocol}//${host}${url.pathname}${url.search}` : String(input);
}
