import { describe, expect, it } from "vitest";
import { DERIVED_SHADES, toCss } from "~/lib/theme/css";

describe("toCss", () => {
  it("writes the light values on :root and the dark values on .dark", () => {
    expect(
      toCss({
        light: { "--color-main-100": "#7b2d8e", "--font-family": '"Inter"' },
        dark: { "--color-main-100": "#a64bbd" },
      }),
    ).toBe(
      [
        ":root {",
        "  --color-main-100: #7b2d8e;",
        '  --font-family: "Inter";',
        "}",
        "",
        ".dark {",
        "  --color-main-100: #a64bbd;",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("leaves out a scope that holds nothing", () => {
    expect(toCss({ light: {}, dark: { "--a": "red" } })).toBe(
      ".dark {\n  --a: red;\n}\n",
    );
    expect(toCss({ light: {}, dark: {} })).toBe("");
  });
});

describe("DERIVED_SHADES", () => {
  it("mixes the brand colour toward white and black", () => {
    expect(DERIVED_SHADES["--color-main-50"]).toContain(
      "var(--color-main-100) 70%, white",
    );
    expect(DERIVED_SHADES["--color-main-200"]).toContain(
      "var(--color-main-100) 70%, black",
    );
  });
});
