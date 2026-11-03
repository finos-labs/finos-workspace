import type { ThemeVariants } from "./sheet";

function block(selector: string, declarations: Record<string, string>): string {
  const lines = Object.entries(declarations).map(
    ([name, value]) => `  ${name}: ${value};\n`,
  );
  return lines.length > 0 ? `${selector} {\n${lines.join("")}}\n` : "";
}

export function toCss(variants: ThemeVariants): string {
  return [block(":root", variants.light), block(".dark", variants.dark)]
    .filter(Boolean)
    .join("\n");
}

export const DERIVED_SHADES = {
  "--color-main-50": "color-mix(in srgb, var(--color-main-100) 70%, white)",
  "--color-main-200": "color-mix(in srgb, var(--color-main-100) 70%, black)",
};
