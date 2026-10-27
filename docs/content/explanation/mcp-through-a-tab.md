---
title: About how outside AI hosts work with a dashboard
sidebar_position: 5
---

# About how outside AI hosts work with a dashboard

Workspace can be driven from an AI host that is not part of the app, such as a desktop assistant or a coding tool. The host connects to the Workspace MCP server and calls tools that read and change the user's dashboards. The design choice that surprises people is that none of these tools touches the dashboards directly. Each tool call is carried to a Workspace tab that the user has open, and the tab does the work. This page explains why, and what follows from it. The [Workspace MCP server](../reference/mcp/workspace-mcp.mdx) page lists the tools, and the [Workspace bridge protocol](../reference/protocols/workspace-bridge.md) gives the messages.

## Why the tab does the work

The dashboards that a user is looking at are state in the browser. The browser holds the widgets, their parameters, the layout and the data that the widgets have fetched, and it saves a copy to the API from time to time. A server that wanted to change a dashboard directly would work on the saved copy, and the open tab would then either overwrite the change on its next save or never show it. A tool that changes a dashboard has to change what the user sees, so it has to act on the live copy, and the live copy is in the tab.

There is a second reason. Everything that a dashboard can do, such as fetching a widget's data from a backend with the connection's credentials, validating parameters or applying a layout, is implemented once in the web app. A server-side version would need its own copy of that logic and would drift from it. Sending the command to the tab reuses the code that the app already runs for the user, so the result is the same as if the user had made the change by hand.

The Copilot uses the same tools for the same reason, as [About how the Copilot answers](how-the-copilot-answers.md) explains. For the Copilot the browser is already on the other end of the conversation. For an outside host the API has to find the browser, and the bridge is how it does.

## How the API finds the tab

A tab that wants to be driven opens a bridge: it asks the API for a session and then connects a WebSocket to it. The API keeps one bridge session for each user, so a tab that connects replaces the user's earlier one. When a tool call arrives from an MCP client, the API looks up the user from the client's token, finds the user's bridge, sends the command to the tab and waits for the answer. If several API processes are running, the process that received the call may not be the one that holds the tab's socket, and then the processes pass the call to each other through Valkey.

The tab answers each command with a result that says whether it worked, a message, and the data. The API waits for thirty seconds. If no answer comes, the call fails with a timeout that the client may retry, and if no tab is connected the call fails at once with a message that says so. A command that is sent again with the same identifier does not run twice, because the API remembers recent results.

## What follows from the design

**A tab has to be open.** An outside host can do nothing for a user whose browser is closed, and it acts on whichever tab last opened the bridge. That is a limit of the design, and it also means that the changes appear in a tab that the user has open.

**The user's permissions apply.** The tab runs the command with the user's session and the user's own catalog of widgets, so the host can do what the user can do in the app. The MCP client's token proves who is asking and never widens what is allowed.

**Tools are the same everywhere.** The commands that the tab understands are the ones the app uses for the Copilot's own tools and for the MCP server, so a behavior that a user sees through one door is the behavior through the other.

**The credentials stay small.** The MCP client holds a personal access token, which the user can revoke without touching anything else, as [About sessions and tokens](sessions-and-tokens.md) explains. It never holds a session.
