import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running stack (`docker compose up` serves the web app on
 * port 3000). They sign in as an account that exists there, which they name through
 * E2E_USER_EMAIL and E2E_USER_PASSWORD; see TESTING.md.
 */
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
  ],
});
