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
