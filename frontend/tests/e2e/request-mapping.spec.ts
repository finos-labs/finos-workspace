import type { Server } from "node:http";
import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { type ReceivedRequest, startEchoBackend } from "./echoBackend";
import { authFile, deleteDashboard } from "./helpers";

/**
 * The request mapping of `widgets.json` (docs/widget-plugins/WIDGETS-JSON.md 4) on the
 * full stack: a widget's request and its option lookup reach a backend with the method,
 * path, query, headers and body its definition declares.
 */

const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";
const BACKEND_PORT = Number(process.env.E2E_ECHO_BACKEND_PORT ?? 7791);
const WIDGET = "E2E team report";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let backend: Server;
let received: ReceivedRequest[];
let sourceUuid: string;
let dashboardId: string;

const card = () => page.locator("div.group\\/widget").filter({ hasText: WIDGET });

async function json(response: Awaited<ReturnType<APIRequestContext["get"]>>) {
  expect(response.ok(), `${response.url()}: ${response.status()}`).toBe(true);
  return response.json();
}

/** The first request the backend received that matches, once it has arrived. */
async function arrived(match: (r: ReceivedRequest) => boolean) {
  await expect.poll(() => received.some(match), { timeout: 20000 }).toBe(true);
  return received.find(match) as ReceivedRequest;
}

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  test.setTimeout(120000);
  const baseURL = testInfo.project.use.baseURL ?? "http://localhost:3000";
  ({ server: backend, received } = await startEchoBackend(
    BACKEND_PORT,
    new URL(baseURL).origin,
  ));

  context = await browser.newContext({ storageState: authFile, baseURL });
  page = await context.newPage();
  await page.goto("/app");
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem("auth-storage") ?? "{}")?.state?.user?.token,
  );
  expect(token, "signed in").toBeTruthy();
  api = await playwright.request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  sourceUuid = crypto.randomUUID();
  await json(
    await api.post(`/app/data-connectors/api-source/${sourceUuid}`, {
      data: { name: "E2E request mapping", url: `http://localhost:${BACKEND_PORT}` },
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
  // The path param is in the path only; the query param and the host's theme in the query
  const query = new URLSearchParams(request.query);
  expect([...query.keys()]).toEqual(["period", "theme"]);
  expect(query.get("period")).toBe("month");
  expect(["dark", "light"]).toContain(query.get("theme"));
  // The header param as a header, the body param as a JSON body
  expect(request.headers["x-region"]).toBe("eu");
  expect(request.headers["content-type"]).toBe("application/json");
  expect(JSON.parse(request.body)).toEqual({ filters: "active" });

  // The browser asked first, for the method and the headers the request carries
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
  // `$X-Region` took the value of the widget's param
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
