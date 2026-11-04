export interface ThemeVariants {
  light: Record<string, string>;
  dark: Record<string, string>;
}

type Layer = "saved" | "preview";

let layers: Record<Layer, CSSStyleSheet> | null = null;
let saved: ThemeVariants | null = null;
let preview: ThemeVariants | null = null;

function createLayer(id: Layer): CSSStyleSheet {
  const element = document.createElement("style");
  element.dataset.theme = id;
  document.head.appendChild(element);
  const sheet = element.sheet as CSSStyleSheet;
  sheet.insertRule(":root {}", 0);
  sheet.insertRule(".dark {}", 1);
  return sheet;
}

function fill(sheet: CSSStyleSheet, variants: ThemeVariants | null) {
  const [light, dark] = Array.from(sheet.cssRules) as CSSStyleRule[];
  light.style.cssText = "";
  dark.style.cssText = "";
  for (const [name, value] of Object.entries(variants?.light ?? {})) {
    light.style.setProperty(name, value);
  }
  for (const [name, value] of Object.entries(variants?.dark ?? {})) {
    dark.style.setProperty(name, value);
  }
}

function render() {
  layers ??= { saved: createLayer("saved"), preview: createLayer("preview") };
  fill(layers.saved, preview ? null : saved);
  fill(layers.preview, preview);
}

export function applySavedTheme(variants: ThemeVariants | null) {
  saved = variants;
  render();
}

export function applyPreviewTheme(variants: ThemeVariants | null) {
  preview = variants;
  render();
}
