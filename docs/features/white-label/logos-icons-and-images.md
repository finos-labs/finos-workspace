---
title: Logos, icons and images
sidebar_position: 2
---

# Logos, icons and images

The app shows four logos that you set with a setting, and a number of icons and images that you replace as files. Neither needs a rebuild.

## Logos you set

Each setting is the address of an image: a full URL on a host that your users' browsers reach, or a path in the web container's document root.

| Setting | Where the logo appears | Default |
|---|---|---|
| `WL_LOGIN_IMAGE` | The login and password reset pages | `/assets/images/logo-horizontal-color.svg` |
| `WL_LEFT_SIDEBAR_LOGO` | The top of the sidebar, the app cards, and the loading and empty states | The FINOS Workspace logo |
| `WL_LEFT_SIDEBAR_LOGO_DARK` | The top of the sidebar in the dark theme | `WL_LEFT_SIDEBAR_LOGO` |
| `WL_FAVICON` | The icon in the browser tab | `/logo.svg` |

```bash
WL_LOGIN_IMAGE=https://cdn.example.com/brand/logo-color.svg
WL_LEFT_SIDEBAR_LOGO=https://cdn.example.com/brand/logo-dark-text.svg
WL_LEFT_SIDEBAR_LOGO_DARK=https://cdn.example.com/brand/logo-light-text.svg
WL_FAVICON=https://cdn.example.com/brand/favicon.svg
```

Use SVG where you can, so the logos stay sharp at every size. The sidebar has room for a horizontal logo; the login page shows the logo larger.

`WL_FAVICON` replaces the main tab icon. When the favicon is not an SVG, it also replaces the icon that Apple devices use for a bookmark. The 32-pixel PNG icon and the Windows tile icon stay the product's, so replace those as files, as the next section describes.

Without `WL_LEFT_SIDEBAR_LOGO`, the loading and empty states draw an animated FINOS Workspace mark that is part of the code.

## Files you replace

The app loads these files from the web container's document root, `/usr/share/nginx/html`. Mount a file of your own at the same path, with the same format and a similar size, and the app shows it:

| File | What it is |
|---|---|
| `/logo.svg` | The default tab icon, and the app icon that the manifest lists first |
| `/icons/favicon-32.png` | The 32-pixel tab icon |
| `/icons/apple-touch-icon.png` | The icon of a bookmark on an Apple device, 180 by 180 pixels |
| `/icons/android/android-launchericon-192-192.png` | The installed app's icon, and the Windows tile icon |
| `/icons/android/android-launchericon-512-512.png` | The installed app's large icon |
| `/icons/android/android-launchericon-maskable-512.png` | The installed app's icon on devices that crop icons to a shape |
| `/assets/images/logo-horizontal-color.svg` | The horizontal logo for the light theme, also on the two-factor setup page |
| `/assets/images/logo-horizontal-white.svg` | The horizontal logo for the dark theme, also on the two-factor setup page |
| `/assets/images/brand.png` | The picture of the built-in agent |
| `/assets/images/apps/save.png`, `/assets/images/apps/share.png` | The pictures on the empty Apps page |
| `/assets/images/features/grouping.png` | The picture that explains widget groups |
| `/assets/images/settings/theme_light.svg`, `theme_dark.svg` | The pictures of the two themes in the user's settings |

The two-factor setup page always shows the horizontal logos, not `WL_LOGIN_IMAGE`, so replace those two files for that page.

On Kubernetes, a ConfigMap or a volume can hold the files, mounted one by one with `subPath`, as [Create a theme](create-a-theme.md) shows for the theme stylesheet. With Docker Compose, add a bind mount to the `web` service:

```yaml
services:
  web:
    volumes:
      - ./brand/logo.svg:/usr/share/nginx/html/logo.svg:ro
      - ./brand/favicon-32.png:/usr/share/nginx/html/icons/favicon-32.png:ro
```

The installed app's icon list is fixed at build time; the files themselves can be replaced.

## Images of apps

The app gallery shows an image for each app that a backend offers. The backend sets it in `apps.json`, with `img` and, for each theme, `img_dark` and `img_light`. Each is the address of an image that the browser can load, often a route of the backend itself. [apps.json](../../reference/schemas/apps-json.mdx) describes the fields.
