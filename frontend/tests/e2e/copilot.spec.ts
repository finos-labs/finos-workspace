import { expect, test } from "@playwright/test";

const STUB_ANSWER =
  "This answer came from the stubbed model that the end-to-end stack runs instead of a provider";

test.describe("the Copilot", () => {
  test.setTimeout(120_000);

  test("answers a question", async ({ page }) => {
    await page.goto("/");

    const question = page.getByPlaceholder("Ask a question", { exact: false });
    const opened = await question.waitFor({ state: "visible", timeout: 30_000 }).then(
      () => true,
      () => false,
    );
    if (!opened) await page.keyboard.press("ControlOrMeta+KeyL");
    await expect(question).toBeVisible({ timeout: 30_000 });
    await expect(question).toBeEnabled({ timeout: 30_000 });

    const answers = page.getByText(STUB_ANSWER, { exact: false });
    const before = await answers.count();

    await question.fill("Say hello");
    await question.press("Enter");

    await expect(page.getByText("Say hello").first()).toBeVisible({
      timeout: 30_000,
    });

    await expect
      .poll(() => answers.count(), {
        timeout: 90_000,
        message: "the Copilot never answered",
      })
      .toBeGreaterThan(before);
  });
});
