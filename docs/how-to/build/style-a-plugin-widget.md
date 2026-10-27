---
title: How to style a plugin widget for both themes
sidebar_position: 6
---

# How to style a plugin widget for both themes

A plugin draws in a sandboxed frame that has its own stylesheets and shares nothing with the app. The host tells the module which theme is active through the `theme` trait, and it pushes a `change:theme` event whenever the theme changes. This guide shows how a plugin uses that information to look right in the light and in the dark theme. The module marks its root element with the mode, and the stylesheet does the rest.

1. List the stylesheet in the manifest. The host adds each file of `entry.styles` to the frame as a `style` element:

   ```json
   "entry": { "module": "entry.js", "styles": ["entry.css"] }
   ```

2. In `entry.css`, declare the colors once for each mode, and use them through custom properties of your own:

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

3. In `entry.js`, set the mode on the root element and follow the changes:

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

4. To match the app's colors exactly, copy values from the `theme.tokens` object instead of fixing them in the stylesheet:

   ```js
   const tokens = model.get("theme")?.tokens ?? {};
   root.style.setProperty("--bg", tokens.background ?? "#0b2432");
   ```

   [Plugin theme](../../reference/css/plugin-theme.mdx) lists the tokens and their values. Call this code again from `applyTheme`, so that the values follow the theme.

The frame defines no custom properties of its own, so you can name the properties in these examples as you like. [Plugin package and manifest](../../reference/plugins/package-and-manifest.mdx) describes the other parts of the manifest.
