import { expect, test } from "@playwright/test";
import { userInfo } from "./helpers";

// The admin panel is a separate app; `docker compose up` serves it on port 3001
const ADMIN_PANEL_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:3001";

test.use({ storageState: { cookies: [], origins: [] } });

test("the admin panel signs the administrator in and lists the entities", async ({
  page,
}) => {
  const { email, password } = userInfo();
  await page.goto(`${ADMIN_PANEL_URL}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.getByText("Entity Administration")).toBeVisible();
  await page.getByRole("tab", { name: "Entity", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add" })).toBeVisible();
});
