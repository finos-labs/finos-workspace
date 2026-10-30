---
title: The MCP tool link
sidebar_position: 4
---

import { McpLinkActive, McpLinkCites } from "@site/src/components/Reference/cases";
import { McpToolFields } from "@site/src/components/Reference/schemas";

# The MCP tool link

A widget can name one MCP tool of its own backend. The AI agent uses that tool to query the backend for the data that the widget shows. The key is `mcp_tool`, and every widget type accepts it.

## Fields

The key `mcp_tool` of a widget definition has these fields. They come from the widgets.json schema, which [widgets.json](../schemas/widgets-json.mdx) describes in full. A widget that sets `disableRetrievalForCopilot` cannot have `mcp_tool`, and the contract checks that every `$` argument names a parameter of the widget.

<McpToolFields />

## When the link is active

The web app puts the link into its request to the agent only when the server and the tool are available. This table comes from `activeMcpLink` in `frontend/src/lib/utils/mcpLink.ts`.

<McpLinkActive />

## How a call is attributed

`citeMcpCall` in the same file decides which widget an answer cites for a call of the tool.

<McpLinkCites />

[Link a widget to an MCP tool](../../tutorials/build-a-backend/link-a-widget-to-an-mcp-tool.md) explains how a backend declares its servers and what the agent does with the link.
