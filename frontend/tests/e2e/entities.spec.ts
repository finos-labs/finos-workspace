import { expect, type Page, test } from "@playwright/test";
import { userInfo } from "./helpers";

const ENTITY_TYPES_URL = "/admin/entities?tab=entity-types";
const USERS_URL = "/admin/entities?tab=users";

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

  await expect(rowWith(page, "Default")).toBeVisible();
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

/** The row of All users that shows `email`, found with the search box. */
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

// A user an admin adds is moved to another user type of their entity, and deleted again
test("a superuser moves a user to another user type", async ({ page }) => {
  const email = `e2e-move-${crypto.randomUUID().slice(0, 8)}@example.com`;
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Add users" }).click();
  const addDialog = page.getByRole("dialog");
  await addDialog.getByLabel("First name").fill("E2E");
  await addDialog.getByLabel("Last name").fill("Move");
  await addDialog.getByLabel("Email address").fill(email);
  await addDialog.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(addDialog).toBeHidden();

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
    await page.goto("/admin/users");
    await page.getByPlaceholder("Search for users").fill(email);
    const row = rowWith(page, email);
    await row.hover();
    await row.getByRole("button", { name: "Edit user" }).click();
    await page.getByTestId("delete-account-button").click();
    await page.getByRole("button", { name: "Yes, delete account" }).click();
    await expect(page.getByTestId("delete-user-dialog")).toBeHidden();
  }
});
