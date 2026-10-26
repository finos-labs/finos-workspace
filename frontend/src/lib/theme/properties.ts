import indexCss from "~/index.css?raw";
import tokensCss from "~/styles/tokens.css?raw";

export type ThemeScope = "light" | "dark";

export interface ThemeProperty {
  name: string;
  group: string;
  kind: "color" | "text" | "font";
  light: string | undefined;
  dark: string | undefined;
}

export const FONT_FAMILIES = ["Montserrat", "Inter", "Roboto"];

const SCOPES: Record<string, ThemeScope> = { ":root": "light", ".dark": "dark" };
const EXCLUDED = new Set(["--text-scale"]);
const BRAND_GROUP = "Brand";
const BASE_GROUP = "Base";
const RAMP = /^--color-([a-z]+(?:-[a-z]+)?)-(\d+|contrast)$/;
const LABELS: Record<string, string> = {
  general: "General",
  alert: "Alert",
  surface: "Surface",
  btn: "Button",
  link: "Link",
  dropdown: "Dropdown",
  input: "Input",
  scrollbar: "Scrollbar",
  tab: "Tab",
  tag: "Tag",
  table: "Table",
  tooltip: "Tooltip",
  toggle: "Toggle",
  search: "Search",
  text: "Text",
  copilot: "Copilot",
  components: "Components",
};

type Declarations = Record<ThemeScope, Map<string, string>>;

function scan(css: string): Declarations {
  const found: Declarations = { light: new Map(), dark: new Map() };
  const stack: string[] = [];
  let buffer = "";
  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (char === "{") {
      stack.push(buffer.trim());
      buffer = "";
    } else if (char === "}") {
      stack.pop();
      buffer = "";
    } else if (char === ";") {
      const scope = SCOPES[stack[stack.length - 1] ?? ""];
      const declaration = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+)$/.exec(buffer);
      if (scope && declaration) found[scope].set(declaration[1], declaration[2].trim());
      buffer = "";
    } else {
      buffer += char;
    }
  }
  return found;
}

function groupOf(name: string, base: boolean): string {
  if (name === "--font-family" || name === "--radius") return BRAND_GROUP;
  const ramp = RAMP.exec(name)?.[1];
  if (ramp === "main") return BRAND_GROUP;
  if (ramp) return `Palette: ${ramp.replace("-", " ")}`;
  if (base) return BASE_GROUP;
  const prefix = name.split("-")[2];
  return LABELS[prefix] ?? prefix;
}

function kindOf(name: string): ThemeProperty["kind"] {
  if (name === "--font-family") return "font";
  if (name === "--radius" || name.includes("shadow")) return "text";
  return "color";
}

function build(): ThemeProperty[] {
  const properties = new Map<string, ThemeProperty>();
  for (const [css, base] of [
    [tokensCss, false],
    [indexCss, true],
  ] as const) {
    const found = scan(css);
    for (const scope of ["light", "dark"] as const) {
      for (const [name, value] of found[scope]) {
        if (EXCLUDED.has(name)) continue;
        const property = properties.get(name) ?? {
          name,
          group: groupOf(name, base),
          kind: kindOf(name),
          light: undefined,
          dark: undefined,
        };
        property[scope] = value;
        properties.set(name, property);
      }
    }
  }
  return Array.from(properties.values());
}

export const THEME_PROPERTIES = build();

export const THEME_GROUPS = Array.from(
  new Set(THEME_PROPERTIES.map((property) => property.group)),
).sort((a, b) => rank(a) - rank(b));

function rank(group: string): number {
  if (group === BRAND_GROUP) return 0;
  if (group === BASE_GROUP) return 2;
  return 1;
}

export function baseValue(property: ThemeProperty, scope: ThemeScope): string {
  return (scope === "dark" ? property.dark : undefined) ?? property.light ?? "";
}
