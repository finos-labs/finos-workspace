---
title: Security and troubleshooting
sidebar_position: 4
---

import { BridgeValue } from "@site/src/components/Reference/bridge";

# Security and troubleshooting

This page says what the MCP Companion lets an AI tool do in your tab and what it does not, how the access is protected, how to stop an AI tool from using it, and what to do when a call fails. [MCP Companion](index.mdx) explains how the connection works, and [Connect your AI tool](../../quick-start/connect-your-ai-tool.mdx) connects one.

## What the AI tool can do

The AI tool works through your open tab, with your session and your catalog of widgets. It can do these things, which the tools of the [FINOS Workspace MCP server](../../reference/mcp/workspace-mcp.mdx) provide:

- Read a snapshot of the workspace, a dashboard and a widget.
- Create a dashboard and rename it.
- Add widgets from your backends, add notes and HTML widgets, change a widget and delete one.
- Move and resize widgets, and add, rename and remove the tabs of a dashboard.
- Move the browser to a dashboard or a tab.
- Fetch the current data of a widget.
- List, read and open apps, which creates a new dashboard from the app.
- List, add, change, refresh and remove the data backends of your account.
- Hand tasks to the agents that you configured.

## What the AI tool cannot do

- It cannot delete a dashboard.
- It cannot save, change or delete an app. You save an app in FINOS Workspace, as [Save a dashboard as an app](../apps/save-a-dashboard-as-an-app.mdx) describes.
- It cannot work without a connected tab. When no tab is connected, every call fails.
- It cannot do more than you can do in the app. The token identifies you, and it never gives more access.

## How the access is protected

- The AI tool holds a personal access token and never your session. FINOS Workspace keeps only a hash of the token, so nobody can show the token to you again.
- A token does not expire. It works until you revoke it. A person who has the token gets the same access to your dashboards as you, so keep it secret, as you keep a password.
- The API accepts a request only when its `Origin` header holds an allowed address, and it answers 403 otherwise.
- You can connect only one tab at a time. A second tab replaces the first.
- The commands run in your tab, so you see every change as it happens.
- When your web session stops, because you sign out or because it expires, the bridge closes.

## If a call fails

| What the AI tool gets | Cause |
|---|---|
| The status 403 with "Requests must come from an allowed origin" | The request has no `Origin` header, or the API does not allow the origin. |
| The status 401 | The `Authorization` header is missing, or the token is incorrect or revoked. For an incorrect token, the error is `invalid_token`, with a sentence that tells the AI tool to clear its tokens and connect again. |
| A tool result that says "<BridgeValue of="constants.noBrowserMessage" plain />" | No tab is connected. Open FINOS Workspace and turn on the companion. |
| A tool result with the error code `timeout` | The tab did not answer in <BridgeValue of="constants.commandTimeoutSeconds" unit="s" />. The error has `retryable: true`. |

The connection also stops when your web session stops. When you sign out, or when your session expires, the bridge closes. To continue, sign in and connect your tab again.

[FINOS Workspace bridge protocol](../../reference/protocols/workspace-bridge.mdx) gives all the limits and messages.

## Revoke a token

1. Open the dialog **MCP Companion**.
2. In the list **Active Tokens**, move the pointer over the token. A trash icon appears at the end of the row.
3. Select the trash icon. A message tells you that the token can no longer access this FINOS Workspace through MCP.

The token stops working immediately. The next request with the token gets the status 401.

Revoke a token in these conditions:

- You stop using an AI tool.
- You think that another person has the token.
- You give your computer to another person.
