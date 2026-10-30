import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import appConfig from "../vite.config.ts";

export default defineConfig((env) => {
  const { test: _unitTests, ...app } = appConfig(env);
  return mergeConfig(app, {
    plugins: [storybookTest({ configDir: import.meta.dirname })],
    test: {
      name: "storybook",
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: "chromium" }],
      },
    },
  });
});
