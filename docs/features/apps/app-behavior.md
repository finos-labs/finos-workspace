---
title: App behavior
sidebar_position: 3
---

# App behavior

An app is a template that a backend offers: a set of tabs of widgets, with their layout and their starting values, which a user can open as a dashboard. A backend lists its apps in a file named `apps.json`, at the same address as its `widgets.json`. The file is an array, and each element describes one app. The widgets that an app places are the ones that [widgets.json](../../reference/schemas/widgets-json.mdx) defines.

## What FINOS Workspace does with an app

**It lists the app.** When a user connects a backend or refreshes it, the web app reads `apps.json` and validates every element against the schema below. An element that breaks the schema is left out, and the test of the connection fails and reports the problems with the path of each one. FINOS Workspace also warns about each layout item whose widget `widgets.json` does not define, with the text "Missing widgets used in tab". FINOS Workspace gives each valid app the id `custom-<backend id>-<name in lower case, with hyphens>`, and it keeps your `templateId` when you set one. Roles name the app by its `templateId`, as [Give a role access to data](../administration/give-a-role-access-to-data.md) describes, so set a `templateId` that never changes. A relative address in `img`, `img_dark` or `img_light` is resolved against the backend's address, and the card shows `img_dark` or `img_light` according to the theme, and `img` otherwise.

**It opens the app as a dashboard.** When a user selects the app's card, FINOS Workspace creates a dashboard from it. The dashboard has one tab for each entry of `tabs`, and it shows a Navigation Bar widget with the tabs' names when the app has more than one tab or a layout item with the id `navigation_bar`. Each layout item places the widget that its `i` names, at the position `x`, `y`, `w` and `h` of a grid of 40 columns. A height of 1 places the widget minimized. The item's `state` sets what the widget starts with: the values of its parameters, their order, and the text, page or plugin configuration that the widget keeps. A layout item whose widget the backend does not define is left out, and the dashboard opens with the other widgets.

**It names the dashboard.** The dashboard has the name of the app. When the user already has a dashboard from the same app, the new one is named like the app with a number in brackets, such as `Sales overview (2)`. A dashboard that was created from the app and that the user has not changed yet is opened again instead of creating another, when the user selects the app's card from the Apps page.

**It locks the dashboard when the app asks for it.** When an app sets `allowCustomization` to `false`, the dashboard that FINOS Workspace creates from it is locked, and it stays locked. On a locked dashboard a user cannot add, remove, duplicate or move widgets, cannot copy a widget into it, and cannot edit the tabs of its Navigation Bar. The buttons for these actions are disabled, and the Agent and the MCP clients receive an error that names the lock when they try. The user can still change the parameters of the widgets, switch between tabs and resize widgets. A copy of a locked dashboard is locked too, and so is every further dashboard that the user opens from the app, for example to look at other parameters. An app that sets `allowCustomization` to `true`, or leaves it out, creates dashboards that the user can change freely.

**It links the parameters.** Each element of `groups` creates a group, which [Link the parameters of widgets](../widgets/link-the-parameters-of-widgets.md) describes. A widget joins a group when its layout item lists the group's name in `groups`, or when the group lists the widget's key in `widgetIds`. The group's `defaultValue` is the value that the linked widgets start with, and the text `$currentDate` with a modifier stands for a date relative to today.

**It prepares the Agent.** When the app sets `selected_agent` and the user has an agent with that id or name, the Agent selects that agent and opens its panel. The `prompts` of the app are the suggestions that the Agent shows to the user of a dashboard that was created from the app. When the app also names an agent, the list of suggestions opens by itself.

**It connects the MCP servers.** When a user connects the backend, FINOS Workspace adds each server of `mcpServers` to the user's MCP servers. A server whose `authType` is `token` starts enabled only when the connection sends an `Authorization` header. A widget refers to a server by its `name` in `mcp_tool.mcp_server`, as [The MCP tool link](../../reference/protocols/mcp-tool-link.md) describes, and FINOS Workspace refuses the widget when no app of the backend declares that server. Apps of one backend may reuse a server's name only for the same address.

## Plugin widget configuration

A layout item of an `apps.json` template can set a plugin widget's configuration in `state.storage.plugin.config`. When a backend loads, FINOS Workspace reports an app and leaves it out if one of its layout items sets this configuration for a widget of a built-in type, or sets a value that the plugin's settings refuse (`PluginConfig_<type>`). The report names the path of each problem. When a user opens an app, FINOS Workspace merges the template's state into the widget's storage, and the plugin widget reads the configuration from there.

[apps.json](../../reference/schemas/apps-json.mdx) lists every field of an app.
