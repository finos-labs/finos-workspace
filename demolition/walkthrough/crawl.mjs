// Opens the main pages of a running Workspace as a signed-in user and reports console errors,
// page errors and failed requests. Run it from the workspace package, which provides playwright-core:
//
//   cd workspace && E2E_BASE_URL=http://localhost:3000 \
//     STORAGE_STATE=playwright/.auth/user.json \
//     CHROMIUM=<path of a chromium or chrome-headless-shell binary, optional> \
//     node ../demolition/walkthrough/crawl.mjs
//
// STORAGE_STATE is the file that the Playwright setup project writes (tests/e2e/global.setup.ts).
import { createRequire } from "node:module";
import path from "node:path";

// playwright-core is resolved from the directory the script is run in (the workspace package)
const { chromium } = createRequire(path.join(process.cwd(), "noop.js"))("playwright-core");

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const storageState = process.env.STORAGE_STATE ?? "playwright/.auth/user.json";
const routes = [
  "/app",
  "/app/connections",
  "/app/widgets",
  "/app/ai",
  "/app/settings",
  "/app/help-documentation",
  "/admin/users",
  "/admin/entities",
  "/admin/roles",
  "/admin/apps",
  "/admin/marketplace",
  "/admin/theme-settings",
  "/admin/account",
];

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  storageState,
});
const page = await context.newPage();
const issues = [];
let current = "";
page.on("console", (m) => {
  if (m.type() === "error") issues.push(`[${current}] console.error: ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => issues.push(`[${current}] pageerror: ${String(e).slice(0, 200)}`));
page.on("response", (r) => {
  if (r.status() >= 400) issues.push(`[${current}] ${r.status()} ${r.request().method()} ${r.url().slice(0, 120)}`);
});
page.on("requestfailed", (r) => issues.push(`[${current}] requestfailed ${r.url().slice(0, 120)}`));

for (const route of routes) {
  current = route;
  await page.goto(base + route, { waitUntil: "networkidle" }).catch((e) => issues.push(`[${route}] goto: ${e.message.slice(0, 120)}`));
  await page.waitForTimeout(800);
  console.log(route, "->", new URL(page.url()).pathname, "|", await page.title());
}
console.log(issues.length ? `ISSUES:\n${[...new Set(issues)].join("\n")}` : "no console errors, page errors or failed requests");
await browser.close();
process.exit(issues.length ? 1 : 0);
