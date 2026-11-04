export function logicalUrl(input: string | URL | Request, init?: RequestInit): string {
  const url = new URL(String(input));
  const host = new Headers(init?.headers).get("host");
  const isAddress = /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith("[");
  return host && isAddress ? `${url.protocol}//${host}${url.pathname}${url.search}` : String(input);
}
