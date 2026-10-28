import { expect, test } from "@playwright/test";

test("the session survives a reload and stays out of the page's reach", async ({
  page,
  context,
}) => {
  await page.goto("/app");
  await expect(page.locator("#tabs")).toBeVisible({ timeout: 30000 });

  await page.reload();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.locator("#tabs")).toBeVisible({ timeout: 30000 });

  const session = (await context.cookies()).find(
    (cookie) => cookie.name === "__Host-ws_session",
  );
  expect(session).toBeDefined();
  expect(session?.httpOnly).toBe(true);
  expect(session?.secure).toBe(true);
  expect(session?.sameSite).toBe("Strict");

  const pageSees = await page.evaluate(() =>
    JSON.stringify({
      cookie: document.cookie,
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(pageSees).not.toContain(session?.value ?? "no session cookie");
  expect(pageSees).not.toContain("auth-storage");
  expect(pageSees).not.toContain("access_token");
});
