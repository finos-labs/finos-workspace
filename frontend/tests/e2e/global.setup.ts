import { expect, test as setup } from "@playwright/test";
import { authFile, login } from "./helpers";

setup("sign in", async ({ page }) => {
  await login(page);

  await page.waitForURL(/\/app/, { timeout: 30000 });
  await expect(page.locator("#tabs")).toBeVisible({ timeout: 30000 });

  await page.context().storageState({ path: authFile });
});
