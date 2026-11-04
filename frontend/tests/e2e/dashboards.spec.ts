import * as fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { deleteDashboard } from "./helpers";

async function createNewDashboard(page: Page): Promise<string> {
  await page.waitForSelector("#tabs", { timeout: 30000 });
  await page.locator("#tabs").getByRole("button").first().click();
  await page.getByRole("button", { name: /New Dashboard/ }).click();
  await page.waitForURL(/\/app\/[a-f0-9-]+/, { timeout: 10000 });

  const id = new URL(page.url()).pathname.split("/").pop() ?? "";
  await dashboardItem(page, id).waitFor({ state: "visible", timeout: 5000 });
  return id;
}

async function addWidget(page: Page, name: string) {
  await page.getByRole("button", { name: "Add widgets" }).click();
  const menu = page.getByRole("dialog");
  await menu.getByText(name, { exact: true }).click();
  await menu.getByRole("button", { name: "Add widgets" }).click();
  await expect(menu).toBeHidden();
}

function dashboardItem(page: Page, id: string) {
  return page.locator(`#tab-${id}`);
}

async function openDashboardContextMenu(page: Page, id: string) {
  await dashboardItem(page, id).click({ button: "right" });
}

test("dashboards-rename", async ({ page }) => {
  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  const id = await createNewDashboard(page);

  await openDashboardContextMenu(page, id);
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox").fill("Renamed Dashboard");
  await page.getByRole("button", { name: "Rename" }).click();

  await expect(dashboardItem(page, id)).toContainText("Renamed Dashboard");
  await deleteDashboard(page, id);
});

test("dashboards-delete", async ({ page }) => {
  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  const id = await createNewDashboard(page);

  await deleteDashboard(page, id);
});

test("dashboards-export", async ({ page }) => {
  test.setTimeout(60000);

  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  const id = await createNewDashboard(page);
  await addWidget(page, "Iframe");

  await openDashboardContextMenu(page, id);
  await page.getByRole("menuitem", { name: "Export PDF" }).click();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  if (downloadPath) {
    fs.unlinkSync(downloadPath);
  }
  await deleteDashboard(page, id);
});
