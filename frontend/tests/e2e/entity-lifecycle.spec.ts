import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import { addUser, authFile, deleteUser, setPassword, submitLogin } from "./helpers";
import { type PageApi, pageApi } from "./plugins/api";

const API_URL = process.env.E2E_API_URL ?? "https://localhost:8000";
const SIGNED_OUT = { cookies: [], origins: [] };
const ID = crypto.randomUUID().slice(0, 8);
const ENTITY = `E2E org ${ID}`;
const MEMBER_EMAIL = `e2e-org-member-${ID}@example.com`;
const MEMBER_PASSWORD = `E2e-${ID}!1A`;

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let api: PageApi;
let ownEntity: string;
let memberAdded = false;
let memberContext: BrowserContext | undefined;
let memberPage: Page;

const row = (name: string) => page.getByRole("row").filter({ hasText: name });

async function openEntities() {
  await page.goto("/admin/entities");
  await expect(row(ENTITY)).toBeVisible();
}

async function editEntity(name: string) {
  await row(name).hover();
  await row(name).getByRole("button", { name: "Edit entity" }).click();
  return page.getByRole("dialog");
}

async function signInMember(on: Page, expected: Locator) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await submitLogin(on, MEMBER_EMAIL, MEMBER_PASSWORD);
    const limited = on.getByText("Too many requests");
    await expect(expected.or(limited)).toBeVisible({ timeout: 30000 });
    if (!(await limited.isVisible())) return;
    await on.waitForTimeout(15000);
  }
  throw new Error("The sign-in was rate limited six times");
}

async function moveMember(entity: string) {
  await page.goto("/admin/entities?tab=users");
  await page.getByPlaceholder("Search for users").fill(MEMBER_EMAIL);
  const memberRow = row(MEMBER_EMAIL);
  await expect(memberRow).toBeVisible();
  await memberRow.hover();
  await memberRow.getByRole("button", { name: "Move user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").nth(0).click();
  await page.getByRole("option", { name: entity, exact: true }).click();
  await dialog.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "User", exact: true }).click();
  await dialog.getByRole("button", { name: "Move" }).click();
  await expect(dialog).toBeHidden();
  await expect(row(MEMBER_EMAIL)).toContainText(entity);
}

async function entityUuid(name: string, removed = false) {
  const answer = await api.get(
    `/entity/entity?size=100${removed ? "&removed=true" : ""}`,
  );
  const { items } = await answer.json();
  return items.find((item: { name: string }) => item.name === name)?.uuid as
    | string
    | undefined;
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(180000);
  const baseURL = testInfo.project.use.baseURL;
  context = await browser.newContext({ storageState: authFile, baseURL });
  page = await context.newPage();
  await page.goto("/app");
  api = await pageApi(context, API_URL);
  ownEntity = (await (await api.get("/app/user")).json()).entity_info.entity_name;

  await page.goto("/admin/entities");
  await page.getByRole("button", { name: "Add entity" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(ENTITY);
  await dialog.getByLabel("Admin first name").fill("E2E");
  await dialog.getByLabel("Admin last name").fill("Owner");
  await dialog.getByLabel("Admin email").fill(`e2e-org-owner-${ID}@example.com`);
  await dialog.getByRole("button", { name: "Add entity" }).click();
  await expect(row(ENTITY)).toBeVisible();

  const link = await addUser(page, MEMBER_EMAIL, "Member");
  memberAdded = true;
  const member = await browser.newContext({ storageState: SIGNED_OUT, baseURL });
  try {
    const memberPage = await member.newPage();
    await setPassword(memberPage, link, MEMBER_PASSWORD);
    await expect(
      memberPage.getByText("Your password is set. Sign in with it."),
    ).toBeVisible();
  } finally {
    await member.close();
  }
  await moveMember(ENTITY);
});

test.afterAll(async () => {
  if (memberAdded) {
    await moveMember(ownEntity).catch(() => undefined);
    await deleteUser(page, MEMBER_EMAIL).catch(() => undefined);
  }
  const leftover = await entityUuid(ENTITY).catch(() => undefined);
  if (leftover) await api.delete(`/entity/entity/${leftover}`);
  await api?.dispose();
  await memberContext?.close();
  await context?.close();
});

test("an entity with a superuser cannot be disabled", async () => {
  await page.goto("/admin/entities");
  const dialog = await editEntity(ownEntity);

  await dialog.getByRole("switch", { name: "Disabled" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(
    page.getByText("Cannot disable an entity that has a superuser").first(),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(row(ownEntity)).toContainText("Active");
});

test("a disabled entity refuses its users' sign-in", async ({ browser }, testInfo) => {
  test.setTimeout(240000);
  await openEntities();
  await expect(row(ENTITY)).toContainText("Active");
  const dialog = await editEntity(ENTITY);
  await dialog.getByRole("switch", { name: "Disabled" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Entity updated").first()).toBeVisible();
  await expect(row(ENTITY)).toContainText("Disabled");

  const refused = await browser.newContext({
    storageState: SIGNED_OUT,
    baseURL: testInfo.project.use.baseURL,
  });
  try {
    const member = await refused.newPage();
    const message = member.getByText("Your organization is disabled");
    await signInMember(member, message);
    await expect(message).toBeVisible();
  } finally {
    await refused.close();
  }
});

test("enabling the entity lets its users sign in again", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240000);
  await openEntities();
  const dialog = await editEntity(ENTITY);
  await dialog.getByRole("switch", { name: "Disabled" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(row(ENTITY)).toContainText("Active");

  memberContext = await browser.newContext({
    storageState: SIGNED_OUT,
    baseURL: testInfo.project.use.baseURL,
  });
  memberPage = await memberContext.newPage();
  await signInMember(memberPage, memberPage.locator("#tabs"));
  await expect(memberPage.locator("#tabs")).toBeVisible();
});

test("disabling the entity ends the sessions that its users have open", async () => {
  await openEntities();
  const dialog = await editEntity(ENTITY);
  await dialog.getByRole("switch", { name: "Disabled" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(row(ENTITY)).toContainText("Disabled");

  await memberPage.goto("/app");
  await expect(memberPage).toHaveURL(/\/login/);

  const again = await editEntity(ENTITY);
  await again.getByRole("switch", { name: "Disabled" }).click();
  await again.getByRole("button", { name: "Save" }).click();
  await expect(row(ENTITY)).toContainText("Active");
});

test("an entity with users is not removed", async () => {
  await openEntities();

  await row(ENTITY).hover();
  await row(ENTITY).getByRole("button", { name: "Remove entity" }).click();
  await page.getByRole("button", { name: "Yes, Remove" }).click();

  await expect(
    page.getByText("Cannot delete entity with existing users").first(),
  ).toBeVisible();
  await expect(row(ENTITY)).toBeVisible();
});

test("a removed entity is listed as removed and restored with its name", async () => {
  await moveMember(ownEntity);
  await openEntities();

  await row(ENTITY).hover();
  await row(ENTITY).getByRole("button", { name: "Remove entity" }).click();
  await page.getByRole("button", { name: "Yes, Remove" }).click();
  await expect(page.getByText("Entity removed").first()).toBeVisible();
  await expect(row(ENTITY)).toHaveCount(0);

  await page.getByRole("switch", { name: "Show removed" }).click();
  await expect(row(ENTITY)).toContainText("Removed");
  await row(ENTITY).hover();
  await row(ENTITY).getByRole("button", { name: "Restore entity" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(ENTITY);
  await dialog.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Entity restored").first()).toBeVisible();

  await page.getByRole("switch", { name: "Show removed" }).click();
  await expect(row(ENTITY)).toContainText("Active");
});
