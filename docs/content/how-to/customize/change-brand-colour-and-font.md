---
title: How to change the brand colour and font
---

# How to change the brand colour and font

The brand colour and the font are custom properties, so they change like any other property. Without a theme the app shows the FINOS colours.

## In the admin area

On Admin → Theme → Presets, open the Brand group, which is first in the list, and change `--color-main-100`, the brand colour. Select "Derive from brand color" to set the two other shades and the text colour from it, and choose a font from the menu. The whole app shows the change as you make it. Save it as a preset and apply it to everyone: [How to design and apply a theme in the admin area](design-a-theme-in-the-admin-area.md).

## In a stylesheet

Put the declarations in your theme stylesheet, on `:root`. The font is one of `Montserrat`, `Inter` and `Roboto`, which the app ships; another family name works only on devices that have the font installed:

```css
:root {
  --color-main-100: <hex-colour>;
  --color-main-50: color-mix(in srgb, var(--color-main-100) 70%, white);
  --color-main-200: color-mix(in srgb, var(--color-main-100) 70%, black);
  --color-main-contrast: var(--color-light-100);
  --font-family: "Inter";
}
```

The three brand steps are separate properties, so a theme sets all three; the `color-mix` lines make the two other shades follow the colour you chose, and you can give them colours of your own instead. `--color-main-contrast` is the colour of text on brand-coloured buttons and tabs: use `var(--color-light-700)` when the brand colour is light.

Load the stylesheet as in [How to create a theme for the web app](create-a-theme.md). No rebuild is needed.

The rules for the properties are on [Brand colour, font and text size](../../reference/css/brand-font-size.mdx).
