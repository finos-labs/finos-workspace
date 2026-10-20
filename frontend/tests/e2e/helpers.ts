import { expect, type Page } from "@playwright/test";

export const authFile = "playwright/.auth/user.json";

/** The account the tests sign in as; it has to exist in the stack under test. */
export function userInfo(): { email: string; password: string } {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!(email && password)) {
    throw new Error(
      "Set E2E_USER_EMAIL and E2E_USER_PASSWORD to an account of the stack under test",
    );
  }
  return { email, password };
}

/** Submits the login form with the given credentials. */
export async function submitLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  // exact: the show-password button is labelled "Show password"
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Login" }).click();
}

export async function login(page: Page) {
  const { email, password } = userInfo();
  await submitLogin(page, email, password);
}

/**
 * Deletes a dashboard a test made, from its tab's menu, and waits until the server has
 * deleted it too. A dashboard that was changed asks first.
 */
export async function deleteDashboard(page: Page, id: string) {
  // A test that failed may have left a dialog open over the sidebar
  await page.keyboard.press("Escape");
  const deleted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/app/dash/sync") &&
      response.request().method() === "POST" &&
      response.request().postData()?.includes(`"${id}":"DELETE"`) === true,
  );
  const tab = page.locator(`#tab-${id}`);
  await tab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("button", { name: "Yes, delete" });
  await expect(async () => {
    if (await confirm.isVisible()) await confirm.click();
    await expect(tab).toHaveCount(0, { timeout: 500 });
  }).toPass({ timeout: 10000 });
  expect((await deleted).ok()).toBe(true);
}

/** The link the open dialog gives, once the dialog is closed with Done. */
export async function takeLink(page: Page) {
  const link = await page.getByLabel("Password link").inputValue();
  expect(link).toMatch(/\/reset-password#[\w-]{40,}$/);
  await page.getByRole("button", { name: "Done" }).click();
  return link;
}

/** Sets a password with a link from the admin. */
export async function setPassword(page: Page, link: string, password: string) {
  await page.goto(link);
  // The token is off the address once the page has it
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel("New Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Set password" }).click();
}

/** Adds a user (of the User type) to the admin's organization; the answer is their link. */
export async function addUser(page: Page, email: string, lastName: string) {
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Add users" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("First name").fill("E2E");
  await dialog.getByLabel("Last name").fill(lastName);
  await dialog.getByLabel("Email address").fill(email);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  const link = await takeLink(page);
  await expect(dialog).toBeHidden();
  return link;
}

/** Deletes a user of the admin's organization, as the admin. */
export async function deleteUser(page: Page, email: string) {
  await page.goto("/admin/users");
  await page.getByPlaceholder("Search for users").fill(email);
  const row = page.getByRole("row").filter({ hasText: email });
  await row.hover();
  await row.getByRole("button", { name: "Edit user" }).click();
  await page.getByTestId("delete-account-button").click();
  await page.getByRole("button", { name: "Yes, delete account" }).click();
  await expect(page.getByTestId("delete-user-dialog")).toBeHidden();
}
