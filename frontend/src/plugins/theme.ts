export interface ThemeTrait {
  mode: "dark" | "light";
  tokens: Record<string, string>;
  locale: string;
  decimals: number;
}

const TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "border",
  "accent",
  "accent-foreground",
  "brand-main",
  "brand-lighter",
  "brand-darker",
  "alert-error",
  "alert-success",
  "alert-warning",
  "alert-informative",
] as const;

export function readThemeTrait(mode: string | undefined): ThemeTrait {
  const tokens: Record<string, string> = {};
  if (typeof document !== "undefined") {
    const style = getComputedStyle(document.body ?? document.documentElement);
    for (const token of TOKENS) {
      const value = style.getPropertyValue(`--${token}`).trim();
      if (value) tokens[token] = value;
    }
    const font = style.fontFamily;
    if (font) tokens["font-family"] = font;
  }
  return {
    mode: mode === "light" ? "light" : "dark",
    tokens,
    locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
    decimals: 2,
  };
}
