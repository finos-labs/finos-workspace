---
slug: /features/white-label
title: White label
sidebar_position: 0
---

# White label

FINOS Workspace can carry your organization's brand instead of its own: your product name, logos, icons, images, colors and fonts. This section lists every place where the product shows a brand element, how you change each one, and which ones are written in the code.

Most changes need no rebuild. They are settings of the web container, which it reads each time it starts, or files that you place in the container's document root. A few things are fixed when the web app is built, and some are written in the code.

## Where each brand element is set

| Element | How you change it | Rebuild? | Page |
|---|---|---|---|
| Product name in the tab title and page titles | `WL_NAME` | No | [Name and text](name-and-text.md) |
| Description and keywords for search engines and link previews | `WL_DESCRIPTION`, `WL_KEYWORDS` | No, but see the page | [Name and text](name-and-text.md) |
| Name, short name and description of the installed app (PWA) | `VITE_WL_NAME`, `VITE_WL_SHORT_NAME`, `VITE_WL_DESCRIPTION` at build | Yes | [Name and text](name-and-text.md) |
| Support email and documentation links | `SUPPORT_EMAIL`, `DOCS_URL` and the `UI_SHOW_*` switches | No | [Name and text](name-and-text.md) |
| Logo on the login and password reset pages | `WL_LOGIN_IMAGE` | No | [Logos, icons and images](logos-icons-and-images.md) |
| Logo at the top of the sidebar, light and dark | `WL_LEFT_SIDEBAR_LOGO`, `WL_LEFT_SIDEBAR_LOGO_DARK` | No | [Logos, icons and images](logos-icons-and-images.md) |
| Icon in the browser tab | `WL_FAVICON` | No | [Logos, icons and images](logos-icons-and-images.md) |
| App icons, default images and the other logo files | Replace the files in the web container | No | [Logos, icons and images](logos-icons-and-images.md) |
| Images of apps in the app gallery | `img`, `img_dark`, `img_light` in a backend's `apps.json` | No | [Logos, icons and images](logos-icons-and-images.md) |
| Colors for everyone, on every page including sign-in | A theme stylesheet that `WL_STYLESHEET` names | No | [Create a theme](create-a-theme.md) |
| Colors for one organization, designed in the app | A theme preset in Admin → Theme | No | [Design a theme in the admin area](../administration/design-a-theme-in-the-admin-area.mdx) |
| Brand color and font | A theme stylesheet or a preset | No | [Change the brand color and font](change-brand-color-and-font.md) |
| A font that the app does not ship | `@font-face` in the theme stylesheet | No | [Change the brand color and font](change-brand-color-and-font.md) |
| Light or dark theme by default | `UI_DEFAULT_THEME` | No | [Name and text](name-and-text.md) |
| HTML widgets, plugin widgets and Agent reports | The widget's author, and the agent's skills | Depends | [Widgets, reports and exports](widgets-reports-and-exports.md) |
| Agent name, MCP server names, export watermark and other fixed text | The code | Yes | [Brand elements in the code](brand-elements-in-the-code.md) |

## How the settings reach the app

The settings in the table are environment variables of the web container. When a browser loads the app, the container answers `/config.js` with their values, so a change takes effect after you restart the container. [Web app configuration](../../reference/configuration/web-app.mdx) lists every setting with its default; the group `whiteLabel` holds the brand settings.

Files that the app loads by address, such as logos, icons and a theme stylesheet, can live on any host that your users' browsers reach, or in the web container's document root, `/usr/share/nginx/html`. To put a file there without building a new image, mount it, as [Create a theme](create-a-theme.md) shows for a stylesheet.

## Order of precedence for colors

Three layers decide the colors, and a later layer wins where two set the same property:

1. The base stylesheets with the FINOS colors, which are always there.
2. The theme stylesheet of the deployment, `WL_STYLESHEET`.
3. The theme preset that an organization's admin applied in the app. It loads only after a user signs in, so the sign-in pages show the first two layers.


## A checklist for a rebrand

1. Set `WL_NAME`, `WL_DESCRIPTION` and `WL_KEYWORDS`.
2. Provide your logos and set `WL_LOGIN_IMAGE`, `WL_LEFT_SIDEBAR_LOGO`, `WL_LEFT_SIDEBAR_LOGO_DARK` and `WL_FAVICON`.
3. Replace the app icons and default images that you do not want, as [Logos, icons and images](logos-icons-and-images.md) lists.
4. Write a theme stylesheet with your brand color and font, and set `WL_STYLESHEET`.
5. Set `SUPPORT_EMAIL` and `DOCS_URL`, or hide the documentation links.
6. If users install the app on their devices, build the web image with `VITE_WL_NAME`, `VITE_WL_SHORT_NAME` and `VITE_WL_DESCRIPTION`.
7. Read [Brand elements in the code](brand-elements-in-the-code.md), so the remaining product names do not surprise you.
