---
title: Name and text
sidebar_position: 1
---

# Name and text

These settings put your product's name and contact details in the app. Set them on the web container and restart it. [Web app configuration](../../reference/configuration/web-app.mdx) lists their defaults.

## Product name, description and keywords

| Setting | What it changes | Default |
|---|---|---|
| `WL_NAME` | The title in the browser tab, the title of each page (for example "Dashboards \| Your name"), the alternative text of your logos, and the title in link previews | `FINOS Workspace` |
| `WL_DESCRIPTION` | The description that search engines and link previews show | A description of FINOS Workspace |
| `WL_KEYWORDS` | The keywords of the page, separated by commas | Keywords about FINOS Workspace |

```bash
WL_NAME="Acme Analytics"
WL_DESCRIPTION="Acme's workspace for research and portfolio analytics."
WL_KEYWORDS="Acme, analytics, research"
```

The app writes these values into the page when it starts. A crawler or link preview that does not run JavaScript reads the page as it was built instead, and that page still names FINOS Workspace. To change what such a reader sees, change the title and meta tags in `frontend/index.html` and build the web image.

When `WL_NAME` is not `FINOS Workspace`, or a sidebar logo is set, the sidebar shows "Powered by FINOS Workspace" under your logo. It cannot be switched off.

## The installed app

Users can install FINOS Workspace on a device as a progressive web app. Its name, short name and description come from the build, not from the container, because the build writes them into the app's manifest:

| Build variable | What it changes |
|---|---|
| `VITE_WL_NAME` | The app's name on the device |
| `VITE_WL_SHORT_NAME` | The name under the app's icon |
| `VITE_WL_DESCRIPTION` | The app's description |

Set them in the build environment, such as `frontend/.env`, and build the web image. The manifest also takes its theme and background colors from the FINOS palette at build time. The icons are files, which [Logos, icons and images](logos-icons-and-images.md) lists.

## Support and documentation

| Setting | What it changes | Default |
|---|---|---|
| `SUPPORT_EMAIL` | The support address on the login page and on the Agent's error screen | None, so nothing is shown |
| `DOCS_URL` | The address of the documentation that the app links to | None |
| `UI_SHOW_EXTERNAL_DOCUMENTATION_LINKS` | Whether the app shows links to the documentation | `True` |
| `UI_SHOW_HELP_DOCUMENTATION` | Whether the app shows its help pages | `True` |
| `AI_COPILOT_DOCUMENTATION_LINKS` | Whether the Agent shows links to the documentation | `True` |
| `UI_SHOW_CHANGELOG` | Whether the app shows the product's changelog | `True` |

Point `DOCS_URL` at your own documentation, or switch the links off. The changelog's text is the product's, so a rebranded deployment usually hides it.

## Default theme

`UI_DEFAULT_THEME` is `dark` or `light`, the theme that a user sees until they choose one in their settings. The default is `dark`.

## Names of features

Some features carry names that are not settings:

- The built-in agent is shown as **Agent**. `AI_COPILOT_DEFAULT_COPILOT=False` hides it, for example when you offer only agents of your own.
- The agent's tools server is listed under the name that `DEFAULT_MCP_SERVERS` gives it, **Agent Tools** in the Compose file. Change `name` in that variable to rename it.
- The MCP Companion dialog is titled "FINOS Workspace MCP Companion". `UI_SHOW_COMPANION_MCP_MODE` decides whether the app offers it.

The other names are in the code: [Brand elements in the code](brand-elements-in-the-code.md) lists them.
