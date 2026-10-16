import { expect, type Page, test } from "@playwright/test";

const ENTITY_TYPES_URL = "/admin/entities?tab=entity-types";

/** The row of a table that shows `text`. */
function rowWith(page: Page, text: string) {
  return page.getByRole("row").filter({ hasText: text });
}

test("a superuser finds Entities in the Admin area", async ({ page }) => {
  await page.goto("/admin");
  await page.getByRole("link", { name: "Entities" }).click();

  await expect(page.getByText("Entity Management")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add entity" })).toBeVisible();
});

test("the entity types the stack starts with are listed", async ({ page }) => {
  await page.goto(ENTITY_TYPES_URL);

  await expect(rowWith(page, "On-Premise")).toBeVisible();
});

test("an entity type can be added and renamed", async ({ page }) => {
  // The code of an entity type is three characters and unique
  const code = Math.random().toString(36).slice(2, 5);
  const name = `E2E type ${code}`;
  await page.goto(ENTITY_TYPES_URL);

  await page.getByRole("button", { name: "Add entity type" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Entity type").fill(name);
  await dialog.getByLabel("Code").fill(code);
  await dialog.getByRole("button", { name: "Add entity type" }).click();
  await expect(rowWith(page, name)).toBeVisible();

  await rowWith(page, name).getByRole("button", { name: "Edit entity type" }).click();
  await page.getByRole("dialog").getByLabel("Entity type").fill(`${name} renamed`);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(rowWith(page, `${name} renamed`)).toBeVisible();
});

test("an entity opens with its sharing switch", async ({ page }) => {
  await page.goto("/admin/entities");

  await page.getByRole("button", { name: "Edit entity" }).first().click();
  const dialog = page.getByRole("dialog");

  await expect(dialog.getByRole("switch", { name: "Sharing enabled" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});
