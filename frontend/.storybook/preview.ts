import type { Preview } from "storybook";
import "../src/index.css";
import { DocPage } from "./DocPage";
import { DualThemeDecorator } from "./DualThemeDecorator";

const preview: Preview = {
  decorators: [DualThemeDecorator],
  parameters: {
    layout: "fullscreen",
    docs: {
      page: DocPage,
    },
    a11y: {
      test: "error",
      context: {
        exclude: ["[data-a11y-ignore]", "[disabled]", '[aria-disabled="true"]'],
      },
      options: { runOnly: ["wcag2a", "wcag2aa"] },
    },
  },
};

export default preview;
