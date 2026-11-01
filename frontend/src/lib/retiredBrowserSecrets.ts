const AUTH_STORAGE_KEY = "auth-storage";
const MCP_AUTH_PREFIX = "mcp:auth";
const MSAL_PREFIX = "msal.";
const MSAL_ACCOUNT_KEYS = "msal.account.keys";
const MSAL_TOKEN_KEYS_PREFIX = "msal.token.keys.";
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

function msalCacheKeys(storage: Storage, keys: string[]): string[] {
  const found = new Set(strings(readJson(storage, MSAL_ACCOUNT_KEYS)));
  for (const key of keys) {
    if (key.startsWith(MSAL_TOKEN_KEYS_PREFIX)) {
      const index = readJson(storage, key) as Record<string, unknown> | null;
      for (const kind of ["idToken", "accessToken", "refreshToken"]) {
        for (const entry of strings(index?.[kind])) found.add(entry);
      }
    }
    if (key.startsWith(MSAL_PREFIX)) {
      found.add(key);
    }
  }
  return [...found];
}

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
    console.warn("Could not read browser storage:", error);
  }
  // biome-ignore lint/suspicious/noDocumentCookie: expiring a cookie MSAL itself wrote this way
  document.cookie = `${MSAL_CACHE_COOKIE}=; Max-Age=0; Path=/`;
}
