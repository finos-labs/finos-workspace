import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPluginFile } from "~/api/plugins.api";
import {
  BundleIntegrityError,
  loadAsset,
  loadBundle,
  sha256Hex,
} from "~/plugins/bundle";
import type { AvailablePlugin } from "~/plugins/types";

vi.mock("~/api/plugins.api", () => ({ getPluginFile: vi.fn() }));

const served = new Map<string, Uint8Array>();
let digestCounter = 0;

const bytes = (text: string) => new TextEncoder().encode(text);

async function info(content: Uint8Array) {
  return { size: content.byteLength, sha256: await sha256Hex(content.slice().buffer) };
}

async function plugin(
  files: Record<string, string>,
  styles: string[] = [],
): Promise<AvailablePlugin> {
  served.clear();
  const listing: AvailablePlugin["files"] = {};
  for (const [path, text] of Object.entries(files)) {
    served.set(path, bytes(text));
    listing[path] = await info(bytes(text));
  }
  digestCounter += 1;
  return {
    id: "test-plugin",
    version: "1.0.0",
    name: "Test plugin",
    description: "",
    publisher: null,
    digest: `sha256-${String(digestCounter).padStart(43, "A")}`,
    entry: { module: "entry.js", styles },
    files: listing,
    csp: {},
    adminSettings: {},
    widgets: [],
  };
}

beforeEach(() => {
  vi.mocked(getPluginFile).mockReset();
  vi.mocked(getPluginFile).mockImplementation(async (_id, _digest, path) => {
    const content = served.get(path);
    if (!content) throw new Error(`no such file: ${path}`);
    return content.slice().buffer;
  });
});

describe("the host's check of a plugin's files against the approved version", () => {
  it("hands over the entry and styles whose hashes and sizes match", async () => {
    const approved = await plugin(
      { "entry.js": "export default {}", "entry.css": "p{}" },
      ["entry.css"],
    );
    const bundle = await loadBundle(approved);
    expect(new TextDecoder().decode(bundle.entry)).toBe("export default {}");
    expect(bundle.styles).toEqual(["p{}"]);
  });

  it("refuses an entry whose bytes differ from the approved digest", async () => {
    const approved = await plugin({ "entry.js": "export default {}" });
    served.set("entry.js", bytes("export default {}//"));
    const refused = loadBundle(approved);
    await expect(refused).rejects.toBeInstanceOf(BundleIntegrityError);
    await expect(refused).rejects.toMatchObject({
      path: "entry.js",
      expected: approved.files["entry.js"].sha256,
    });
  });

  it("refuses a style sheet whose bytes differ, so no part of the bundle is used", async () => {
    const approved = await plugin(
      { "entry.js": "export default {}", "entry.css": "p{}" },
      ["entry.css"],
    );
    served.set("entry.css", bytes("p{background:url(https://example.com/x)}"));
    await expect(loadBundle(approved)).rejects.toMatchObject({ path: "entry.css" });
  });

  it("refuses bytes of the right hash but another length", async () => {
    const approved = await plugin({ "entry.js": "export default {}" });
    approved.files["entry.js"] = {
      ...approved.files["entry.js"],
      size: approved.files["entry.js"].size + 1,
    };
    await expect(loadBundle(approved)).rejects.toBeInstanceOf(BundleIntegrityError);
  });

  it("refuses an entry the listing does not name", async () => {
    const approved = await plugin({ "other.js": "export default {}" });
    await expect(loadBundle(approved)).rejects.toMatchObject({ path: "entry.js" });
    expect(getPluginFile).not.toHaveBeenCalled();
  });

  it("serves an asset only from assets/ and only when its bytes match", async () => {
    const approved = await plugin({
      "entry.js": "export default {}",
      "assets/data.bin": "data",
    });
    expect(new TextDecoder().decode(await loadAsset(approved, "assets/data.bin"))).toBe(
      "data",
    );
    await expect(loadAsset(approved, "entry.js")).rejects.toBeInstanceOf(
      BundleIntegrityError,
    );
    await expect(loadAsset(approved, "assets/missing.bin")).rejects.toBeInstanceOf(
      BundleIntegrityError,
    );
    const tampered = await plugin({
      "entry.js": "export default {}",
      "assets/data.bin": "data",
    });
    served.set("assets/data.bin", bytes("DATA"));
    await expect(loadAsset(tampered, "assets/data.bin")).rejects.toMatchObject({
      path: "assets/data.bin",
    });
  });

  it("does not keep a refused file, so the approved bytes load on a retry", async () => {
    const approved = await plugin({ "entry.js": "export default {}" });
    served.set("entry.js", bytes("tampered"));
    await expect(loadBundle(approved)).rejects.toBeInstanceOf(BundleIntegrityError);
    served.set("entry.js", bytes("export default {}"));
    await expect(loadBundle(approved)).resolves.toMatchObject({ styles: [] });
  });
});
