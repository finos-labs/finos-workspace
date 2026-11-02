import { afterEach, describe, expect, it } from "vitest";
import { applyPreviewTheme, applySavedTheme } from "~/lib/theme/sheet";

function rules(layer: string) {
  const element = document.head.querySelector<HTMLStyleElement>(
    `style[data-theme="${layer}"]`,
  );
  const [light, dark] = Array.from(element?.sheet?.cssRules ?? []) as CSSStyleRule[];
  return {
    light: light?.style.getPropertyValue("--color-main-100"),
    dark: dark?.style.getPropertyValue("--color-main-100"),
  };
}

describe("theme layers", () => {
  afterEach(() => {
    applyPreviewTheme(null);
    applySavedTheme(null);
  });

  it("writes the light and dark values of the saved theme into its own style element", () => {
    applySavedTheme({
      light: { "--color-main-100": "#111111" },
      dark: { "--color-main-100": "#222222" },
    });

    expect(rules("saved")).toEqual({ light: "#111111", dark: "#222222" });
  });

  it("replaces the earlier values and clears them for null", () => {
    applySavedTheme({ light: { "--color-main-100": "#111111" }, dark: {} });
    applySavedTheme({ light: {}, dark: { "--color-main-100": "#222222" } });
    expect(rules("saved")).toEqual({ light: "", dark: "#222222" });

    applySavedTheme(null);
    expect(rules("saved")).toEqual({ light: "", dark: "" });
  });

  it("puts the preview after the saved theme and keeps the saved theme out while it shows", () => {
    applySavedTheme({ light: { "--color-main-100": "#111111" }, dark: {} });
    applyPreviewTheme({ light: { "--color-main-100": "#333333" }, dark: {} });

    const layers = Array.from(document.head.querySelectorAll("style[data-theme]")).map(
      (element) => (element as HTMLElement).dataset.theme,
    );
    expect(layers).toEqual(["saved", "preview"]);
    expect(rules("preview").light).toBe("#333333");
    expect(rules("saved").light).toBe("");

    applyPreviewTheme(null);
    expect(rules("preview").light).toBe("");
    expect(rules("saved").light).toBe("#111111");
  });

  it("keeps the saved theme that arrives while a preview shows", () => {
    applyPreviewTheme({ light: {}, dark: {} });
    applySavedTheme({ light: { "--color-main-100": "#444444" }, dark: {} });
    expect(rules("saved").light).toBe("");

    applyPreviewTheme(null);
    expect(rules("saved").light).toBe("#444444");
  });
});
