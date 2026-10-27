---
title: How to create a theme for the web app
sidebar_position: 2
---

# How to create a theme for the web app

The web app always loads its own stylesheets, which carry the FINOS colors and every custom property. A theme is one more stylesheet that you give the app. It loads after the base stylesheets, so it needs to hold only the properties that you want to change, and it does not require a rebuild of the frontend. This guide shows how to write the stylesheet and how to make the web app load it.

## Write the stylesheet

Create a file such as `theme.css`. For each property that you change, declare the new value on `:root`, which sets it for the light theme. A rule on `:root` also applies in the dark theme, so add a second declaration on `.dark` only for the properties that need a different value there.

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

[Semantic properties](../../reference/css/semantic-properties.mdx) lists the properties that components read. A property that refers to a palette step with `var()` follows that step, so to move a whole family of colors, change the property of the [palette](../../reference/css/color-palette.mdx) instead. The brand color and the font are properties like any other, and [How to change the brand color and font](change-brand-color-and-font.md) shows how to set them.

## Make the web app load it

The web app loads the stylesheet that the environment variable `WL_STYLESHEET` names. The value is an address, and there are two kinds of address.

**A full URL.** Host the file anywhere that serves it as `text/css` to your users' browsers, and set the variable to its URL. This needs nothing inside the web container.

```
WL_STYLESHEET=https://<static host>/<path>/theme.css
```

**A path on the web app's own origin.** Put the file in the web container's document root, `/usr/share/nginx/html`, and set the variable to the path. You can ship the file in a derived web image, or you can mount it. On Kubernetes, for example, a ConfigMap that holds `theme.css` can be mounted as a single file:

```yaml
containers:
  - name: web
    env:
      - name: WL_STYLESHEET
        value: /theme.css
    volumeMounts:
      - name: theme
        mountPath: /usr/share/nginx/html/theme.css
        subPath: theme.css
        readOnly: true
volumes:
  - name: theme
    configMap:
      name: <config map that holds theme.css>
```

`WL_STYLESHEET` is one of the white-label settings, which [Web app configuration](../../reference/configuration/web-app.mdx) lists. The web container renders its configuration when it starts, so restart the container after you change the variable. While the variable is unset, no theme loads.

## Check the result

Open the app. The page waits for the theme stylesheet before it draws anything, so the first frame already shows your values. When the address does not lead to a stylesheet, the app draws with the base styles and nothing else changes.

## Design the values in the admin area instead

An admin can also try values with the whole app showing them, and keep the result as a preset, without touching the deployment: [How to design and apply a theme in the admin area](design-a-theme-in-the-admin-area.mdx). The editor's Download theme.css button produces a stylesheet that you can use here. A preset that is applied loads after this stylesheet, so it wins wherever both set the same property.

## What a theme cannot change

Some colors are not custom properties, so a theme cannot reach them:

- Tailwind's own colors, such as `white`, `black` and `red-500`, are not properties. [Styling surfaces](../../reference/css/styling-surfaces.mdx) says how many places use them.
- Widgets that draw in their own frame, such as HTML widgets and plugin widgets, are styled by their authors. [How to style an HTML widget](../build/style-an-html-widget.md) and [How to style a plugin widget](../build/style-a-plugin-widget.md) explain how.
