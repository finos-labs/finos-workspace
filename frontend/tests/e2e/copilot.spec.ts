import { expect, test } from "@playwright/test";

/**
 * A question put to the Copilot, from the chat to the model and back.
 *
 * The stack these run against answers with a stubbed model (`ines/tests/stub-model`, added by
 * `docker-compose.e2e.yml`), which says the same sentence to everything. So this does not test what
 * an answer says — nothing here could, and a test that tried would be asserting on a model. It tests
 * that an answer arrives at all, which is the whole path between the browser and the model: the web
 * app reaching Ines, Ines recognising the signed-in user, the Workspace allowing the question and
 * counting it, the agent loop, the text sink, the SSE protocol, and the chat rendering what came back.
 *
 * Without this the end-to-end suite can be green while the Copilot is completely broken: no other
 * test here asks it anything.
 */

/** What the stub answers. It has to match STUB_ANSWER in ines/tests/stub-model/server.ts. */
const STUB_ANSWER =
  "This answer came from the stubbed model that the end-to-end stack runs instead of a provider";

test.describe("the Copilot", () => {
  // A cold agent signs the user in with the Workspace, asks what their roles allow and counts the
  // question before it answers, so this is slower than the default per-test budget.
  test.setTimeout(120_000);

  test("answers a question", async ({ page }) => {
    await page.goto("/");

    // The panel is open by default; where it is not, this is the control that opens it.
    const question = page.getByPlaceholder("Ask a question", { exact: false });
    if (!(await question.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: /copilot/i }).first().click();
    }
    await expect(question).toBeVisible({ timeout: 30_000 });

    // The stub says the same thing to everything, so an answer already on screen — a chat this
    // account left open, or a retry of this test — would make "the answer is visible" true without
    // anything being asked. What is asserted is therefore that one MORE arrives.
    const answers = page.getByText(STUB_ANSWER, { exact: false });
    const before = await answers.count();

    await question.fill("Say hello");
    await question.press("Enter");

    // The question is in the chat as the user's message...
    await expect(page.getByText("Say hello").first()).toBeVisible({ timeout: 30_000 });

    // ...and an answer comes back that was not there before. The model is a stub but every other
    // step is the real one, and a cold agent signs the user in and asks the Workspace first.
    await expect
      .poll(() => answers.count(), { timeout: 90_000, message: "the Copilot never answered" })
      .toBeGreaterThan(before);
  });
});
