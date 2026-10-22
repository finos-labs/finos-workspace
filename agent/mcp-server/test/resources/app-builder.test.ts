/**
 * App-builder resource catalog smoke test.
 *
 * Asserts that all 16 markdown files declared in resources/app-builder.ts
 * exist on disk and resolve via the same import.meta.dirname path the server
 * uses at boot.
 */

import { describe, test } from "node:test";
import { expect } from "expect";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { listAppBuilderResourceUris } from "../../src/resources/app-builder.ts";

const RESOURCE_DIR = join(import.meta.dirname, "../../src/resources/app-builder");

describe("app-builder resources", () => {
  test("16 URIs registered", () => {
    expect(listAppBuilderResourceUris()).toHaveLength(16);
  });

  test("URI namespace consistent (workspace://*)", () => {
    for (const uri of listAppBuilderResourceUris()) {
      expect(uri.startsWith("workspace://")).toBe(true);
    }
  });

  test("all 16 markdown files are loadable", async () => {
    const filePaths = [
      "app-builder-index.md",
      "overview/what-is-workspace.md",
      "overview/ai-agent-contract.md",
      "backend-contract.md",
      "specs/widgets-json.md",
      "specs/apps-json.md",
      "specs/widget-types.md",
      "specs/widget-parameters.md",
      "specs/layout-grid.md",
      "guides/build-an-app.md",
      "guides/review-app.md",
      "guides/debug-app.md",
      "guides/convert-endpoint-to-widget.md",
      "examples/generic-http-minimal.md",
      "examples/python-fastapi-minimal.md",
      "validation/common-errors.md",
    ];
    let totalBytes = 0;
    for (const p of filePaths) {
      const file = join(RESOURCE_DIR, p);
      expect(existsSync(file)).toBe(true);
      const text = await readFile(file, "utf8");
      expect(text.length).toBeGreaterThan(0);
      totalBytes += text.length;
    }
    // Sanity: the guides are shipped whole, not as stubs.
    expect(totalBytes).toBeGreaterThan(30_000);
  });
});
