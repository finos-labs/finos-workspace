import type { Server } from "node:http";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { authFile, deleteDashboard, userInfo } from "./helpers";
import { type ApiResponse, grantPlugins, type PageApi, pageApi } from "./plugins/api";
import {
  type BackendRequest,
  FORECAST_ENTRY,
  forecastManifest,
  startDataSource,
  startPluginBackend,
  versionDigest,
  writePackage,
} from "./plugins/fixtures";

const PLUGINS_DIR = process.env.E2E_PLUGINS_DIR;
const API_URL = process.env.E2E_API_URL ?? "https://localhost:8000";
const HOST = process.env.E2E_BACKEND_HOST ?? "plugin-backend.e2e.test";
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 7794);
const DATA_PORT = Number(process.env.E2E_DATA_PORT ?? 7795);
const LISTEN = process.env.E2E_BACKEND_LISTEN ?? "127.0.0.1";
const PLUGIN = "e2e-forecast";
const SOURCE = `E2E sales ${Math.random().toString(36).slice(2, 8)}`;
const MODEL_KEY = `model-${crypto.randomUUID()}`;
const DATA_KEY = `data-${crypto.randomUUID()}`;

test.describe.configure({ mode: "serial" });
test.skip(
  !(PLUGINS_DIR && process.env.E2E_BACKENDS),
  "E2E_PLUGINS_DIR and E2E_BACKENDS: the API lists this machine's backend",
);

let context: BrowserContext;
let page: Page;
let api: PageApi;
let roleUuid: string | undefined;
let backend: Server;
let backendReceived: BackendRequest[];
let data: Server;
let dataReceived: BackendRequest[];
let identity: Record<string, unknown> = {};
let entityUuid: string;
let dashboardId: string;

const frame = () => page.frameLocator('iframe[title^="E2E forecast"]');

async function json(response: ApiResponse) {
  expect(response.ok(), `${response.url()}: ${response.status()}`).toBe(true);
  return response.json();
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const baseURL = testInfo.project.use.baseURL ?? "https://localhost:3000";
  const version = writePackage(PLUGINS_DIR ?? "", forecastManifest(PLUGIN), {
    "entry.js": FORECAST_ENTRY,
  });
  identity = {
    plugin: PLUGIN,
    version,
    digest: versionDigest(PLUGINS_DIR ?? "", PLUGIN, version),
    protocol: 1,
  };
  ({ server: backend, received: backendReceived } = await startPluginBackend({
    port: BACKEND_PORT,
    listen: LISTEN,
    apiUrl: API_URL,
    origin: new URL(baseURL).origin,
    identity: () => identity,
    secret: () => MODEL_KEY,
  }));
  ({ server: data, received: dataReceived } = await startDataSource(
    DATA_PORT,
    LISTEN,
    () => DATA_KEY,
  ));

  context = await browser.newContext({ storageState: authFile, baseURL });
  page = await context.newPage();
  await page.goto("/app");
  api = await pageApi(context, API_URL);

  await json(await api.post("/plugins/rescan"));
  const plugin = await json(await api.get(`/plugins/${PLUGIN}`));
  const entry = plugin.versions.find((v: { version: string }) => v.version === version);
  if (entry.state === "discovered")
    await json(
      await api.post(`/plugins/${PLUGIN}/versions/${version}/approve`, {
        data: {
          digest: entry.digest,
          acknowledged: entry.review
            .filter((i: { added: boolean }) => i.added)
            .map((i: { key: string }) => i.key),
        },
      }),
    );
  await json(
    await api.put(`/plugins/${PLUGIN}/secrets/model_key`, {
      data: { value: MODEL_KEY },
    }),
  );

  await json(
    await api.put(`/admin/plugins/${PLUGIN}`, {
      data: { enabled: true },
    }),
  );
  roleUuid = await grantPlugins(api, userInfo().email, "E2E forecast", [PLUGIN]);
  entityUuid = (await json(await api.get(`/plugins/${PLUGIN}`))).entities.find(
    (e: { enabled: boolean }) => e.enabled,
  ).entity_uuid;
  await json(
    await api.post(`/entity/data-backends/${entityUuid}`, {
      data: {
        name: SOURCE,
        url: `http://${HOST}:${DATA_PORT}/api`,
        endpointHeaders: [{ key: "X-Api-Key", value: DATA_KEY, location: "headers" }],
      },
    }),
  );
  const backends = (await json(await api.get("/admin/plugins"))).backends as {
    uuid: string;
    name: string;
  }[];
  const source = backends.find((b) => b.name === SOURCE);
  await json(
    await api.put(`/admin/plugins/${PLUGIN}`, {
      data: { data_sources: { sales: source?.uuid } },
    }),
  );
});

test.afterAll(async () => {
  if (page && dashboardId) {
    await page.goto("/app");
    await deleteDashboard(page, dashboardId);
  }
  if (api) {
    if (roleUuid) await api.delete(`/admin/role/${roleUuid}`);
    await api.put(`/admin/plugins/${PLUGIN}`, {
      data: { enabled: false, data_sources: { sales: null } },
    });
    await api.delete(`/plugins/${PLUGIN}/secrets/model_key`);
    if (entityUuid)
      await api.delete(
        `/entity/data-backends/${entityUuid}/${encodeURIComponent(SOURCE)}`,
      );
  }
  await api?.dispose();
  await context?.close();
  backend?.close();
  data?.close();
});

test("the-api-checks-the-backend-is-the-approved-version", async () => {
  const status = await json(await api.post(`/plugins/${PLUGIN}/backend/check`));
  expect(status).toMatchObject({ registered: true, identity: { state: "ok" } });
});

test("a-route-reads-the-organizations-data-for-the-user", async () => {
  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  await page.locator("#tabs").getByRole("button").first().click();
  await page.getByRole("button", { name: /New Dashboard/ }).click();
  await page.waitForURL(/\/app\/[a-f0-9-]+/, { timeout: 10000 });
  dashboardId = new URL(page.url()).pathname.split("/").pop() ?? "";
  await page.getByRole("button", { name: "Add widgets" }).click();
  const menu = page.getByRole("dialog");
  await menu.getByPlaceholder("Search for widgets").fill("E2E forecast");
  await menu.getByText("E2E forecast", { exact: true }).first().click();
  await menu.getByRole("button", { name: "Add widgets" }).click();
  await expect(menu).toBeHidden();

  const results = frame().locator("#e2e-forecast");
  await expect(results).toBeVisible({ timeout: 30000 });
  expect(JSON.parse((await results.textContent()) ?? "{}")).toEqual({
    forecast: {
      region: "emea",
      rows: [{ region: "emea", sales: 10 }],
      caller: "pseudonymous",
      secret: true,
    },
    other: "refused:out_of_scope",
  });

  const read = dataReceived.find((r) => r.path.startsWith("/api/sales"));
  expect(read?.path).toBe("/api/sales?region=emea");
  expect(read?.headers["x-api-key"]).toBe(DATA_KEY);
  const call = backendReceived.find((r) => r.path === "/.workspace/routes/forecast");
  expect(JSON.stringify(call)).not.toContain(DATA_KEY);
  expect(String(call?.headers["x-workspace-call"])).toMatch(/^wpc1\./);
  expect(JSON.parse(call?.body ?? "{}").caller.id).not.toContain("@");
  const html = await frame().locator("html").innerHTML();
  expect(html).not.toContain(MODEL_KEY);
  expect(html).not.toContain(DATA_KEY);
});

test("another-version-of-the-backend-gets-no-calls", async () => {
  const good = identity;
  identity = { ...good, digest: `sha256-${"F".repeat(43)}` };
  const status = await json(await api.post(`/plugins/${PLUGIN}/backend/check`));
  expect(status.identity.state).toBe("mismatch");
  const before = backendReceived.filter((r) =>
    r.path.startsWith("/.workspace/routes/"),
  ).length;
  await page.reload();
  await expect(frame().locator("#e2e-forecast")).toContainText(
    '"forecast":"refused:unavailable"',
    { timeout: 30000 },
  );
  expect(
    backendReceived.filter((r) => r.path.startsWith("/.workspace/routes/")).length,
  ).toBe(before);
  const events = await json(await api.get(`/plugins/${PLUGIN}/events`));
  expect(events.map((e: { action: string }) => e.action)).toContain("backend-mismatch");

  identity = good;
  expect(
    (await json(await api.post(`/plugins/${PLUGIN}/backend/check`))).identity.state,
  ).toBe("ok");
});
