import { expect, type Page, test } from "@playwright/test";
import { userInfo } from "./helpers";

/**
 * A question put to the Copilot, from the chat to the model and back.
 *
 * The stack these run against answers with a stubbed model (`agent/tests/stub-model`, added by
 * `docker-compose.e2e.yml`), which says the same sentence to everything. So this does not test what
 * an answer says — nothing here could, and a test that tried would be asserting on a model. It tests
 * that an answer arrives at all, which is the whole path between the browser and the model: the web
 * app reaching Ines, Ines recognising the signed-in user, the Workspace allowing the question and
 * counting it, the agent loop, the text sink, the SSE protocol, and the chat rendering what came back.
 *
 * A user may use only what one of their roles grants, and the account the tests sign in as has no
 * role in a fresh stack: no model, and a daily allowance of nothing, so the chat would not even take
 * the question. The test therefore gives it a role first, which grants the agent's models with no
 * daily limits (as a new role has none), and deletes that role when it is done.
 *
 * Without this the end-to-end suite can be green while the Copilot is completely broken: no other
 * test here asks it anything.
 */

/** What the stub answers. It has to match STUB_ANSWER in agent/tests/stub-model/server.ts. */
const STUB_ANSWER =
  "This answer came from the stubbed model that the end-to-end stack runs instead of a provider";

/** The id the Workspace files Ines's model grants under: AGENT_ID in agent/src/routes/agents.ts. */
const AGENT_ID = "default_agent";

/**
 * Calls the Workspace API from the signed-in page as the web app does: with its session cookie and
 * its client header, at the address the page is configured with (config.js).
 */
async function workspaceApi(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const { urls } = (
        window as unknown as { __APP_CONFIG__: { urls: { backend: string } } }
      ).__APP_CONFIG__;
      const response = await fetch(`${urls.backend}${path}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Workspace-Client": "web" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          `${method} ${path} answered ${response.status}: ${await response.text()}`,
        );
      }
      return response.json();
    },
    { method, path, body },
  );
}

/** The models Ines offers, as her agents.json lists them: the stack's DEFAULT_MODEL and INES_MODELS. */
async function agentModels(page: Page): Promise<string[]> {
  return page.evaluate(async (agentId) => {
    const { urls } = (window as unknown as { __APP_CONFIG__: { urls: { ai: string } } })
      .__APP_CONFIG__;
    const descriptor = await (await fetch(`${urls.ai}/agents.json`)).json();
    const options: { value: string }[] =
      descriptor[agentId]?.features?.model?.options ?? [];
    return options.map((option) => option.value);
  }, AGENT_ID);
}

/** Creates a role with the signed-in account as its only member and returns its id. */
async function createRole(page: Page, name: string): Promise<string> {
  await workspaceApi(page, "POST", "/admin/role", {
    name,
    description: "Made by copilot.spec.ts, which deletes it",
    users: [userInfo().email],
  });
  const roles = (await workspaceApi(page, "GET", "/admin/role")) as {
    uuid: string;
    name: string;
  }[];
  const role = roles.find((r) => r.name === name);
  if (!role) throw new Error(`The role ${name} is not in the organization's roles`);
  return role.uuid;
}

test.describe("the Copilot", () => {
  // A cold agent signs the user in with the Workspace, asks what their roles allow and counts the
  // question before it answers, so this is slower than the default per-test budget.
  test.setTimeout(120_000);

  test("answers a question", async ({ page }) => {
    await page.goto("/");

    const models = await agentModels(page);
    expect(
      models,
      "Ines offers no model: start the stack with docker-compose.e2e.yml",
    ).not.toEqual([]);
    const role = await createRole(
      page,
      `E2E Copilot ${crypto.randomUUID().slice(0, 8)}`,
    );

    try {
      await workspaceApi(page, "PUT", `/admin/role/${role}/copilot-access`, {
        models: models.map((model_id) => ({ agent_id: AGENT_ID, model_id })),
        mcp: [],
      });
      // The page read what the account may use when it loaded; this load reads the role's grant.
      await page.reload();

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
      // step is the real one, and a cold agent signs the user in and asks the Workspace first.
      await expect
        .poll(() => answers.count(), {
          timeout: 90_000,
          message: "the Copilot never answered",
        })
        .toBeGreaterThan(before);
    } finally {
      await workspaceApi(page, "DELETE", `/admin/role/${role}`);
    }
  });
});
