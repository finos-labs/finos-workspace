import { expect, test } from "@playwright/test";
import { addUser, deleteUser, setPassword, submitLogin } from "./helpers";

const SIGNED_OUT = { cookies: [], origins: [] };

// Connections are what an Admin or a Developer brings. A User brings none: the sidebar has no
// Connections for them, and the page sends them to Apps.
test("a User has no Connections", async ({ page, browser }) => {
  const connections = (on: typeof page) =>
    on.getByRole("link", { name: "Connections", exact: true });
  await page.goto("/app");
  await expect(connections(page)).toBeVisible();

  const id = crypto.randomUUID().slice(0, 8);
  const email = `e2e-user-${id}@example.com`;
  const password = `E2e-${id}!1A`;
  const link = await addUser(page, email, "User");
  const context = await browser.newContext({ storageState: SIGNED_OUT });
  try {
    const user = await context.newPage();
    await setPassword(user, link, password);
    await expect(
      user.getByText("Your password is set. Sign in with it."),
    ).toBeVisible();
    await submitLogin(user, email, password);
    await user.waitForURL(/\/app/, { timeout: 30000 });

    await expect(user.getByRole("link", { name: "Apps", exact: true })).toBeVisible();
    await expect(connections(user)).toHaveCount(0);
    await expect(user.getByRole("link", { name: "Connections page" })).toHaveCount(0);

    await user.goto("/app/connections");
    await expect(user).toHaveURL(/\/app$/);
  } finally {
    await context.close();
    await deleteUser(page, email);
  }
});
