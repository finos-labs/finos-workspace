---
title: Plugin
sidebar_position: 7
---

# Plugin

A plugin adds a new type of [widget](widget.md), such as a chart. It is a package that someone builds outside the FINOS Workspace repository.

- The person who deploys FINOS Workspace places the package on the server.
- A superuser reviews and approves it.
- An organization's [admin](admin.md) enables it, and roles grant it to people.
- Each widget of a plugin runs in a sandboxed frame and never receives the user's credentials.

## Where to go

- **Use it:** [Plugins](../features/plugins/index.md)
- **Build it:** [Build your first widget plugin](../tutorials/plugins/build-your-first-widget-plugin.md)
- **Look it up:** [Plugin package and manifest](../reference/plugins/package-and-manifest.mdx), [Plugin frame policy](../reference/plugins/frame-policy.mdx)
