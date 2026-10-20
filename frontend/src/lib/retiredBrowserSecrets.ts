import { getConfig } from "~/lib/runtimeConfig";

/** The persisted auth store of earlier versions: session token, ID tokens, provider keys. */
const AUTH_STORAGE_KEY = "auth-storage";
/** The browser-side MCP OAuth client: access and refresh tokens, clients, PKCE verifiers. */
const MCP_AUTH_PREFIX = "mcp:auth";
/** MSAL's localStorage cache: its own keys, and the indexes naming its token entries. */
const MSAL_PREFIX = "msal.";
const MSAL_ACCOUNT_KEYS = "msal.account.keys";
const MSAL_TOKEN_KEYS_PREFIX = "msal.token.keys.";
/** The script-readable cookie that holds the key of MSAL's localStorage cache. */
const MSAL_CACHE_COOKIE = "msal.cache.encryption";

function storageKeys(storage: Storage): string[] {
  return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
    (key): key is string => key !== null,
  );
}

function readJson(storage: Storage, key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

/** Every localStorage key of an MSAL cache, found the way MSAL itself clears one. */
function msalCacheKeys(storage: Storage, keys: string[]): string[] {
  const clientId = getConfig().authProviders.azureClientId;
  const found = new Set(strings(readJson(storage, MSAL_ACCOUNT_KEYS)));
  for (const key of keys) {
    if (key.startsWith(MSAL_TOKEN_KEYS_PREFIX)) {
      const index = readJson(storage, key) as Record<string, unknown> | null;
      for (const kind of ["idToken", "accessToken", "refreshToken"]) {
        for (const entry of strings(index?.[kind])) found.add(entry);
      }
    }
    if (key.startsWith(MSAL_PREFIX) || (clientId && key.includes(clientId))) {
      found.add(key);
    }
  }
  return [...found];
}

/**
 * Removes the secrets that earlier versions of the web app kept in browser storage and
 * that no code reads any more: the persisted auth store, the browser-side MCP OAuth
 * client's tokens, and MSAL's localStorage cache with the cookie holding its key. Runs
 * at every page load, so they go even when the user never signs out.
 */
export function removeRetiredBrowserSecrets() {
  try {
    const storage = window.localStorage;
    const keys = storageKeys(storage);
    const retired = [
      ...keys.filter(
        (key) => key === AUTH_STORAGE_KEY || key.startsWith(MCP_AUTH_PREFIX),
      ),
      ...msalCacheKeys(storage, keys),
    ];
    for (const key of retired) storage.removeItem(key);
  } catch (error) {
    // Blocked storage holds nothing to remove
    console.warn("Could not read browser storage:", error);
  }
  // biome-ignore lint/suspicious/noDocumentCookie: expiring a cookie MSAL itself wrote this way
  document.cookie = `${MSAL_CACHE_COOKIE}=; Max-Age=0; Path=/`;
}
