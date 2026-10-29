import type { Server } from "node:https";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { type ReceivedRequest, startEchoBackend } from "./echoBackend";
import { authFile, deleteDashboard } from "./helpers";
import { type ApiResponse, type PageApi, pageApi } from "./plugins/api";

const API_URL = process.env.E2E_API_URL ?? "https://localhost:8000";
const BACKEND_PORT = Number(process.env.E2E_ECHO_BACKEND_PORT ?? 7791);
const WIDGET = "E2E team report";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let api: PageApi;
let backend: Server;
let received: ReceivedRequest[];
let sourceUuid: string;
let dashboardId: string;

const card = () => page.locator("div.group\\/widget").filter({ hasText: WIDGET });

async function json(response: ApiResponse) {
  expect(response.ok(), `${response.url()}: ${response.status()}`).toBe(true);
  return response.json();
}

async function arrived(match: (r: ReceivedRequest) => boolean) {
  await expect.poll(() => received.some(match), { timeout: 20000 }).toBe(true);
  return received.find(match) as ReceivedRequest;
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const baseURL = testInfo.project.use.baseURL ?? "https://localhost:3000";
  ({ server: backend, received } = await startEchoBackend(
    BACKEND_PORT,
    new URL(baseURL).origin,
  ));

  context = await browser.newContext({ storageState: authFile, baseURL });
  page = await context.newPage();
  await page.goto("/app");
  api = await pageApi(context, API_URL);
  sourceUuid = crypto.randomUUID();
  await json(
    await api.post(`/app/data-connectors/api-source/${sourceUuid}`, {
      data: { name: "E2E request mapping", url: `https://localhost:${BACKEND_PORT}` },
    }),
  );

  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  await page.locator("#tabs").getByRole("button").first().click();
  await page.getByRole("button", { name: /New Dashboard/ }).click();
  await page.waitForURL(/\/app\/[a-f0-9-]+/, { timeout: 10000 });
  dashboardId = new URL(page.url()).pathname.split("/").pop() ?? "";

  await page.getByRole("button", { name: "Add widgets" }).click();
  const menu = page.getByRole("dialog");
  await menu.getByPlaceholder("Search for widgets").fill(WIDGET);
  await menu.getByText(WIDGET, { exact: true }).first().click();
  await menu.getByRole("button", { name: "Add widgets" }).click();
  await expect(menu).toBeHidden();
});

test.afterAll(async () => {
  if (page && dashboardId) await deleteDashboard(page, dashboardId);
  if (api && sourceUuid)
    await api.delete(`/app/data-connectors/api-source/${sourceUuid}`);
  await api?.dispose();
  await context?.close();
  backend?.close();
});

test("widget-request-goes-where-its-params-say", async () => {
  const request = await arrived(
    (r) => r.method === "POST" && r.path === "/teams/platform/report",
  );
  const query = new URLSearchParams(request.query);
  expect([...query.keys()]).toEqual(["period", "theme"]);
  expect(query.get("period")).toBe("month");
  expect(["dark", "light"]).toContain(query.get("theme"));
  expect(request.headers["x-region"]).toBe("eu");
  expect(request.headers["content-type"]).toBe("application/json");
  expect(JSON.parse(request.body)).toEqual({ filters: "active" });

  const preflight = await arrived(
    (r) => r.method === "OPTIONS" && r.path === "/teams/platform/report",
  );
  expect(preflight.headers["access-control-request-method"]).toBe("POST");
  expect(
    preflight.headers["access-control-request-headers"]?.split(",").sort(),
  ).toEqual(["content-type", "x-region"]);

  await expect(card().getByText("/teams/platform/report")).toBeVisible();
});

test("option-lookup-posts-its-params", async () => {
  const lookup = await arrived(
    (r) => r.method === "POST" && r.path === "/teams/search",
  );
  expect(lookup.query).toBe("");
  expect(lookup.headers["content-type"]).toBe("application/json");
  expect(JSON.parse(lookup.body)).toEqual({ active: true, region: "eu" });
});

test("path-value-is-one-encoded-segment", async () => {
  await card().getByText("Platform", { exact: true }).click();
  await page.getByText("Data / Science", { exact: true }).click();
  const request = await arrived(
    (r) => r.method === "POST" && r.path === "/teams/data%2Fscience/report",
  );
  expect(JSON.parse(request.body)).toEqual({ filters: "active" });
  await expect(card().getByText("/teams/data%2Fscience/report")).toBeVisible();
});
