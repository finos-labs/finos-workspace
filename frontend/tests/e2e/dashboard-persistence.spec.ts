import { expect, type Page, test } from "@playwright/test";
import { deleteDashboard } from "./helpers";

const widgetCards = (page: Page) => page.locator("div.group\\/widget");

async function createNewDashboard(page: Page): Promise<string> {
  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  await page.locator("#tabs").getByRole("button").first().click();
  await page.getByRole("button", { name: /New Dashboard/ }).click();
  await page.waitForURL(/\/app\/[a-f0-9-]+/, { timeout: 10000 });
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}

test("a-widget-added-just-before-a-reload-is-kept", async ({ page }) => {
  const id = await createNewDashboard(page);
  await page.getByRole("button", { name: "Add widgets" }).click();
  const menu = page.getByRole("dialog");
  await menu.getByText("Iframe", { exact: true }).click();
  await menu.getByRole("button", { name: "Add widgets" }).click();
  await expect(menu).toBeHidden();
  await expect(widgetCards(page)).toHaveCount(1);

  await page.reload();
  await expect(page.locator(`#tab-${id}`)).toBeVisible({ timeout: 30000 });
  await expect(widgetCards(page)).toHaveCount(1, { timeout: 30000 });
  await deleteDashboard(page, id);
});

test("a-dashboard-renamed-just-before-a-reload-keeps-its-name", async ({ page }) => {
  const id = await createNewDashboard(page);
  const name = `Kept ${id.slice(0, 8)}`;
  await page.locator(`#tab-${id}`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox").fill(name);
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.locator(`#tab-${id}`)).toContainText(name);

  await page.reload();
  await expect(page.locator(`#tab-${id}`)).toContainText(name, { timeout: 30000 });
  await deleteDashboard(page, id);
});
