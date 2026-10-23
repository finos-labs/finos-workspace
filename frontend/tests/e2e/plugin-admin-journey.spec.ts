import { rmSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { authFile, deleteDashboard, userInfo } from "./helpers";
import { type ApiResponse, type PageApi, pageApi } from "./plugins/api";
import {
  journeyEntry,
  journeyManifest,
  startReachServer,
  writePackage,
} from "./plugins/fixtures";

const PLUGINS_DIR = process.env.E2E_PLUGINS_DIR;
const API_URL = process.env.E2E_API_URL ?? "https://localhost:8000";
const REACH_PORT = Number(process.env.E2E_REACH_PORT ?? 7793);
const REACH = `http://localhost:${REACH_PORT}`;
const RUN = Math.random().toString(36).slice(2, 8);
const PLUGIN = `e2e-journey-${RUN}`;
const ROLE = `E2E journey ${RUN}`;
const FIRST = "1.0.0";
const SECOND = "1.1.0";

test.describe.configure({ mode: "serial" });
test.skip(!PLUGINS_DIR, "E2E_PLUGINS_DIR names the API's plugins directory");

let context: BrowserContext;
let page: Page;
let api: PageApi;
let reach: Server;
let hits: string[];
let roleUuid: string;
let dashboardId: string;

const frame = () => page.frameLocator('iframe[title^="E2E journey"]');
const card = () =>
  page.locator("div.group\\/widget").filter({ hasText: "E2E journey" });

async function json(response: ApiResponse) {
  expect(response.ok(), `${response.url()}: ${response.status()}`).toBe(true);
  return response.json();
}

function placeVersion(version: string, label: string) {
  writePackage(
    PLUGINS_DIR ?? "",
    journeyManifest(PLUGIN),
    { "entry.js": journeyEntry(label, REACH) },
    version,
  );
}

async function openDeployment() {
  await page.goto("/admin/widgets");
  await page.getByRole("tab", { name: "Deployment" }).click();
  const row = page.getByTestId("platform-plugins").getByRole("row").filter({
    hasText: PLUGIN,
  });
  return { row, detail: page.getByTestId(`plugin-detail-${PLUGIN}`) };
}

async function approveInTheUi(version: string) {
  const summary = page.getByTestId(`trust-summary-${version}`);
  for (const box of await summary.getByRole("checkbox").all()) await box.check();
  const approved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith(
        `/plugins/${PLUGIN}/versions/${version}/approve`,
      ),
  );
  await summary
    .getByRole("button", { name: new RegExp(`^Approve ${version}`) })
    .click();
  expect((await approved).ok()).toBe(true);
}

async function reports(): Promise<{ directive: string; origin: string }[]> {
  return json(await api.get(`/plugins/${PLUGIN}/csp-reports`));
}

async function openDashboard() {
  await page.goto(`/app/${dashboardId}`);
  await expect(card()).toBeVisible({ timeout: 30000 });
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const baseURL = testInfo.project.use.baseURL ?? "https://localhost:3000";
  ({ server: reach, hits } = await startReachServer(REACH_PORT));
  context = await browser.newContext({ storageState: authFile, baseURL });
  page = await context.newPage();
  await page.goto("/app");
  api = await pageApi(context, API_URL);
});

test.afterAll(async () => {
  if (page && dashboardId) {
    await page.goto("/app");
    await deleteDashboard(page, dashboardId);
  }
  if (api) {
    if (roleUuid) await api.delete(`/admin/role/${roleUuid}`);
    rmSync(join(PLUGINS_DIR ?? "", PLUGIN), { recursive: true, force: true });
    await api.post("/plugins/rescan");
    await api.delete(`/plugins/${PLUGIN}`);
  }
  await api?.dispose();
  await context?.close();
  reach?.close();
});

test("superuser-rescans-reviews-and-approves", async () => {
  placeVersion(FIRST, "first");
  const { row } = await openDeployment();
  await page.getByRole("button", { name: "Rescan" }).click();
  await expect(row).toContainText("discovered");
  await row.click();

  const summary = page.getByTestId(`trust-summary-${FIRST}`);
  await expect(summary.getByText("Runs code on the server")).toBeVisible();
  const approve = summary.getByRole("button", { name: `Approve ${FIRST}` });
  await expect(approve).toBeDisabled();
  await approveInTheUi(FIRST);
  await expect(row).toContainText("active");
  await expect(row).toContainText(FIRST);
});

test("entity-admin-enables-it-and-grants-a-role", async () => {
  roleUuid = crypto.randomUUID();
  await json(
    await api.post("/admin/role", {
      data: {
        uuid: roleUuid,
        name: ROLE,
        description: "Members may use the journey plugin",
        users: [userInfo().email],
      },
    }),
  );

  await page.goto("/admin/widgets");
  const plugin = page.getByTestId(`entity-plugin-${PLUGIN}`);
  await plugin.getByRole("switch", { name: "Enabled" }).click();
  await expect(plugin.getByRole("switch", { name: "Enabled" })).toBeChecked();

  await page.goto("/admin/roles");
  const roleRow = page.getByRole("row").filter({ hasText: ROLE });
  await roleRow.hover();
  await roleRow.getByRole("button", { name: "Widget plugins" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "E2E journey", exact: true }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  expect(
    (await json(await api.get(`/admin/role/${roleUuid}/plugin-access`))).grants,
  ).toEqual([{ plugin_id: PLUGIN, widget_id: "journey" }]);
});

test("a-member-of-the-role-adds-the-widget", async () => {
  test.setTimeout(90000);
  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  await page.locator("#tabs").getByRole("button").first().click();
  await page.getByRole("button", { name: /New Dashboard/ }).click();
  await page.waitForURL(/\/app\/[a-f0-9-]+/, { timeout: 10000 });
  dashboardId = new URL(page.url()).pathname.split("/").pop() ?? "";
  await page.getByRole("button", { name: "Add widgets" }).click();
  const menu = page.getByRole("dialog");
  await menu.getByPlaceholder("Search for widgets").fill("E2E journey");
  await menu.getByText("E2E journey", { exact: true }).first().click();
  await menu.getByRole("button", { name: "Add widgets" }).click();
  await expect(menu).toBeHidden();

  await expect(frame().locator("#e2e-journey-version")).toHaveText("first", {
    timeout: 30000,
  });
  await expect(frame().locator("#e2e-journey-reach")).toHaveText("blocked");
  expect(hits).toEqual([]);

  await expect
    .poll(async () => (await reports()).length, { timeout: 40000, intervals: [2000] })
    .toBeGreaterThanOrEqual(150);
  await page.waitForTimeout(6000);
  const blocked = (await reports()).map((r) => `${r.directive} ${r.origin}`);
  expect(blocked.length).toBeLessThanOrEqual(200);
  expect(blocked).toContain(`connect-src ${REACH}`);
  expect(blocked.filter((r) => r.includes("forged"))).toEqual([]);
});

test("the-activity-log-and-the-entity-dialog-name-the-plugin", async () => {
  await page.goto("/admin/roles");
  await page.getByRole("tab", { name: "Activity Log" }).click();
  await page.getByPlaceholder("Search activities").fill(ROLE);
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "Assign widget plugin" })
      .filter({ hasText: `Granted widget 'journey' of plugin '${PLUGIN}'.` }),
  ).toBeVisible({ timeout: 20000 });

  const detail = await json(await api.get(`/plugins/${PLUGIN}`));
  const entity = detail.entities.find((e: { enabled: boolean }) => e.enabled);
  await page.goto("/admin/entities");
  await page
    .getByRole("row")
    .filter({ hasText: entity.name })
    .getByRole("button", { name: "Edit entity" })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("entity-plugins")).toContainText(
    "End-to-end journey",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("a-blocked-request-is-allowed-through-an-override", async () => {
  const { row, detail } = await openDeployment();
  await row.click();
  const feed = detail.locator("section").filter({ hasText: "Blocked requests" });
  await expect(feed.locator("li")).toHaveCount((await reports()).length);
  await expect(feed.locator("b")).toHaveCount(0);
  await feed
    .locator("li")
    .filter({ hasText: REACH })
    .getByRole("button", { name: "Allow" })
    .click();

  await expect(detail.getByRole("checkbox", { name: "connect-src" })).toBeChecked();
  await expect(detail.getByLabel("connect-src sources")).toHaveValue(REACH);
  await expect(detail.getByRole("button", { name: "Save overrides" })).toBeDisabled();
  await detail.getByRole("checkbox", { name: /Allow plain http/ }).check();
  await detail.getByRole("checkbox", { name: /Allow private hosts/ }).check();
  await detail.getByRole("button", { name: "Save overrides" }).click();
  await expect
    .poll(async () => (await json(await api.get(`/plugins/${PLUGIN}`))).overrides)
    .toEqual({
      csp: { "connect-src": [REACH] },
      confirmations: ["insecure-scheme", "private-host"],
    });

  await openDashboard();
  await expect(frame().locator("#e2e-journey-reach")).toHaveText("reached", {
    timeout: 30000,
  });
  expect(hits).toContain("/ping");
});

test("a-second-version-waits-for-its-approval", async () => {
  placeVersion(SECOND, "second");
  const { row } = await openDeployment();
  await page.getByRole("button", { name: "Rescan" }).click();
  await expect(row).toContainText(`(update ${SECOND})`);

  await openDashboard();
  await expect(frame().locator("#e2e-journey-version")).toHaveText("first", {
    timeout: 30000,
  });

  await openDeployment();
  await row.click();
  const summary = page.getByTestId(`trust-summary-${SECOND}`);
  await expect(summary.getByText(`Changes since ${FIRST}`)).toBeVisible();
  await expect(summary.getByText("The code of this version (changed)")).toBeVisible();
  await approveInTheUi(SECOND);
  await expect(row).toContainText(`${SECOND}`);

  await openDashboard();
  await expect(frame().locator("#e2e-journey-version")).toHaveText("second", {
    timeout: 30000,
  });
});

test("revoking-leaves-a-placeholder", async () => {
  const { row, detail } = await openDeployment();
  await row.click();
  await detail.getByRole("button", { name: "Revoke" }).click();
  await expect(row).toContainText("revoked");

  await openDashboard();
  await expect(
    card().getByText("This widget type is not available to you"),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator('iframe[title^="E2E journey"]')).toHaveCount(0);

  await openDeployment();
  await row.click();
  await detail.getByRole("button", { name: "Restore" }).click();
  await expect(row).toContainText("enabled");
  await openDashboard();
  await expect(frame().locator("#e2e-journey-version")).toHaveText("second", {
    timeout: 30000,
  });
});
