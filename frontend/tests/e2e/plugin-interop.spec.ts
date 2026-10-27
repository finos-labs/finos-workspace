import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { authFile, deleteDashboard, userInfo } from "./helpers";
import { type ApiResponse, grantPlugins, type PageApi, pageApi } from "./plugins/api";
import { writePackage } from "./plugins/fixtures";
import {
  fetchInteropModules,
  INTEROP_MODULES,
  interopEntry,
  interopManifest,
} from "./plugins/interop";

const PLUGINS_DIR = process.env.E2E_PLUGINS_DIR;
const API_URL = process.env.E2E_API_URL ?? "https://localhost:8000";
const FAILURES = [
  "Plugin sandbox unavailable",
  "Failed to load",
  "Plugin error",
  "Not responding",
  "The widget was stopped",
];

test.describe.configure({ mode: "serial" });
test.skip(
  !(PLUGINS_DIR && process.env.E2E_INTEROP),
  "E2E_INTEROP and E2E_PLUGINS_DIR run the interop smoke tests",
);

let context: BrowserContext;
let page: Page;
let api: PageApi;
let roleUuid: string | undefined;
let dashboardId: string;

async function json(response: ApiResponse) {
  expect(response.ok(), `${response.url()}: ${response.status()}`).toBe(true);
  return response.json();
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(180000);
  const baseURL = testInfo.project.use.baseURL ?? "https://localhost:3000";
  const files = await fetchInteropModules(testInfo.outputPath("wheels"));
  const versions: Record<string, string> = {};
  for (const module of INTEROP_MODULES) {
    const manifest = interopManifest(module);
    const { esm, css } = files[module.id];
    versions[manifest.id] = writePackage(PLUGINS_DIR ?? "", manifest, {
      "entry.js": interopEntry(module),
      "assets/module.js": esm,
      ...(css ? { "entry.css": css } : {}),
    });
  }

  context = await browser.newContext({ storageState: authFile, baseURL });
  page = await context.newPage();
  await page.goto("/app");
  api = await pageApi(context, API_URL);

  await json(await api.post("/plugins/rescan"));
  const listing = await json(await api.get("/plugins"));
  for (const [id, version] of Object.entries(versions)) {
    const entry = listing.plugins
      .find((p: { plugin_id: string }) => p.plugin_id === id)
      ?.versions.find((v: { version: string }) => v.version === version);
    expect(entry, `${id}@${version} was discovered`).toBeTruthy();
    if (entry.state === "discovered") {
      const acknowledged = entry.review
        .filter((item: { added: boolean }) => item.added)
        .map((item: { key: string }) => item.key);
      await json(
        await api.post(`/plugins/${id}/versions/${version}/approve`, {
          data: { digest: entry.digest, acknowledged },
        }),
      );
    }
    await json(
      await api.put(`/admin/plugins/${id}`, {
        data: { enabled: true },
      }),
    );
  }
  roleUuid = await grantPlugins(
    api,
    userInfo().email,
    "E2E interop",
    Object.keys(versions),
  );

  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  await page.locator("#tabs").getByRole("button").first().click();
  await page.getByRole("button", { name: /New Dashboard/ }).click();
  await page.waitForURL(/\/app\/[a-f0-9-]+/, { timeout: 10000 });
  dashboardId = new URL(page.url()).pathname.split("/").pop() ?? "";
});

test.afterAll(async () => {
  if (page && dashboardId) await deleteDashboard(page, dashboardId);
  if (api && roleUuid) await api.delete(`/admin/role/${roleUuid}`);
  await api?.dispose();
  await context?.close();
});

for (const module of INTEROP_MODULES) {
  test(`${module.id}-renders-in-a-plugin-frame`, async () => {
    const name = `Interop ${module.name}`;
    const empty = page.getByRole("button", { name: "Add widgets" });
    if (await empty.isVisible()) await empty.click();
    else await page.getByTestId("dashboard-toolbar-add-widget-button").click();
    const menu = page.getByRole("dialog");
    await menu.getByPlaceholder("Search for widgets").fill(module.name);
    await menu.getByText(name, { exact: true }).first().click();
    await menu.getByRole("button", { name: "Add widgets" }).click();
    await expect(menu).toBeHidden();

    const frame = page.frameLocator(`iframe[title^="${name}"]`);
    await expect(frame.locator("#root > *").first()).toBeAttached({ timeout: 30000 });
    const card = page.locator("div.group\\/widget").filter({ hasText: name });
    for (const failure of FAILURES)
      await expect(card.getByText(failure)).toHaveCount(0);
  });
}
