import type { Server } from "node:https";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { authFile, deleteDashboard, userInfo } from "./helpers";
import { type ApiResponse, grantPlugins, type PageApi, pageApi } from "./plugins/api";
import {
  QUOTES_ENTRY,
  quotesManifest,
  startProxyUpstream,
  type UpstreamRequest,
  writePackage,
} from "./plugins/fixtures";

const PLUGINS_DIR = process.env.E2E_PLUGINS_DIR;
const TLS_DIR = process.env.E2E_PROXY_TLS_DIR;
const API_URL = process.env.E2E_API_URL ?? "https://localhost:8000";
const HOST = process.env.E2E_PROXY_HOST ?? "proxy-upstream.e2e.test";
const PORT = Number(process.env.E2E_PROXY_PORT ?? 7792);
const LISTEN = process.env.E2E_PROXY_LISTEN ?? "127.0.0.1";
const ORIGIN = `https://${HOST}:${PORT}`;
const PLUGIN = "e2e-quotes";
const SECRET = `e2e-${crypto.randomUUID()}`;

test.describe.configure({ mode: "serial" });
test.skip(
  !(PLUGINS_DIR && TLS_DIR),
  "E2E_PLUGINS_DIR and E2E_PROXY_TLS_DIR set up the API's plugins and the upstream",
);

let context: BrowserContext;
let page: Page;
let api: PageApi;
let roleUuid: string | undefined;
let upstream: Server;
let received: UpstreamRequest[];
let version: string;
let dashboardId: string;
const proxyAnswers: string[] = [];

const quoteFrame = () => page.frameLocator('iframe[title^="E2E quote"]');

async function json(response: ApiResponse) {
  expect(response.ok(), `${response.url()}: ${response.status()}`).toBe(true);
  return response.json();
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const baseURL = testInfo.project.use.baseURL ?? "https://localhost:3000";
  version = writePackage(PLUGINS_DIR ?? "", quotesManifest(ORIGIN, PLUGIN), {
    "entry.js": QUOTES_ENTRY,
  });
  ({ server: upstream, received } = await startProxyUpstream(
    PORT,
    LISTEN,
    TLS_DIR ?? "",
    () => SECRET,
  ));

  context = await browser.newContext({ storageState: authFile, baseURL });
  page = await context.newPage();
  page.on("response", async (response) => {
    if (response.url().includes(`/app/widget-plugins/${PLUGIN}/proxy/`))
      proxyAnswers.push(await response.text().catch(() => ""));
  });
  await page.goto("/app");
  api = await pageApi(context, API_URL);
});

test.afterAll(async () => {
  if (page && dashboardId) await deleteDashboard(page, dashboardId);
  if (api) {
    await api.post(`/plugins/${PLUGIN}/restore`);
    await api.delete(`/plugins/${PLUGIN}/secrets/api_key`);
    await api.put(`/plugins/${PLUGIN}/overrides`, {
      data: { csp: null, server_network: null, confirmations: [] },
    });
    await api.put(`/admin/plugins/${PLUGIN}`, {
      data: { enabled: false },
    });
    if (roleUuid) await api.delete(`/admin/role/${roleUuid}`);
  }
  await api?.dispose();
  await context?.close();
  upstream?.close();
});

test("superuser-reviews-the-server-side-and-sets-the-secret", async () => {
  await json(await api.post("/plugins/rescan"));
  const listing = await json(await api.get("/plugins"));
  const plugin = listing.plugins.find(
    (p: { plugin_id: string }) => p.plugin_id === PLUGIN,
  );
  const entry = plugin.versions.find((v: { version: string }) => v.version === version);
  if (entry.state === "discovered") {
    const keys = entry.review.map((item: { key: string }) => item.key);
    expect(keys).toEqual(
      expect.arrayContaining([`server:${ORIGIN}`, "proxy:quote", "secret:api_key"]),
    );
    await json(
      await api.post(`/plugins/${PLUGIN}/versions/${version}/approve`, {
        data: {
          digest: entry.digest,
          acknowledged: entry.review
            .filter((item: { added: boolean }) => item.added)
            .map((item: { key: string }) => item.key),
        },
      }),
    );
  }
  await json(
    await api.put(`/admin/plugins/${PLUGIN}`, {
      data: { enabled: true },
    }),
  );
  roleUuid = await grantPlugins(api, userInfo().email, "E2E proxies", [PLUGIN]);

  await page.goto("/admin/widgets");
  await page.getByRole("tab", { name: "Deployment" }).click();
  await page
    .getByTestId("platform-plugins")
    .getByRole("row")
    .filter({ hasText: PLUGIN })
    .click();
  const detail = page.getByTestId(`plugin-detail-${PLUGIN}`);

  const secret = detail.getByTestId("plugin-secret-api_key");
  await expect(secret.getByText("not set")).toBeVisible();
  await secret.getByLabel("New value of api_key").fill(SECRET);
  await secret.getByRole("button", { name: "Set" }).click();
  await expect(secret.getByText("set", { exact: true })).toBeVisible();
  await expect(secret.getByLabel("New value of api_key")).toHaveValue("");
  expect(await page.content()).not.toContain(SECRET);
  expect(await (await api.get(`/plugins/${PLUGIN}`)).text()).not.toContain(SECRET);

  await detail.getByRole("checkbox", { name: "server network" }).click();
  await expect(detail.getByLabel("server network hosts")).toHaveValue(ORIGIN);
  await detail.getByRole("checkbox", { name: /resolve to private addresses/ }).click();
  await detail.getByRole("button", { name: "Save overrides" }).click();
  await expect
    .poll(async () => (await json(await api.get(`/plugins/${PLUGIN}`))).overrides)
    .toEqual({ server_network: [ORIGIN], confirmations: ["private-host"] });
});

test("plugin-calls-its-proxy-and-never-holds-the-secret", async () => {
  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  await page.locator("#tabs").getByRole("button").first().click();
  await page.getByRole("button", { name: /New Dashboard/ }).click();
  await page.waitForURL(/\/app\/[a-f0-9-]+/, { timeout: 10000 });
  dashboardId = new URL(page.url()).pathname.split("/").pop() ?? "";
  await page.getByRole("button", { name: "Add widgets" }).click();
  const menu = page.getByRole("dialog");
  await menu.getByPlaceholder("Search for widgets").fill("E2E quote");
  await menu.getByText("E2E quote", { exact: true }).first().click();
  await menu.getByRole("button", { name: "Add widgets" }).click();
  await expect(menu).toBeHidden();

  const results = quoteFrame().locator("#e2e-proxy-results");
  await expect(results).toBeVisible({ timeout: 30000 });
  const outcome = JSON.parse((await results.textContent()) ?? "{}");
  const quote = { symbol: "IBM", price: 101.5 };
  expect(outcome).toEqual({
    quote,
    undeclared: "refused:out_of_scope",
    "own-url": quote,
    "extra-arg": "refused:invalid_args",
  });

  expect(received.map((r) => r.path)).toEqual(["/quotes/IBM", "/quotes/IBM"]);
  for (const request of received)
    expect(request.authorization).toBe(`Bearer ${SECRET}`);
  expect(await quoteFrame().locator("html").innerHTML()).not.toContain(SECRET);
  expect(proxyAnswers.length).toBeGreaterThanOrEqual(3);
  for (const answer of proxyAnswers) expect(answer).not.toContain(SECRET);
});

test("revoking-the-plugin-stops-its-calls", async () => {
  await json(await api.post(`/plugins/${PLUGIN}/revoke`));
  const before = received.length;
  await page.reload();
  await expect(
    page
      .locator("div.group\\/widget")
      .filter({ hasText: "E2E quote" })
      .getByText("This widget type is not available to you"),
  ).toBeVisible({ timeout: 30000 });
  expect(received.length).toBe(before);
  await json(await api.post(`/plugins/${PLUGIN}/restore`));
});
