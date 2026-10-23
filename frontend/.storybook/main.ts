import type { StorybookConfig } from "@storybook/react-vite";

// The `~` alias comes from vite.config.ts, which Storybook's Vite builder loads.
const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: [
    "../src/components/ds/**/*.stories.@(ts|tsx)",
    "../src/components/ds/**/*.mdx",
  ],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-themes",
  ],
  staticDirs: ["../public"],
};

export default config;
