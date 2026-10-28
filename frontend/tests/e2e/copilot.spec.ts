import { expect, test } from "@playwright/test";

/**
 * A question put to the Copilot, from the chat to the model and back.
 *
 * The stack these run against answers with a stubbed model (`agent/tests/stub-model`, added by
 * `docker-compose.e2e.yml`), which says the same sentence to everything. So this does not test what
 * an answer says — nothing here could, and a test that tried would be asserting on a model. It tests
 * that an answer arrives at all, which is the whole path between the browser and the model: the web
 * app reaching Ines, Ines recognising the signed-in user, the FINOS Workspace allowing the question and
 * counting it, the agent loop, the text sink, the SSE protocol, and the chat rendering what came back.
 *
 * The account the tests sign in as is the administrator init creates, who gets the organization's
 * default roles: Agent User grants the agent with every model it offers and no daily limits. So
 * this also tests that a fresh stack's administrator can ask the agent with no setup.
 *
 * Without this the end-to-end suite can be green while the Copilot is completely broken: no other
 * test here asks it anything.
 */

/** What the stub answers. It has to match STUB_ANSWER in agent/tests/stub-model/server.ts. */
const STUB_ANSWER =
  "This answer came from the stubbed model that the end-to-end stack runs instead of a provider";

test.describe("the Copilot", () => {
  // A cold agent signs the user in with the FINOS Workspace, asks what their roles allow and counts the
  // question before it answers, so this is slower than the default per-test budget.
  test.setTimeout(120_000);

  test("answers a question", async ({ page }) => {
    await page.goto("/");

    // The panel is open by default, once the page has drawn it; where it is not, Toggle Agent
    // (⌘/Ctrl + L) opens it.
    const question = page.getByPlaceholder("Ask a question", { exact: false });
    const opened = await question.waitFor({ state: "visible", timeout: 30_000 }).then(
      () => true,
      () => false,
    );
    if (!opened) await page.keyboard.press("ControlOrMeta+KeyL");
    await expect(question).toBeVisible({ timeout: 30_000 });
    await expect(question).toBeEnabled({ timeout: 30_000 });

    // The stub says the same thing to everything, so an answer already on screen — a chat this
    // account left open, or a retry of this test — would make "the answer is visible" true without
    // anything being asked. What is asserted is therefore that one MORE arrives.
    const answers = page.getByText(STUB_ANSWER, { exact: false });
    const before = await answers.count();

    await question.fill("Say hello");
    await question.press("Enter");

    // The question is in the chat as the user's message...
    await expect(page.getByText("Say hello").first()).toBeVisible({
      timeout: 30_000,
    });

    // ...and an answer comes back that was not there before. The model is a stub but every other
    // step is the real one, and a cold agent signs the user in and asks the FINOS Workspace first.
    await expect
      .poll(() => answers.count(), {
        timeout: 90_000,
        message: "the Copilot never answered",
      })
      .toBeGreaterThan(before);
  });
});
