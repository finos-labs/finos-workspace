import { expect, type Page, test } from "@playwright/test";
import { addUser, deleteUser, userInfo } from "./helpers";

const USERS_URL = "/admin/entities?tab=users";

function rowWith(page: Page, text: string) {
  return page.getByRole("row").filter({ hasText: text });
}

test("a superuser finds Entities in the Admin area", async ({ page }) => {
  await page.goto("/admin");
  await page.getByRole("link", { name: "Entities" }).click();

  await expect(page.getByText("Entity Management")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add entity" })).toBeVisible();
});

test("an entity opens with its sharing switch", async ({ page }) => {
  await page.goto("/admin/entities");

  await page.getByRole("button", { name: "Edit entity" }).first().click();
  const dialog = page.getByRole("dialog");

  await expect(dialog.getByRole("switch", { name: "Sharing enabled" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

async function allUsersRow(page: Page, email: string) {
  await page.goto(USERS_URL);
  await page.getByPlaceholder("Search for users").fill(email);
  const row = rowWith(page, email);
  await expect(row).toBeVisible();
  return row;
}

test("All users lists the superuser with their user type", async ({ page }) => {
  const row = await allUsersRow(page, userInfo().email);

  await expect(row).toContainText("Admin");
});

test("a superuser moves a user to another user type", async ({ page }) => {
  const email = `e2e-move-${crypto.randomUUID().slice(0, 8)}@example.com`;
  await addUser(page, email, "Move");

  try {
    const row = await allUsersRow(page, email);
    await expect(row).toContainText("User");
    await row.hover();
    await row.getByRole("button", { name: "Move user" }).click();
    const moveDialog = page.getByRole("dialog");
    await expect(moveDialog.getByText(email)).toBeVisible();
    await moveDialog.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Developer" }).click();
    await moveDialog.getByRole("button", { name: "Move" }).click();
    await expect(moveDialog).toBeHidden();

    await expect(rowWith(page, email)).toContainText("Developer");
  } finally {
    await deleteUser(page, email);
  }
});
