import { defineConfig, devices } from "@playwright/test";

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
    baseURL: process.env.E2E_BASE_URL ?? "https://localhost:3000",
    ignoreHTTPSErrors: true,
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
