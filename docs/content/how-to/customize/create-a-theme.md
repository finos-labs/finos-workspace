---
title: How to create a theme for the web app
---

# How to create a theme for the web app

The web app always loads its own stylesheets, which carry the FINOS colours and every property. A theme is one more stylesheet that you give it. It loads after the base, so it holds only the properties you change, and it needs no rebuild of the frontend.

1. Write the stylesheet, for example `theme.css`. Declare each property you change on `:root` for the light theme, and again on `.dark` when the dark theme needs another value. A rule on `:root` alone also applies in the dark theme.

   ```css
   :root {
     --btn-primary-bg: #7b2d8e;
     --btn-primary-bg-hover: #5c2169;
   }

   .dark {
     --btn-primary-bg: #a64bbd;
     --btn-primary-bg-hover: #8a3aa0;
   }
   ```

   Find the properties in [Semantic properties](../../reference/css/semantic-properties.mdx). A property that refers to a palette step with `var()` follows that step, so to move a whole family of colours, change the property of the [palette](../../reference/css/colour-palette.mdx) instead. The brand colour and the font are properties too: [How to change the brand colour and font](change-brand-colour-and-font.md).

2. Give the file to the web container and name it in `WL_STYLESHEET`. In a compose override file:

   ```yaml
   services:
     web:
       environment:
         WL_STYLESHEET: /theme.css
       volumes:
         - ./theme.css:/usr/share/nginx/html/theme.css:ro
   ```

   `WL_STYLESHEET` is an address: a path on the web app's own origin, as here, or a full URL. It is one of the white-label settings ([Web app configuration](../../reference/configuration/web-app.mdx)). Unset, no theme loads.

3. Start the web container with the override:

   ```bash
   docker compose -f docker-compose.yml -f <override file> up -d web
   ```

4. Open the app. The page waits for the theme stylesheet before it draws, so the first frame already has your values. If the address does not lead to a stylesheet, the app draws with the base styles.

## Design the values in the admin area

An admin can try values, with the whole app showing them, and keep them as a preset: [How to design and apply a theme in the admin area](design-a-theme-in-the-admin-area.md). The editor's "Download theme.css" gives a stylesheet to mount here. A preset that is applied loads after this stylesheet, so it wins where both set a property.

## Colours that a property does not change

- Tailwind's own colours, such as `white`, `black` and `red-500`, are not properties. How many places use them is on [Styling surfaces](../../reference/css/styling-surfaces.mdx).
- Widgets that draw in their own frame, such as HTML widgets and plugin widgets, are styled by their authors: [How to style an HTML widget](../build/style-an-html-widget.md) and [How to style a plugin widget](../build/style-a-plugin-widget.md).
