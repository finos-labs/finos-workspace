import type { Page } from "@playwright/test";

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
