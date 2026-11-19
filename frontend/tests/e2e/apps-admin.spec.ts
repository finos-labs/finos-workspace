import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { authFile, userInfo } from "./helpers";
import { type PageApi, pageApi } from "./plugins/api";

const API_URL = process.env.E2E_API_URL ?? "https://localhost:8000";
const ID = crypto.randomUUID().slice(0, 8);
const USER_APP = `E2E user app ${ID}`;
const ORG_APP = `E2E org app ${ID}`;
const USER_APP_UUID = crypto.randomUUID();

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let api: PageApi;
let orgEntity: string;

const row = (name: string) => page.getByRole("row").filter({ hasText: name });

async function openApps(name = USER_APP) {
  await page.goto("/admin/apps");
  await expect(row(name)).toBeVisible();
}

async function act(name: string, action: string) {
  await row(name).hover();
  await row(name).getByRole("button", { name: action }).click();
}

async function ownApps(): Promise<string[]> {
  const user = await (await api.get("/app/user")).json();
  return user.api_sources.map((source: { name: string }) => source.name);
}

async function adminApp(name: string) {
  const apps = await (await api.get("/admin/apps")).json();
  return apps.find((app: { name: string }) => app.name === name);
}

test.beforeAll(async ({ browser }, testInfo) => {
  context = await browser.newContext({
    storageState: authFile,
    baseURL: testInfo.project.use.baseURL,
  });
  page = await context.newPage();
  await page.goto("/app");
  api = await pageApi(context, API_URL);

  const ownEntity = (await (await api.get("/app/user")).json()).entity_info.entity_name;
  const { items } = await (await api.get("/entity/entity?size=100")).json();
  orgEntity = items.find((item: { name: string }) => item.name === ownEntity).uuid;

  const created = await api.post(`/app/data-connectors/api-source/${USER_APP_UUID}`, {
    data: {
      name: USER_APP,
      url: "https://user-backend.e2e.example.com",
      endpointHeaders: [],
    },
  });
  expect(created.ok(), `user backend: ${created.status()}`).toBe(true);
  const added = await api.post(`/entity/data-backends/${orgEntity}`, {
    data: {
      name: ORG_APP,
      url: "https://org-backend.e2e.example.com",
      endpointHeaders: [],
    },
  });
  expect(added.ok(), `organization backend: ${added.status()}`).toBe(true);
});

test.afterAll(async () => {
  await api?.delete(`/app/data-connectors/api-source/${USER_APP_UUID}`);
  if (orgEntity)
    await api?.delete(
      `/entity/data-backends/${orgEntity}/${encodeURIComponent(ORG_APP)}`,
    );
  await api?.dispose();
  await context?.close();
});

test("App Management lists a user's backend with its owner and an organization backend as the Organization", async () => {
  await openApps();

  await expect(row(USER_APP)).toContainText(userInfo().email);
  await expect(row(USER_APP)).toContainText("Enabled");
  await expect(row(ORG_APP)).toContainText("Organization");
  await expect(row(ORG_APP)).toContainText("Enabled");
});

test("Disable app takes a user's backend from the web app and Enable app gives it back", async () => {
  await openApps();
  expect(await ownApps()).toContain(USER_APP);

  await act(USER_APP, "Disable app");
  await expect(page.getByText("App disabled").first()).toBeVisible();
  await expect(row(USER_APP)).toContainText("Disabled");
  expect(await ownApps()).not.toContain(USER_APP);

  await act(USER_APP, "Enable app");
  await expect(page.getByText("App enabled").first()).toBeVisible();
  await expect(row(USER_APP)).toContainText("Enabled");
  expect(await ownApps()).toContain(USER_APP);
});

test("an organization backend is disabled and enabled in App Management", async () => {
  await openApps();
  expect(await adminApp(ORG_APP)).toMatchObject({ enabled: true, user_uuid: null });

  await act(ORG_APP, "Disable app");
  await expect(row(ORG_APP)).toContainText("Disabled");
  expect(await adminApp(ORG_APP)).toMatchObject({ enabled: false });

  await act(ORG_APP, "Enable app");
  await expect(row(ORG_APP)).toContainText("Enabled");
  expect(await adminApp(ORG_APP)).toMatchObject({ enabled: true });
});

test("Remove app deletes a user's backend only after it is confirmed", async () => {
  await openApps();

  await act(USER_APP, "Remove app");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(row(USER_APP)).toBeVisible();

  await act(USER_APP, "Remove app");
  await page.getByRole("button", { name: "Yes, Remove" }).click();
  await expect(page.getByText("App removed").first()).toBeVisible();
  await expect(row(USER_APP)).toHaveCount(0);
  expect(await ownApps()).not.toContain(USER_APP);
});

test("Remove app deletes an organization backend", async () => {
  await openApps(ORG_APP);

  await act(ORG_APP, "Remove app");
  await expect(page.getByText(/added for the organization/)).toBeVisible();
  await page.getByRole("button", { name: "Yes, Remove" }).click();

  await expect(page.getByText("App removed").first()).toBeVisible();
  await expect(row(ORG_APP)).toHaveCount(0);
  expect(await adminApp(ORG_APP)).toBeUndefined();
  const backends = await (await api.get(`/entity/data-backends/${orgEntity}`)).json();
  expect(backends.map((backend: { name: string }) => backend.name)).not.toContain(
    ORG_APP,
  );
});
