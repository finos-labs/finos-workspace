---
title: Style a plugin widget for both themes
sidebar_position: 6
---

# Style a plugin widget for both themes

Make a plugin look right in the light and the dark theme. The module marks its root element with the mode, and the stylesheet does the rest.

A plugin draws in a sandboxed frame with its own stylesheets. The host tells the module which theme is active through the `theme` trait, and it pushes a `change:theme` event whenever the theme changes.

## 1. List the stylesheet

The host adds each file of `entry.styles` to the frame as a `style` element:

```json
"entry": { "module": "entry.js", "styles": ["entry.css"] }
```

## 2. Declare the colors for each mode

In `entry.css`, declare the colors once for each mode, as custom properties of your own:

```css
.widget[data-mode="dark"] {
  color-scheme: dark;
  --bg: #0b2432;
  --text: #e7f2f8;
  --line: #355867;
}

.widget[data-mode="light"] {
  color-scheme: light;
  --bg: #ffffff;
  --text: #1a3248;
  --line: #b7cdd8;
}

.widget {
  height: 100%;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--line);
}
```

The frame defines no custom properties of its own, so you can name these as you like.

## 3. Set the mode and follow changes

In `entry.js`, set the mode on the root element, and update it when the theme changes:

```js
export default {
  async render({ model, el, signal }) {
    const root = document.createElement("div");
    root.className = "widget";
    el.append(root);

    const applyTheme = () => {
      root.dataset.mode = model.get("theme")?.mode === "light" ? "light" : "dark";
    };

    model.on("change:theme", applyTheme);
    signal.addEventListener("abort", () => model.off("change:theme", applyTheme));
    applyTheme();
  },
};
```

## 4. Match the app's colors exactly (optional)

Copy values from the `theme.tokens` object instead of fixing them in the stylesheet:

```js
const tokens = model.get("theme")?.tokens ?? {};
root.style.setProperty("--bg", tokens.background ?? "#0b2432");
```

Call this code again from `applyTheme`, so that the values follow the theme. [Plugin theme](../../reference/plugins/plugin-theme.mdx) lists the tokens and their values.

## Next steps

[Plugin package and manifest](../../reference/plugins/package-and-manifest.mdx) describes the other parts of the manifest.
