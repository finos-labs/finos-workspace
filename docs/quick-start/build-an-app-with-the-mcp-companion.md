---
title: Build an app with the MCP Companion
sidebar_position: 3
sidebar_label: "3. Build an app with the MCP Companion"
---

# Build an app with the MCP Companion

In about 10 minutes your AI tool builds a dashboard from the widget of your Quick Start backend and a note, arranges the two widgets side by side, and you save the dashboard as an app.

You need:

- The backend and the dashboard from [Quick Start](index.mdx): the backend `Quick start` is connected and offers the widget **Portfolio summary**.
- An AI tool that is connected as [Connect your AI tool](connect-your-ai-tool.mdx) describes, with your tab connected. The icon of the companion in the header of the sidebar is green.

## 1. Ask what is in the workspace

Ask your AI tool:

> Take a snapshot of my FINOS Workspace and list the widgets that are available.

The AI tool calls `get_workspace_snapshot` and `list_available_widgets`. The answer names the dashboard that you made in Quick Start, with its widget, and it lists the widget `portfolio_summary` of the backend `Quick start`. The answer includes an `origin` for each widget. The AI tool passes it unchanged when it adds the widget.

## 2. Create a dashboard

Ask your AI tool:

> Create a dashboard called Portfolio overview.

The AI tool calls `manage_dashboard` with the operation `create`. Your tab opens the new dashboard, which is empty, and the sidebar lists it under **My Dashboards**.

## 3. Add the widget

Ask your AI tool:

> Add the Portfolio summary widget to this dashboard.

The AI tool calls `get_widget_schema` to read what the widget accepts, and then `create_widget`. The widget appears on the dashboard with its four cards.

## 4. Add a note

Ask your AI tool:

> Add a note called Notes with the text "Figures are sample data."

The AI tool calls `add_generative_widget` with the type `note`. A markdown widget called **Notes** appears on the dashboard.

## 5. Arrange the widgets

The layout grid is 40 columns wide, so a half is 20 columns. Ask your AI tool:

> Put Portfolio summary on the left half of the dashboard and the note on the right half.

The AI tool calls `update_widget_layout` for each widget. The two widgets now stand side by side. To check the result, ask the AI tool to read the dashboard. The answer lists the position and the size of each widget.

## 6. Save the dashboard as an app

The MCP server has no tool that saves an app, so you do this step in FINOS Workspace.

1. Right-click **Portfolio overview** in the sidebar, or select the three dots next to it, and choose **Save App**. The dialog **Save App from Dashboard** opens.
2. Check the **Name**, which starts as `Portfolio overview`.
3. In **Description**, type `Portfolio figures with a note`.
4. Select **Save**.

A message says "App created successfully!". [Save a dashboard as an app](../features/apps/save-a-dashboard-as-an-app.mdx) describes the other fields of the dialog, such as the suggested prompts.

## 7. Open the app

Ask your AI tool:

> List my apps, and then create a dashboard from the app Portfolio overview.

The AI tool calls `manage_apps` with the operation `list`, and the answer includes the app `Portfolio overview` with the type `saved`. It then calls `manage_apps` with the operation `instantiate`. Your tab opens a new dashboard with the same two widgets in the same places.

You can also select **Apps** in the sidebar and then the card of the app.

## If a step fails

- The AI tool says that no browser is connected: open FINOS Workspace and check that the icon of the companion is green. [Security and troubleshooting](../features/mcp-companion/security-and-troubleshooting.md#if-a-call-fails) lists the other errors and their causes.
- The widget is not in the list: check that the backend is still running and that **Connections** shows it as connected.

## Next

- [Offer an app from your backend](../tutorials/build-a-backend/offer-an-app-from-your-backend.mdx) writes the app into the backend, so that everybody who connects the backend gets it.
- [FINOS Workspace MCP server](../reference/mcp/workspace-mcp.mdx) lists every tool that the AI tool can call.
- [App](../concepts/app.md) says what an app is.
