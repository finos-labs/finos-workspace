import { type Browser, expect, type Page, test } from "@playwright/test";
import { submitLogin } from "./helpers";

const SIGNED_OUT = { cookies: [], origins: [] };
const USED = "This link has expired or was used already. Ask your admin for a new one.";

/** The row of the users table that shows `email`, found with the search box. */
async function userRow(page: Page, email: string) {
  await page.getByPlaceholder("Search for users").fill(email);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toBeVisible();
  return row;
}

async function openUser(page: Page, email: string) {
  await page.goto("/admin/users");
  const row = await userRow(page, email);
  await row.hover();
  await row.getByRole("button", { name: "Edit user" }).click();
}

/** The link the open dialog gives, once the dialog is closed with Done. */
async function takeLink(page: Page) {
  const link = await page.getByLabel("Password link").inputValue();
  expect(link).toMatch(/\/reset-password#[\w-]{40,}$/);
  await page.getByRole("button", { name: "Done" }).click();
  return link;
}

async function setPassword(page: Page, link: string, password: string) {
  await page.goto(link);
  // The token is off the address once the page has it
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel("New Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Set password" }).click();
}

/** Sets the password with the link in a browser of the user's own, and signs in with it. */
async function setPasswordAndSignIn(
  browser: Browser,
  link: string,
  email: string,
  password: string,
) {
  const context = await browser.newContext({ storageState: SIGNED_OUT });
  try {
    const page = await context.newPage();
    await setPassword(page, link, password);
    await expect(
      page.getByText("Your password is set. Sign in with it."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign in" }).click();
    await submitLogin(page, email, password);
    await page.waitForURL(/\/app/, { timeout: 30000 });

    await setPassword(page, link, `${password}2`);
    await expect(page.getByText(USED)).toBeVisible();
  } finally {
    await context.close();
  }
}

// An admin adds a user, which gives a link; the user opens it, sets a password and signs
// in. The admin's reset gives another link, which works the same way. A link works once.
test("a user sets their password with the link an admin gives them", async ({
  page,
  browser,
}) => {
  const id = crypto.randomUUID().slice(0, 8);
  const email = `e2e-reset-${id}@example.com`;

  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Add users" }).click();
  const addDialog = page.getByRole("dialog");
  await addDialog.getByLabel("First name").fill("E2E");
  await addDialog.getByLabel("Last name").fill("Reset");
  await addDialog.getByLabel("Email address").fill(email);
  await addDialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(addDialog.getByText(/Temporary password/)).toHaveCount(0);
  const addLink = await takeLink(page);
  await expect(addDialog).toBeHidden();

  try {
    await setPasswordAndSignIn(browser, addLink, email, `E2e-${id}!1A`);

    await openUser(page, email);
    await page.getByTestId("reset-password-button").click();
    await page.getByRole("button", { name: "Yes, reset password" }).click();
    const resetLink = await takeLink(page);
    expect(resetLink).not.toBe(addLink);

    await setPasswordAndSignIn(browser, resetLink, email, `E2e-${id}!2B`);
  } finally {
    await openUser(page, email);
    await page.getByTestId("delete-account-button").click();
    await page.getByRole("button", { name: "Yes, delete account" }).click();
    await expect(page.getByTestId("delete-user-dialog")).toBeHidden();
  }
});

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT });

  test("the login page sends a user who forgot their password to their admin", async ({
    page,
  }) => {
    await page.goto("/login");

    await expect(page.getByText(/Forgot your password\? Ask your admin/)).toBeVisible();
  });
});
