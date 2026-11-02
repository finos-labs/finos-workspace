import { describe, expect, it } from "vitest";
import { baseValue, THEME_GROUPS, THEME_PROPERTIES } from "~/lib/theme/properties";

const find = (name: string) =>
  THEME_PROPERTIES.find((property) => property.name === name);

describe("THEME_PROPERTIES", () => {
  it("reads the palette from tokens.css", () => {
    expect(find("--color-main-100")).toMatchObject({
      group: "Brand",
      kind: "color",
      light: "#0086bf",
    });
    expect(find("--color-extra-pink-100")?.group).toBe("Palette: extra pink");
    expect(find("--color-dark-900")?.group).toBe("Palette: dark");
  });

  it("reads the semantic properties of both themes", () => {
    const property = find("--link-color");
    expect(property?.group).toBe("Link");
    expect(property?.light).toBe("var(--color-main-100)");
    expect(property?.dark).toBe("var(--color-main-50)");
  });

  it("reads the base properties of index.css", () => {
    expect(find("--background")).toMatchObject({
      group: "Base",
      light: "var(--color-base-0)",
      dark: "var(--color-dark-900)",
    });
  });

  it("puts the font and the radius with the brand, as text controls", () => {
    expect(find("--font-family")).toMatchObject({ group: "Brand", kind: "font" });
    expect(find("--radius")).toMatchObject({ group: "Brand", kind: "text" });
    expect(find("--dropdown-shadow")?.kind).toBe("text");
  });

  it("leaves out the text scale, which the font size setting drives", () => {
    expect(find("--text-scale")).toBeUndefined();
  });

  it("lists every name once", () => {
    const names = THEME_PROPERTIES.map((property) => property.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("THEME_GROUPS", () => {
  it("starts with the brand and ends with the base properties", () => {
    expect(THEME_GROUPS[0]).toBe("Brand");
    expect(THEME_GROUPS[THEME_GROUPS.length - 1]).toBe("Base");
  });
});

describe("baseValue", () => {
  it("uses the dark declaration in the dark theme and falls back to the light one", () => {
    const link = find("--link-color");
    const brand = find("--color-main-100");
    expect(link && baseValue(link, "light")).toBe("var(--color-main-100)");
    expect(link && baseValue(link, "dark")).toBe("var(--color-main-50)");
    expect(brand && baseValue(brand, "dark")).toBe("#0086bf");
  });
});
