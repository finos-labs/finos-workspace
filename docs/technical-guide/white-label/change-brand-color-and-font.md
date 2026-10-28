---
title: How to change the brand color and font
sidebar_position: 4
---

# How to change the brand color and font

The brand color and the font are the two properties that most deployments change first. They are custom properties, so they change in the same way as every other property. Without a theme, the app shows the FINOS colors.

## In the admin area

Open Admin → Theme → Presets and look at the Brand group, which is first in the list. Change `--color-main-100`, which is the brand color, and then select "Derive from brand color" to set the two other shades and the text color from it. Choose a font from the menu. The whole app shows each change as you make it. Then save the result as a preset and apply it to everyone, as [How to design and apply a theme in the admin area](../../user-guide/administration/design-a-theme-in-the-admin-area.mdx) describes.

## In a stylesheet

Put the declarations in your theme stylesheet, on `:root`. The font must be one of `Montserrat`, `Inter` and `Roboto`, which the app ships. Another family name works only on devices that have that font installed.

```css
:root {
  --color-main-100: <hex-color>;
  --color-main-50: color-mix(in srgb, var(--color-main-100) 70%, white);
  --color-main-200: color-mix(in srgb, var(--color-main-100) 70%, black);
  --color-main-contrast: var(--color-light-100);
  --font-family: "Inter";
}
```

The three brand steps are separate properties, so a theme sets all three. The two `color-mix` lines make the other shades follow the color that you chose, and you can give them colors of your own instead. The property `--color-main-contrast` is the color of text on brand-colored buttons and tabs. When your brand color is light, set it to `var(--color-light-700)` so that the text stays readable.

Then load the stylesheet, as [How to create a theme for the web app](create-a-theme.md) describes. No rebuild is needed. [Brand color, font and text size](../../reference/css/brand-font-size.mdx) lists the rules for these properties.

## Use a font of your own

A font that the app does not ship needs its files and an `@font-face` rule, both of which the theme stylesheet can provide. Host the font files where your users' browsers reach them, or mount them in the web container's document root next to the stylesheet, and declare the family before you name it:

```css
@font-face {
  font-family: "Acme Sans";
  font-weight: 100 900;
  font-display: swap;
  src: url("/brand/fonts/acme-sans.woff2") format("woff2");
}

:root {
  --font-family: "Acme Sans";
}
```

Every text of the app follows `--font-family`, with `system-ui` as the fallback while the font loads. A preset that an admin designs in the app cannot do this, because a preset's values may not contain `url(`, and its font menu offers only Montserrat, Inter and Roboto. Check that the font's license allows you to serve it from your own host.
