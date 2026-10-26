---
title: How to style a plugin widget for both themes
---

# How to style a plugin widget for both themes

A plugin draws in a frame with its own stylesheets. The host tells the module the active theme through the `theme` trait and pushes a `change:theme` event when it changes, so the module marks its root with the mode and the stylesheet does the rest.

1. List the stylesheet in the manifest. Each file of `entry.styles` is added to the frame as a `style` element:

   ```json
   "entry": { "module": "entry.js", "styles": ["entry.css"] }
   ```

2. In `entry.css`, declare the colours once for each mode and use them through custom properties of your own:

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

3. In `entry.js`, set the mode on the root element and follow changes:

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

4. To match the app's colours exactly, copy values from the `theme.tokens` object instead of fixing them in the stylesheet:

   ```js
   const tokens = model.get("theme")?.tokens ?? {};
   root.style.setProperty("--bg", tokens.background ?? "#0b2432");
   ```

   The tokens and their values are on [Plugin theme](../../reference/css/plugin-theme.mdx). Call this again from `applyTheme`, so that the values follow the theme.

The frame defines no custom properties of its own, so everything above is yours to name. The plugin's frame size, sandbox and the other parts of the manifest are described in [plugin.json](../../reference/schemas/plugin-json.mdx).
