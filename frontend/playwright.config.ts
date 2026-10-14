import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running stack (`docker compose up` serves the web app on
 * port 3000). They sign in as an account that exists there, which they name through
 * E2E_USER_EMAIL and E2E_USER_PASSWORD; see TESTING.md.
 */

// Specs that also run in Firefox and WebKit: the widget plugins' (a plugin's frame, its
// policy and its workers are where the engines differ, docs/widget-plugins/SPIKE.md), and
// keeping a dashboard's changes as the page goes away (WebKit cancels requests made then)
const CROSS_ENGINE_SPECS = [/plugins?[-.][^/]*spec\.ts$/, /dashboard-persistence\.spec\.ts$/];
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/*.spec.ts", "**/global.setup.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "setup",
      testMatch: /global\.setup\.ts/,
    },
    {
      name: "Google Chrome",
      testIgnore: /global\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },
    {
      name: "chromium",
      testIgnore: /global\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
    {
      name: "firefox",
      testMatch: CROSS_ENGINE_SPECS,
      use: { ...devices["Desktop Firefox"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
    {
      name: "webkit",
      testMatch: CROSS_ENGINE_SPECS,
      use: { ...devices["Desktop Safari"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
});
