---
title: Agent
sidebar_position: 5
---

# Agent

The Agent answers questions about your dashboards. It is the built-in agent, which runs a language model in a loop of tool calls.

- The Agent reads the data of a [widget](widget.md) through your browser, with your own connection to the [connector](connector.md).
- You can attach files, dictate a question, save prompts, add skills, and give the Agent tools from MCP servers.
- The roles of an [admin](admin.md) decide which models and tools a person can use.
- The Agent runs in its own service, and your browser runs the tools that need your session.

## Where to go

- **Use it:** [Ask the Agent about a dashboard](../features/agent/ask-the-agent-about-a-dashboard.md), [Attach files to a question](../features/agent/attach-files-to-a-question.mdx), [Use and write skills for the Agent](../features/agent/use-and-write-skills.mdx)
- **Set it up:** [Choose the Agent's model and provider](../features/agent/choose-the-agent-model.mdx)
- **Look it up:** [Agent query protocol](../reference/protocols/agent-query.mdx), [Agent HTTP API](../reference/http-api/agent-api.mdx), [Agent MCP server](../reference/mcp/agent-mcp.mdx)
