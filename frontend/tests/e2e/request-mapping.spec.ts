import type { Server } from "node:http";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { type ReceivedRequest, startEchoBackend } from "./echoBackend";
import { authFile, deleteDashboard, userInfo } from "./helpers";
import {
  type ApiResponse,
  createRole,
  grantBackend,
  type PageApi,
  pageApi,
} from "./plugins/api";

const API_URL = process.env.E2E_API_URL ?? "https://localhost:8000";
const BACKEND_PORT = Number(process.env.E2E_ECHO_BACKEND_PORT ?? 7791);
const BACKEND_HOST = process.env.E2E_ECHO_BACKEND_HOST ?? "host.docker.internal";
const BACKEND_LISTEN = process.env.E2E_ECHO_BACKEND_LISTEN ?? "0.0.0.0";
const SOURCE_NAME = "E2E request mapping";
const SOURCE_KEY = "e2e-source-key";
const WIDGET = "E2E team report";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let api: PageApi;
let roleUuid: string | undefined;
let backend: Server;
let received: ReceivedRequest[];
let entityUuid: string;
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
    BACKEND_LISTEN,
  ));

  context = await browser.newContext({ storageState: authFile, baseURL });
  page = await context.newPage();
  await page.goto("/app");
  api = await pageApi(context, API_URL);
  entityUuid = (await json(await api.get("/entity/entity"))).items[0].uuid;
  await json(
    await api.post(`/entity/data-backends/${entityUuid}`, {
      data: {
        name: SOURCE_NAME,
        url: `http://${BACKEND_HOST}:${BACKEND_PORT}`,
        endpointHeaders: [{ key: "X-Api-Key", value: SOURCE_KEY, location: "headers" }],
      },
    }),
  );
  roleUuid = await createRole(api, userInfo().email, SOURCE_NAME);
  await grantBackend(api, roleUuid, entityUuid, SOURCE_NAME);

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
  if (api && entityUuid)
    await api.delete(
      `/entity/data-backends/${entityUuid}/${encodeURIComponent(SOURCE_NAME)}`,
    );
  if (api && roleUuid) await api.delete(`/admin/role/${roleUuid}`);
  await api?.dispose();
  await context?.close();
  backend?.close();
});

test("browser-holds-no-credential-of-the-source", async () => {
  await arrived((r) => r.method === "POST" && r.path === "/teams/platform/report");
  const held = await page.evaluate(async () => {
    const stores = [localStorage, sessionStorage].flatMap((store) =>
      Object.keys(store).map((key) => `${key}=${store.getItem(key)}`),
    );
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(name as string);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const all = db.transaction(store).objectStore(store).getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        });
        stores.push(JSON.stringify(rows));
      }
    }
    return stores.join("\n");
  });
  expect(held).not.toContain("e2e-source-key");
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

  expect(request.headers["x-api-key"]).toBe(SOURCE_KEY);
  expect(request.headers["x-workspace-user"]).toContain("@");
  expect(received.some((r) => r.method === "OPTIONS")).toBe(false);

  await expect(card().getByText("/teams/platform/report")).toBeVisible();
});

test("option-lookup-posts-its-params", async () => {
  const lookup = await arrived(
    (r) => r.method === "POST" && r.path === "/teams/search",
  );
  expect(lookup.query).toBe("");
  expect(lookup.headers["content-type"]).toBe("application/json");
  expect(lookup.headers["x-api-key"]).toBe(SOURCE_KEY);
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
