import { expect, test } from "@playwright/test";
import { submitLogin } from "./helpers";

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("visiting the app redirects to the login page", async ({ page }) => {
    await page.goto("/app");

    await expect(page).toHaveURL(/\/login/);
  });

  test("a wrong password does not sign in", async ({ page }) => {
    await submitLogin(page, "nobody@example.com", "not-the-password");

    await expect(page).toHaveURL(/\/login/);
  });
});
