import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { authFile } from "./helpers";
import {
  HOSTILE_ENTRY,
  hostileManifest,
  startBackend,
  TABLE_ENTRY,
  tableManifest,
  writePackage,
} from "./plugins/fixtures";

/**
 * Widget plugins on the full stack (docs/widget-plugins/PLAN.md): a plugin approved at
 * the deployment and enabled for the entity renders a backend's widgets in a sandboxed
 * frame, and a hostile one cannot leave it (SECURITY.md 7).
 *
 * The API reads plugins from WIDGET_PLUGINS_DIR; E2E_PLUGINS_DIR names the same directory
 * on this machine, where the tests write their packages. Without it they are skipped.
 * The account the tests sign in as has to be a platform administrator.
 */

const PLUGINS_DIR = process.env.E2E_PLUGINS_DIR;
const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";
const BACKEND_PORT = Number(process.env.E2E_PLUGINS_BACKEND_PORT ?? 7790);
const BACKEND_NAME = "E2E plugin widgets";

test.describe.configure({ mode: "serial" });
test.skip(!PLUGINS_DIR, "E2E_PLUGINS_DIR names the API's plugins directory");

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let backend: Server;
let sourceUuid: string;
let dashboardId: string;
let versions: Record<string, string>;
let started: number;

const tableFrame = () => page.frameLocator('iframe[title^="E2E rows"]');
const probeFrame = () => page.frameLocator('iframe[title^="E2E probe"]');
const card = (title: string) =>
  page.locator("div.group\\/widget").filter({ hasText: title });

/** What the init script saw: frames that announced themselves, and toasts. */
async function seen(): Promise<{ boots: string[]; toasts: string[] }> {
  return page.evaluate(() => (window as unknown as { __e2e: never }).__e2e);
}

async function tableBoots() {
  return (await seen()).boots.filter((title) => title.startsWith("E2E rows")).length;
}

async function json(response: Awaited<ReturnType<APIRequestContext["get"]>>) {
  expect(response.ok(), `${response.url()}: ${response.status()}`).toBe(true);
  return response.json();
}

/** Approves the written version of each fixture and enables it for everyone. */
async function approveAndEnable() {
  await json(await api.post("/plugins/rescan"));
  const listing = await json(await api.get("/plugins"));
  for (const [id, version] of Object.entries(versions)) {
    const plugin = listing.plugins.find(
      (p: { plugin_id: string }) => p.plugin_id === id,
    );
    const entry = plugin?.versions.find(
      (v: { version: string }) => v.version === version,
    );
    expect(entry, `${id}@${version} was discovered`).toBeTruthy();
    if (entry.state === "discovered") {
      const acknowledged = entry.review
        .filter((item: { added: boolean }) => item.added)
        .map((item: { key: string }) => item.key);
      await json(
        await api.post(`/plugins/${id}/versions/${version}/approve`, {
          data: { digest: entry.digest, acknowledged },
        }),
      );
    } else {
      expect(entry.state).toBe("active");
    }
    await json(
      await api.put(`/admin/plugins/${id}`, {
        data: { enabled: true, access_mode: "everyone" },
      }),
    );
  }
}

async function addWidgets(names: string[]) {
  for (const name of names) {
    const empty = page.getByRole("button", { name: "Add widgets" });
    if (await empty.isVisible()) await empty.click();
    else await page.getByTestId("dashboard-toolbar-add-widget-button").click();
    const menu = page.getByRole("dialog");
    await menu.getByPlaceholder("Search for widgets").fill(name);
    await menu.getByText(name, { exact: true }).first().click();
    await menu.getByRole("button", { name: "Add widgets" }).click();
    await expect(menu).toBeHidden();
  }
}

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  test.setTimeout(120000);
  started = Date.now();
  const baseURL = testInfo.project.use.baseURL ?? "http://localhost:3000";
  versions = {
    "e2e-table": writePackage(PLUGINS_DIR ?? "", tableManifest(), {
      "entry.js": TABLE_ENTRY,
    }),
    "e2e-hostile": writePackage(PLUGINS_DIR ?? "", hostileManifest(), {
      "entry.js": HOSTILE_ENTRY,
    }),
  };
  backend = await startBackend(BACKEND_PORT, new URL(baseURL).origin);

  context = await browser.newContext({ storageState: authFile, baseURL });
  await context.addInitScript(() => {
    const state = { boots: [] as string[], toasts: [] as string[] };
    (window as unknown as { __e2e: typeof state }).__e2e = state;
    // A frame that announces itself is a frame (re)starting; its title names it
    window.addEventListener("message", (event) => {
      if (event.data?.type !== "ws-shell-ready") return;
      const frame = [...document.querySelectorAll("iframe")].find(
        (f) => f.contentWindow === event.source,
      );
      state.boots.push(frame?.title ?? "?");
    });
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof Element)
            for (const el of [node, ...node.querySelectorAll("[data-sonner-toast]")])
              if (el.matches("[data-sonner-toast]"))
                setTimeout(
                  () =>
                    state.toasts.push(
                      `${el.textContent}|img:${!!el.querySelector("img")}`,
                    ),
                  50,
                );
    }).observe(document, { subtree: true, childList: true });
  });
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

  await approveAndEnable();
  sourceUuid = crypto.randomUUID();
  await json(
    await api.post(`/app/data-connectors/api-source/${sourceUuid}`, {
      data: { name: BACKEND_NAME, url: `http://localhost:${BACKEND_PORT}` },
    }),
  );

  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  await page.locator("#tabs").getByRole("button").first().click();
  await page.getByRole("button", { name: /New Dashboard/ }).click();
  await page.waitForURL(/\/app\/[a-f0-9-]+/, { timeout: 10000 });
  dashboardId = new URL(page.url()).pathname.split("/").pop() ?? "";
  await addWidgets(["E2E rows", "E2E probe"]);
});

test.afterAll(async () => {
  if (page && dashboardId) {
    // A test that failed may have left a dialog open over the sidebar
    await page.keyboard.press("Escape");
    await page.locator(`#tab-${dashboardId}`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
  }
  if (api && sourceUuid)
    await api.delete(`/app/data-connectors/api-source/${sourceUuid}`);
  await api?.dispose();
  await context?.close();
  backend?.close();
});

test("plugin-widgets-render-in-sandboxed-frames", async () => {
  const frames = page.locator(
    'iframe[title$="(End-to-end table)"], iframe[title$="(End-to-end hostile)"]',
  );
  await expect(frames).toHaveCount(2);
  for (const frame of await frames.all())
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(tableFrame().locator("#e2e-title")).toHaveText("Sales: emea");
  await expect(tableFrame().locator("#e2e-count")).toHaveText("2 rows");
});

test("plugin-writes-a-param-and-notifies", async () => {
  const boots = await tableBoots();
  await tableFrame().locator("#e2e-next").click();
  await expect(tableFrame().locator("#e2e-title")).toHaveText("Sales: apac");
  await expect(tableFrame().locator("#e2e-count")).toHaveText("3 rows");
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Region apac" }),
  ).toBeVisible();
  // The refetch for the new param kept the plugin running
  expect(await tableBoots()).toBe(boots);
});

test("plugin-cannot-leave-its-frame", async () => {
  const text = await probeFrame().locator("#e2e-results").textContent();
  const results = JSON.parse(text ?? "{}") as Record<string, string>;
  expect(Object.keys(results).length).toBeGreaterThanOrEqual(16);
  // The widget's MCP link stays the host's (abuse case 38)
  expect(results["mcp-link"]).toBe("blocked");
  expect(results["core:mcp:call"]).toBe("blocked");
  for (const [attempt, outcome] of Object.entries(results))
    expect.soft(outcome, attempt).toBe("blocked");
  // Its prototype pollution stayed in its realm, its forged messages were ignored, and
  // its markup was shown as text
  expect(await page.evaluate(() => "e2ePolluted" in {})).toBe(false);
  await expect(card("E2E probe").getByText("forged")).toHaveCount(0);
  const toasts = (await seen()).toasts.filter((t) => t.includes("e2e-markup"));
  expect(toasts).toHaveLength(1);
  expect(toasts[0]).toContain("<img src=x onerror=alert(1)>");
  expect(toasts[0]).toContain("|img:false");
});

test("plugin-policy-violations-reach-the-administrator", async () => {
  type Report = {
    directive: string;
    origin: string;
    version: string;
    last_seen: string;
  };
  // Reports of this run: a rerun writes the same version, and reports keep their rows
  const since = started - 2000;
  await expect
    .poll(
      async () =>
        ((await json(await api.get("/plugins/e2e-hostile/csp-reports"))) as Report[])
          .filter(
            (r) =>
              r.version === versions["e2e-hostile"] && Date.parse(r.last_seen) >= since,
          )
          .map((r) => `${r.directive} ${r.origin}`),
      { timeout: 20000 },
    )
    .toEqual(
      expect.arrayContaining([
        "connect-src https://example.com",
        "connect-src wss://example.com",
        "img-src https://example.com",
      ]),
    );
});

test("plugin-exports-what-its-code-offers", async () => {
  const rows = card("E2E rows");
  await rows.hover();
  await rows.getByTestId("_navbar-controls-right").getByRole("button").last().click();
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();

  // The options come from the plugin's exportOptions, for what it shows now
  const dialog = page.getByRole("dialog").filter({ hasText: "Export widget" });
  await expect(dialog.getByText("Rows of apac (JSON)")).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(1);
  await dialog.getByLabel("Save as").fill("e2e-rows");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    dialog.getByRole("button", { name: "Export" }).click(),
  ]);

  // The file is what its exportData delivered, named and typed as the option says
  expect(download.suggestedFilename()).toBe("e2e-rows.json");
  expect(JSON.parse(readFileSync((await download.path()) ?? "", "utf8"))).toEqual({
    title: "e2e-rows",
    rows: [
      { country: "Japan", sales: 12 },
      { country: "India", sales: 9 },
      { country: "Korea", sales: 4 },
    ],
  });
});

test("plugin-follows-the-theme-without-restarting", async () => {
  const theme = tableFrame().locator("#e2e-theme");
  const before = (await theme.textContent())?.replace("theme ", "");
  const after = before === "dark" ? "light" : "dark";
  const boots = await tableBoots();
  // The endpoint is asked again with the site's theme, as a markdown or html one is
  const asked = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.port === String(BACKEND_PORT) &&
      url.pathname === "/rows" &&
      url.searchParams.get("theme") === after
    );
  });
  await page.locator("body").press("ControlOrMeta+m");
  await asked;
  await expect(theme).toHaveText(`theme ${after}`);
  await expect
    .poll(() =>
      tableFrame()
        .locator("html")
        .evaluate((el) => getComputedStyle(el).colorScheme),
    )
    .toBe(after);
  expect(await tableBoots()).toBe(boots);
  await page.locator("body").press("ControlOrMeta+m");
  await expect(theme).toHaveText(`theme ${before}`);
});

test("plugin-widget-keeps-its-params", async () => {
  await page.reload();
  await expect(tableFrame().locator("#e2e-title")).toHaveText("Sales: apac", {
    timeout: 30000,
  });
});

test("standalone-plugin-widget-is-added-from-the-menu", async () => {
  await addWidgets(["End-to-end note"]);
  const note = page
    .frameLocator('iframe[title^="End-to-end note"]')
    .locator("#e2e-note");
  await expect(note).toHaveText("Hello from a plugin");
  // The dashboard keeps it, with its plugin reference
  await page.reload();
  await expect(note).toHaveText("Hello from a plugin", { timeout: 30000 });
});

test("disabled-plugin-leaves-a-placeholder", async () => {
  await json(
    await api.put("/admin/plugins/e2e-table", {
      data: { enabled: false, access_mode: "everyone" },
    }),
  );
  await page.reload();
  await expect(
    card("E2E rows").getByText("This widget type is not available to you"),
  ).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator('iframe[title^="E2E rows"]')).toHaveCount(0);

  await json(
    await api.put("/admin/plugins/e2e-table", {
      data: { enabled: true, access_mode: "everyone" },
    }),
  );
  await page.reload();
  await expect(tableFrame().locator("#e2e-title")).toHaveText("Sales: apac", {
    timeout: 30000,
  });
});
