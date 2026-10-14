import { getPluginFile } from "~/api/plugins.api";
import type { AvailablePlugin } from "./types";

/**
 * Plugin code as the host hands it to a frame: fetched with the user's credentials and
 * checked, file by file, against the SHA-256 the listing carries for the approved
 * version (docs/widget-plugins/SECURITY.md 3, layer 4). A file that does not match is
 * never delivered.
 */

export class BundleIntegrityError extends Error {
  constructor(
    public readonly path: string,
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`${path} does not match the approved version`);
    this.name = "BundleIntegrityError";
  }
}

export interface VerifiedBundle {
  entry: ArrayBuffer;
  styles: string[];
}

const cache = new Map<string, Promise<ArrayBuffer>>();

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifiedFile(
  plugin: AvailablePlugin,
  path: string,
): Promise<ArrayBuffer> {
  const expected = plugin.files[path];
  if (!expected) throw new BundleIntegrityError(path, "a listed file", "not listed");
  const key = `${plugin.id}/${plugin.digest}/${path}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const bytes = await getPluginFile(plugin.id, plugin.digest, path);
      const actual = await sha256Hex(bytes);
      if (actual !== expected.sha256 || bytes.byteLength !== expected.size)
        throw new BundleIntegrityError(path, expected.sha256, actual);
      return bytes;
    })();
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
  }
  // Each frame gets its own copy, because the buffer is transferred to it
  return (await pending).slice(0);
}

/**
 * One of the plugin's own files under `assets/`, checked like its code, for the frame that
 * asks for it (`core:asset:read`). A file outside `assets/`, or not in the approved
 * version, is not one.
 */
export async function loadAsset(
  plugin: AvailablePlugin,
  path: string,
): Promise<ArrayBuffer> {
  if (!path.startsWith("assets/") || !Object.hasOwn(plugin.files, path))
    throw new BundleIntegrityError(path, "a file under assets/", "not in the package");
  return verifiedFile(plugin, path);
}

export async function loadBundle(plugin: AvailablePlugin): Promise<VerifiedBundle> {
  const [entry, ...styles] = await Promise.all([
    verifiedFile(plugin, plugin.entry.module),
    ...plugin.entry.styles.map((path) => verifiedFile(plugin, path)),
  ]);
  const decoder = new TextDecoder();
  return { entry, styles: styles.map((bytes) => decoder.decode(bytes)) };
}
