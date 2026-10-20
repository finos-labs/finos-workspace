import { rmSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { authFile, deleteDashboard, userInfo } from "./helpers";
import { type ApiResponse, grantPlugins, type PageApi, pageApi } from "./plugins/api";
import {
  CONFORMANCE_ENTRY,
  conformanceManifest,
  writePackage,
} from "./plugins/fixtures";

/**
 * The guest contract in a real frame (docs/widget-plugins/GUEST-CONTRACT.md 8), with the
 * real host on the other end: the cases a frame can only show with the browser's sandbox,
 * the Blob URL import and the host's checks. The shell's own semantics are pinned in
 * tests/unit/plugins/shell.conformance.test.ts.
 *
 * The plugin has an id of its own per run and is forgotten at the end. Without
 * E2E_PLUGINS_DIR the tests are skipped.
 */

const PLUGINS_DIR = process.env.E2E_PLUGINS_DIR;
const API_URL = process.env.E2E_API_URL ?? "https://localhost:8000";
const PLUGIN = `e2e-conformance-${Math.random().toString(36).slice(2, 8)}`;
// A file of the package under assets/, which the frame reads with core:asset:read
const ASSET = "conformance asset, as approved\n";

test.describe.configure({ mode: "serial" });
test.skip(!PLUGINS_DIR, "E2E_PLUGINS_DIR names the API's plugins directory");

let context: BrowserContext;
let page: Page;
let api: PageApi;
let roleUuid: string | undefined;
let dashboardId: string;

const frame = () => page.frameLocator('iframe[title^="E2E conformance"]');

async function json(response: ApiResponse) {
  expect(response.ok(), `${response.url()}: ${response.status()}`).toBe(true);
  return response.json();
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const baseURL = testInfo.project.use.baseURL ?? "https://localhost:3000";
  const version = writePackage(PLUGINS_DIR ?? "", conformanceManifest(PLUGIN), {
    "entry.js": CONFORMANCE_ENTRY,
    "assets/sample.txt": ASSET,
  });
  context = await browser.newContext({ storageState: authFile, baseURL });
  page = await context.newPage();
  await page.goto("/app");
  api = await pageApi(context, API_URL);

  await json(await api.post("/plugins/rescan"));
  const plugin = (await json(await api.get(`/plugins/${PLUGIN}`))) as {
    versions: {
      version: string;
      digest: string;
      review: { key: string; added: boolean }[];
    }[];
  };
  const entry = plugin.versions.find((v) => v.version === version);
  await json(
    await api.post(`/plugins/${PLUGIN}/versions/${version}/approve`, {
      data: {
        digest: entry?.digest,
        acknowledged: entry?.review.filter((i) => i.added).map((i) => i.key),
      },
    }),
  );
  await json(
    await api.put(`/admin/plugins/${PLUGIN}`, {
      data: { enabled: true },
    }),
  );
  roleUuid = await grantPlugins(api, userInfo().email, "E2E conformance", [PLUGIN]);

  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  await page.locator("#tabs").getByRole("button").first().click();
  await page.getByRole("button", { name: /New Dashboard/ }).click();
  await page.waitForURL(/\/app\/[a-f0-9-]+/, { timeout: 10000 });
  dashboardId = new URL(page.url()).pathname.split("/").pop() ?? "";
  await page.getByRole("button", { name: "Add widgets" }).click();
  const menu = page.getByRole("dialog");
  await menu.getByPlaceholder("Search for widgets").fill("E2E conformance");
  await menu.getByText("E2E conformance", { exact: true }).first().click();
  await menu.getByRole("button", { name: "Add widgets" }).click();
  await expect(menu).toBeHidden();
});

test.afterAll(async () => {
  if (page && dashboardId) await deleteDashboard(page, dashboardId);
  if (api) {
    if (roleUuid) await api.delete(`/admin/role/${roleUuid}`);
    rmSync(join(PLUGINS_DIR ?? "", PLUGIN), { recursive: true, force: true });
    await api.post("/plugins/rescan");
    await api.delete(`/plugins/${PLUGIN}`);
  }
  await api?.dispose();
  await context?.close();
});

test("the-contract-holds-in-a-real-frame", async () => {
  const results = frame().locator("#e2e-conformance");
  await expect(results).toBeVisible({ timeout: 30000 });
  expect(JSON.parse((await results.textContent()) ?? "{}")).toEqual({
    order: ["initialize", "render"],
    // A command the widget may call resolves to [value, buffers]; one it may not is refused
    invoke: ["resolved", null],
    refused: "not_granted",
    // anywidget's own invoke, over model.send, is answered as msg:custom
    send: ["anywidget-command-response", null, 0],
    // The host echoes the previous value of a write it refuses
    unpermitted: "restored",
    oversized: "restored",
    // The plugin reads its own asset, checked against the approved version; nothing else
    asset: [ASSET.length, ASSET],
    assetOutside: "invalid_args",
    assetMissing: "out_of_scope",
    cross: "not_available",
  });
  for (const text of ["conformance invoke", "conformance send"])
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: text }),
    ).toBeVisible();
});

test("a-refresh-reaches-the-frame-as-a-host-event", async () => {
  const refreshes = frame().locator("#e2e-refreshes");
  await expect(refreshes).toHaveText("0");
  // What the dashboard's refresh dispatches
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("refreshQuery", { detail: { refreshQuery: true } }),
    ),
  );
  await expect(refreshes).toHaveText("1");
});
