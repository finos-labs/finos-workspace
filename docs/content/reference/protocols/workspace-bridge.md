---
title: Workspace bridge protocol
sidebar_position: 6
---

# Workspace bridge protocol

The Workspace MCP server does not hold a user's dashboards. The dashboards live in the user's browser, so every tool of the server works by sending a command to a Workspace tab and waiting for the tab's answer. The channel between the server and the tab is the bridge. This page describes how a tab opens a bridge session, the messages that the API and the tab exchange over a WebSocket, the commands that the tab executes, and the limits that apply. The server side is `backend-api/backend/routers/app/workspace_mcp/`, and the browser side is `frontend/src/components/AI/WorkspaceBridgeConnectionManager.tsx` and `workspaceBridgeProtocol.ts`.

## Opening a session

A tab opens a bridge session in two steps. The user must be signed in, and the tab must have the companion mode of the Workspace MCP turned on.

1. The tab sends `POST /app/workspace-mcp/bridge/session/start` with its `client_name` and, optionally, the `current_dashboard_id` and `current_tab_id` that it shows. The API answers with the new `session`, which holds a `session_id`, and with a `websocket_url` of the form `wss://<api host>/app/workspace-mcp/bridge/ws?session_id=<session id>`.
2. The tab opens that WebSocket. The browser sends the web session cookie with the request, and the API also requires an allowed origin, as [Workspace API](../http-api/workspace-api.mdx) describes. The API closes the socket with code 1008 when the cookie is missing or invalid, or when the session id does not belong to the signed-in user.

Each user has at most one active bridge session. Starting a new session replaces the old one: the API closes the old socket and fails the commands that were waiting for it with the message "Workspace browser session replaced". The API keeps a started session for 300 seconds, so a tab that does not connect within that time has to start a new session.

When the socket is accepted, the API sends the first event, `session_ready`, and the session is live.

## Messages over the WebSocket

Every message is a JSON object with a `type` field. The API validates the messages that the browser sends, and it closes the socket with code 1008 when the web session ends.

**From the API to the tab:**

| `type` | Fields | Meaning |
|---|---|---|
| `session_ready` | `session` | The bridge is connected. The session holds the `session_id`, the `client_name` and the current dashboard and tab. |
| `command_request` | `command`, an object whose `command` field names the command and whose `request_id` identifies the call. | An MCP client wants the tab to do something. |
| `pong` | None. | The answer to a `ping`. |
| `error` | `error`, with a `code` and a `message`. | The API refuses the connection, for example with the code `unauthorized`. |

**From the tab to the API:**

| `type` | Fields | Meaning |
|---|---|---|
| `command_result` | `result`, as described below. | The tab finished a command. |
| `ping` | None. | A heartbeat. The tab sends one every 15 seconds. |
| `session_context_changed` | `session`, with `current_dashboard_id` and `current_tab_id`. | The user moved to another dashboard or tab. The API keeps the new context for the MCP tools. |

A command result has these fields:

| Field | Meaning |
|---|---|
| `ok` | Whether the command succeeded. |
| `command` | The name of the command. |
| `request_id` | The identifier of the request that this result answers. |
| `message` | A sentence that describes the outcome. |
| `data` | The result, which depends on the command. |
| `warnings` | A list of warnings. |
| `error` | Present when `ok` is false. It has a `code`, which is `invalid_request`, `unauthorized`, `unavailable`, `timeout`, `command_failed` or `unknown`, a `message`, optional `details`, and `retryable`, which tells the client whether it can try again. |

## Commands

The `command_request` message carries one of 20 commands. The MCP tools of the same name wrap them, and [Workspace MCP server](../mcp/workspace-mcp.mdx) lists each tool with its arguments. Two commands have no tool of their own: `get_widgets_schema` returns the organization's composed `widgets.json` schema and serves the resource `workspace://specs/widgets-json-schema`, and `execute_agent_tool` runs a tool of a connected MCP server through the tab.

| Command | What the tab does |
|---|---|
| `get_workspace_snapshot` | Returns a compact snapshot of the dashboards, the current context and the skills. |
| `list_available_widgets` | Lists the widgets that the session can use, optionally for one `origin` or `backend_id`. |
| `get_widget_schema` | Returns the closed schemas for one widget's `data_args` and `ui_args`. |
| `get_widgets_schema` | Returns the composed `widgets.json` schema. |
| `get_params_options` | Looks up the valid values of widget parameters. |
| `get_widget_data` | Fetches the data of one or more data sources. |
| `read_widget` | Reads one widget of a dashboard. |
| `create_widget` | Creates a widget on a dashboard. With `dry_run` it only validates. |
| `update_widget` | Changes a widget. With `dry_run` it only validates. |
| `delete_widget` | Deletes a widget. |
| `manage_dashboard` | Creates, reads or updates a dashboard (`operation` is `create`, `read` or `update`). |
| `update_dashboard_layout` | Moves or resizes a widget on the dashboard grid. |
| `manage_navigation_bar` | Creates or changes the navigation tabs of a dashboard. |
| `add_generative_widget` | Adds a markdown note or an HTML widget from inline content. |
| `assign_tasks_to_agents` | Assigns tasks to configured external agents. |
| `execute_agent_tool` | Runs a tool of a connected MCP server, named by `server_id` and `tool_name`, with `parameters`. |
| `get_skill_content` | Loads one skill from the skill library, by `slug`. |
| `navigate_workspace` | Moves the tab to a dashboard or an inner tab. |
| `manage_backends` | Lists, adds, updates, refreshes or removes data backends. |
| `manage_apps` | Lists, reads or instantiates apps, which are dashboard templates. |

## Limits and failures

| Limit | Value |
|---|---|
| Time that the API waits for a command result | 30 seconds. After that the result is `ok: false` with the error code `timeout` and `retryable: true`. |
| Liveness | The tab pings every 15 seconds, and each ping refreshes the session's presence for 45 seconds. |
| No connected tab | When no tab is connected, the tool call fails with the message "No active Workspace browser connected". A command that is already waiting when the tab disconnects or is replaced fails with the error code `unavailable` and `retryable: true`. |
| Reconnects | After a lost connection the tab retries up to 3 times, waiting 1 second, then 2 seconds, then 4 seconds. It then reports that the connection failed. |
| Repeated requests | The API remembers the results of the last 2,048 requests, so a command that is sent again with the same `request_id` receives the stored result and does not run twice. |

The API runs several worker processes, and the tab's socket is open on only one of them. A tool call that arrives at another worker is forwarded to the worker that holds the socket through the shared Redis-compatible store, and the result comes back the same way, so the MCP client does not need to know which worker holds the tab.
