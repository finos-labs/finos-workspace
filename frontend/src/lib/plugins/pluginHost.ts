/**
 * Plugin host URL helpers: validates the configured host (VITE_PLUGIN_HOST_URL /
 * urls.pluginHost) and tells whether a URL is served by it, e.g. to decide which
 * iframes may run scripts.
 */

/** Where the registry lives on the plugin host. */
export const REGISTRY_PATH = "/registry/plugins.json";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type PluginHostResult =
  | { ok: true; origin: string; baseUrl: string }
  | { ok: false; reason: "missing" | "invalid"; message: string };

/**
 * Validates the configured plugin host (`urls.pluginHost` / VITE_PLUGIN_HOST_URL).
 * It must be an absolute http(s) URL without credentials, query or fragment,
 * and must use https unless it points at this machine.
 */
export function parsePluginHost(value: string | undefined): PluginHostResult {
  const raw = value?.trim();
  if (!raw) {
    return {
      ok: false,
      reason: "missing",
      message:
        "No plugin host is configured. Set VITE_PLUGIN_HOST_URL (or urls.pluginHost).",
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid", message: `"${raw}" is not a valid URL.` };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      ok: false,
      reason: "invalid",
      message: "The plugin host must use http or https.",
    };
  }
  if (url.protocol === "http:" && !LOCAL_HOSTNAMES.has(url.hostname)) {
    return {
      ok: false,
      reason: "invalid",
      message: "The plugin host must use https unless it runs on localhost.",
    };
  }
  if (url.username || url.password || url.search || url.hash) {
    return {
      ok: false,
      reason: "invalid",
      message:
        "The plugin host URL must not contain credentials, a query or a fragment.",
    };
  }

  // Keep an optional base path (e.g. https://cdn.example.com/bq) without a trailing slash.
  const baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  return { ok: true, origin: url.origin, baseUrl };
}

/**
 * Whether `url` is served by the configured plugin host: same origin, and under its
 * base path. Plugin pages are trusted code that needs scripts, so callers may give
 * them a sandbox that allows scripts where other external frames get none.
 */
export function isPluginHostUrl(url: string, pluginHost: string | undefined): boolean {
  const host = parsePluginHost(pluginHost);
  if (!host.ok || !url) return false;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.origin !== host.origin) return false;
  const basePath = new URL(host.baseUrl).pathname.replace(/\/+$/, "");
  return (
    !basePath ||
    target.pathname === basePath ||
    target.pathname.startsWith(`${basePath}/`)
  );
}
