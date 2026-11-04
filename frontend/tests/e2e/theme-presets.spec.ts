import { type Browser, expect, type Page, test } from "@playwright/test";

const EDITOR_URL = "/admin/theme-settings?tab=presets";
const NAME = `E2E ${crypto.randomUUID().slice(0, 8)}`;
const FINOS_BRAND = "#0086bf";
const BRAND = "#7b2d8e";
const OTHER_BRAND = "#0a7d3b";

test.describe.configure({ mode: "serial" });

const brand = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-main-100")
      .trim(),
  );

const brandInput = (page: Page) =>
  page.getByRole("textbox", { name: "--color-main-100", exact: true });

async function openEditor(page: Page, mode: "Light Mode" | "Dark Mode" = "Light Mode") {
  await page.goto(EDITOR_URL);
  await expect(page.getByRole("combobox").first()).toBeEnabled();
  await page.getByRole("tab", { name: mode }).click();
}

async function choose(page: Page, label: string) {
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: label }).click();
}

async function saveAs(page: Page, name: string) {
  await page.getByRole("button", { name: "Save as…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Preset name").fill(name);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
}

async function asAdmin(browser: Browser, work: (page: Page) => Promise<void>) {
  const context = await browser.newContext({
    storageState: "playwright/.auth/user.json",
    ignoreHTTPSErrors: true,
  });
  try {
    const page = await context.newPage();
    await page.goto(EDITOR_URL);
    await expect(page.getByRole("combobox").first()).toBeEnabled();
    await work(page);
  } finally {
    await context.close();
  }
}

test.beforeAll(async ({ browser }) => {
  await asAdmin(browser, async (page) => {
    await choose(page, "FINOS (default)");
    const apply = page.getByRole("button", { name: "Apply to everyone" });
    if (await apply.isVisible()) {
      await apply.click();
      await expect(page.getByText("Applied to everyone")).toBeVisible();
    }
  });
});

test.afterAll(async ({ browser }) => {
  await asAdmin(browser, async (page) => {
    await page.getByRole("combobox").first().click();
    const option = page.getByRole("option", { name: new RegExp(`^${NAME}`) });
    if (await option.count()) {
      await option.click();
      await page.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("button", { name: "Yes, Delete" }).click();
      await expect(page.getByRole("combobox").first()).toContainText("FINOS (default)");
    } else {
      await page.keyboard.press("Escape");
    }
  });
});

test("the editor opens on the FINOS theme and previews a change in the app", async ({
  page,
}) => {
  await openEditor(page);

  await expect(page.getByRole("combobox").first()).toContainText("FINOS (default)");
  await expect(brandInput(page)).toHaveValue(FINOS_BRAND);
  expect(await brand(page)).toBe(FINOS_BRAND);

  await brandInput(page).fill(BRAND);

  await expect.poll(() => brand(page)).toBe(BRAND);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
});

test("Revert returns the editor and the app to the saved values", async ({ page }) => {
  await openEditor(page);
  await brandInput(page).fill(BRAND);
  await expect.poll(() => brand(page)).toBe(BRAND);

  await page.getByRole("button", { name: "Revert" }).click();

  await expect(brandInput(page)).toHaveValue(FINOS_BRAND);
  await expect.poll(() => brand(page)).toBe(FINOS_BRAND);
  await expect(page.getByText("Unsaved changes")).toBeHidden();
});

test("a preset is saved, applied to everyone, and still applied after a reload", async ({
  page,
}) => {
  await openEditor(page);
  await brandInput(page).fill(BRAND);
  await saveAs(page, NAME);

  await expect(page.getByRole("combobox").first()).toContainText(NAME);
  await expect(page.getByText("Unsaved changes")).toBeHidden();
  await page.getByRole("button", { name: "Apply to everyone" }).click();
  await expect(page.getByText("Applied to everyone")).toBeVisible();

  await page.goto("/app");
  await expect.poll(() => brand(page)).toBe(BRAND);
  await page.reload();
  await expect.poll(() => brand(page)).toBe(BRAND);
});

test("going to another preset previews it, and the applied one returns when the editor closes", async ({
  page,
}) => {
  await openEditor(page);
  await expect(page.getByRole("combobox").first()).toContainText(NAME);
  await expect.poll(() => brand(page)).toBe(BRAND);

  await choose(page, "FINOS (default)");

  await expect(brandInput(page)).toHaveValue(FINOS_BRAND);
  await expect.poll(() => brand(page)).toBe(FINOS_BRAND);

  await page.getByRole("tab", { name: "Grouping" }).click();
  await expect.poll(() => brand(page)).toBe(BRAND);
});

test("unsaved changes are kept until they are discarded", async ({ page }) => {
  await openEditor(page);
  await brandInput(page).fill(OTHER_BRAND);

  await choose(page, "FINOS (default)");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Discard unsaved changes")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(brandInput(page)).toHaveValue(OTHER_BRAND);

  await choose(page, "FINOS (default)");
  await page.getByRole("dialog").getByRole("button", { name: "Discard" }).click();
  await expect(brandInput(page)).toHaveValue(FINOS_BRAND);
});

test("Save keeps the edits of the dark theme apart from the light theme", async ({
  page,
}) => {
  await openEditor(page);
  await expect(page.getByRole("combobox").first()).toContainText(NAME);

  await page.getByRole("tab", { name: "Dark Mode" }).click();
  await expect(brandInput(page)).toHaveValue(BRAND);
  await brandInput(page).fill(OTHER_BRAND);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Unsaved changes")).toBeHidden();

  await page.goto("/app");
  await expect.poll(() => brand(page)).toBe(OTHER_BRAND);
  await openEditor(page);
  await expect.poll(() => brand(page)).toBe(BRAND);
});

test("deleting the applied preset returns everyone to the FINOS theme", async ({
  page,
}) => {
  await openEditor(page);
  await expect(page.getByRole("combobox").first()).toContainText(NAME);

  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes, Delete" }).click();

  await expect(page.getByRole("combobox").first()).toContainText("FINOS (default)");
  await page.goto("/app");
  await expect.poll(() => brand(page)).toBe(FINOS_BRAND);
});
