/**
 * Plugin releases as the plugin host publishes them (/registry/releases.json): every
 * released version of every plugin with its digest, file fingerprints, requests and
 * notes. Also the helpers the approval flow needs: version ordering, and the review
 * diff an administrator sees between the approved version and a newer one.
 */
import { z } from "zod";
import { type PluginRequests, PluginRequestsSchema } from "./registry";

export const RELEASES_PATH = "/registry/releases.json";

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const ReleaseFileSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
});

export const PluginReleaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  version: z.string().regex(VERSION),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  files: z.record(z.string(), ReleaseFileSchema),
  requests: PluginRequestsSchema.nullable(),
  releaseNotes: z.string().nullable(),
  source: z.object({ commit: z.string() }).nullable(),
  releasedAt: z.string(),
});

export type PluginRelease = z.infer<typeof PluginReleaseSchema>;

/** Parses the release index. Invalid entries are dropped rather than failing the list. */
export function parseReleases(document: unknown): PluginRelease[] {
  if (!Array.isArray(document)) return [];
  return document.flatMap((entry) => {
    const result = PluginReleaseSchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}

/** Semantic version order; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const [aCore = "", aPre] = a.split("-", 2);
  const [bCore = "", bPre] = b.split("-", 2);
  const aParts = aCore.split(".").map(Number);
  const bParts = bCore.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (aPre === bPre) return 0;
  if (aPre === undefined) return 1;
  if (bPre === undefined) return -1;
  return aPre.localeCompare(bPre, undefined, { numeric: true });
}

/** The newest release, or undefined when the plugin has none. */
export function latestRelease(releases: readonly PluginRelease[]) {
  return [...releases].sort((a, b) => compareVersions(a.version, b.version)).at(-1);
}

/**
 * What a plugin asks for, in plain words for the administrator. Never a verdict:
 * the product does not call a plugin safe.
 */
export function describeRequests(requests: PluginRequests): string[] {
  const items = requests.network.map((origin) => `Network access to ${origin}`);
  if (requests.storage) items.push("Browser storage");
  if (requests.downloads) items.push("Downloading files");
  if (requests.popups) items.push("Opening new windows");
  return items;
}

/** The parts of a release an approval is about. */
export interface ReleaseSnapshot {
  version: string;
  files: PluginRelease["files"];
  requests: PluginRequests | null;
}

export interface ReleaseDiff {
  requests: {
    added: string[];
    removed: string[];
    declaredBefore: boolean;
    declaredNow: boolean;
  };
  files: {
    added: { path: string; bytes: number }[];
    removed: { path: string; bytes: number }[];
    changed: { path: string; fromBytes: number; toBytes: number }[];
  };
}

/** The review diff between what was approved and a candidate release. */
export function diffReleases(from: ReleaseSnapshot, to: ReleaseSnapshot): ReleaseDiff {
  const before = from.requests ? describeRequests(from.requests) : [];
  const after = to.requests ? describeRequests(to.requests) : [];

  const added: ReleaseDiff["files"]["added"] = [];
  const removed: ReleaseDiff["files"]["removed"] = [];
  const changed: ReleaseDiff["files"]["changed"] = [];
  for (const [path, file] of Object.entries(to.files)) {
    const old = from.files[path];
    if (!old) added.push({ path, bytes: file.bytes });
    else if (old.sha256 !== file.sha256)
      changed.push({ path, fromBytes: old.bytes, toBytes: file.bytes });
  }
  for (const [path, file] of Object.entries(from.files)) {
    if (!to.files[path]) removed.push({ path, bytes: file.bytes });
  }
  const byPath = (a: { path: string }, b: { path: string }) =>
    a.path.localeCompare(b.path);

  return {
    requests: {
      added: after.filter((item) => !before.includes(item)),
      removed: before.filter((item) => !after.includes(item)),
      declaredBefore: from.requests !== null,
      declaredNow: to.requests !== null,
    },
    files: {
      added: added.sort(byPath),
      removed: removed.sort(byPath),
      changed: changed.sort(byPath),
    },
  };
}

/** Fetches the release index the plugin host publishes. */
export async function fetchReleases(
  url: string,
  options: { fetchFn?: typeof fetch; signal?: AbortSignal } = {},
): Promise<PluginRelease[]> {
  const { fetchFn = fetch, signal } = options;
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { Accept: "application/json" },
      credentials: "omit",
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new Error(`Could not load plugin releases from ${new URL(url).origin}.`);
  }
  // A host without any release yet answers 404: that is "no releases", not an error.
  if (response.status === 404) return [];
  if (!response.ok)
    throw new Error(`The plugin release index returned ${response.status}.`);
  try {
    return parseReleases(await response.json());
  } catch {
    throw new Error("The plugin release index is not valid JSON.");
  }
}
