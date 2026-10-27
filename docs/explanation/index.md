---
slug: /explanation
title: Explanation
sidebar_label: Overview
sidebar_position: 0
---

# Explanation

Explanation gives the background. It describes how the parts fit together and why they are built the way they are, it discusses alternatives and trade-offs, and it compares the parts to systems that you may already know. It contains no steps and no exhaustive lists. To learn by doing, use the [tutorials](/tutorials). For a task, use the [how-to guides](/how-to). For exact details, see the [reference](/reference).

These pages explain the design of Workspace:

- [About the architecture of Workspace](architecture.md) describes the parts, what each is responsible for and why the browser sits at the center.
- [About how the Copilot answers a question](how-the-copilot-answers.md) explains who runs the tools, what the model sees and how the agent keeps a user's data from leaking.
- [About sessions and tokens](sessions-and-tokens.md) explains why each credential exists and where it is kept.
- [About roles and access](roles-and-access.md) explains user types, roles, how several roles combine and how sharing is approved.
- [About how outside AI hosts work with a dashboard](mcp-through-a-tab.md) explains why every tool of the Workspace MCP server runs in a browser tab.
- [About widget plugins](widget-plugins.md) explains what a plugin is, how it runs and who is responsible for each step.
- [About the widget plugin security model](widget-plugin-security.md) explains what the plugin sandbox defends and what it leaves to others.
- [About styling and themes](styling-and-themes.md) explains how the web app's colors are organized and why a theme can be a single stylesheet or a saved preset.
