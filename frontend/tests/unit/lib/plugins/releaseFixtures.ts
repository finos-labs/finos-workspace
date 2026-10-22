// Builders for plugin release fixtures shared by the plugin tests: a release as the
// plugin host's /registry/releases.json lists it, and an in-memory Storage.
import type { PluginRelease } from "~/lib/plugins";

/** A 64-hex fingerprint derived from `seed`, so different seeds give different hashes. */
export function fakeSha(seed: string) {
  const hex = Array.from(seed)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
  return hex.padEnd(64, "0").slice(0, 64);
}

export function makeRelease(overrides: Partial<PluginRelease> = {}): PluginRelease {
  const version = overrides.version ?? "1.0.0";
  return {
    id: "bq-advanced-grouping",
    version,
    digest: `sha256:${fakeSha(`digest-${version}`)}`,
    files: {
      "index.html": { sha256: fakeSha("index"), bytes: 400 },
      "assets/app.js": { sha256: fakeSha(`app-${version}`), bytes: 2048 },
    },
    requests: { network: [], storage: false, downloads: false, popups: false },
    releaseNotes: null,
    source: null,
    releasedAt: "2026-10-15T00:00:00.000Z",
    ...overrides,
  };
}

export function memoryStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  } as unknown as Storage;
  return { map, storage };
}
