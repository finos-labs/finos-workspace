---
title: How to make a widget readable by the Copilot
sidebar_position: 2
---

# How to make a widget readable by the Copilot

The Copilot can answer a question about a widget only after it has found the widget and read its data. A widget that draws a chart or a page, such as an `html` widget, gives the Copilot markup and no numbers unless you do something about it. This guide shows how to help the Copilot find a widget, how to give it the rows behind a view, how to link a widget to a query tool of your backend, and how to keep a widget away from the Copilot. The keys are described in [widgets.json](../../reference/schemas/widgets-json.mdx), and [Widget data for the agent](../../reference/protocols/ines-widget-data.mdx) follows a read from the tool call to the reply.

## How the Copilot reads a widget

The Copilot searches the widgets of the dashboard, which it finds by their names and descriptions, and then it asks the browser to fetch the data of the ones that it wants. The browser builds the same request that the widget makes, with the same parameters and the user's own connection, so the Copilot reads what the widget shows. What the Copilot makes of the answer depends on its shape:

- A JSON list of objects becomes a table that the Copilot can query with SQL and chart.
- Text, Markdown, HTML and a JSON object are read as text. The Copilot does not strip HTML, so the markup counts against what it can read.
- A PDF or a Word file is searched in passages, and an image is shown to the model as an image.

A user sees the reads as steps of the answer. For a question about one widget, the steps are that the Copilot looks for a widget, finds some matches, loads the widget and loads its data, and then it answers and cites the widget.

## Write a description that the Copilot can use

Two texts help the Copilot choose the right widget. The `description` of the widget is the first, and it should say what the widget shows, for which entities and over which period, in the words of the people who ask. "Open and closed support tickets for one team over a period" tells the Copilot more than "Tickets". The key `description` of a parameter is the second. FINOS Workspace shows it as help on hover, and the Copilot reads it as well, so say what values the parameter takes and what each one does:

```json
{ "paramName": "period", "type": "text", "label": "Period", "description": "week or month", "value": "month" }
```

Parameters matter for another reason. When a question asks for a different period, the Copilot may pass new values for the widget's parameters, and FINOS Workspace refuses a name that the widget does not declare and tells the Copilot which parameters it has.

## Give the Copilot the rows behind a view

An `html` widget and a plugin widget answer with a view. Set `raw` to `true` on the definition, and the same endpoint can also answer with the data. The widget below is an HTML page of bars, and its endpoint answers `raw=true` with the rows:

```json
{
  "ticket_volume": {
    "name": "Ticket volume",
    "description": "Tickets opened per day as a bar chart",
    "type": "html",
    "endpoint": "/volume",
    "raw": true,
    "data": { "rawDataKey": "results.records" },
    "params": [{ "paramName": "days", "type": "number", "label": "Days", "value": 5 }]
  }
}
```

When the Copilot needs the data, FINOS Workspace sends the widget's request again with `raw=true` added to the query, and the endpoint answers with JSON such as this:

```json
{ "results": { "records": [ { "day": "day-1", "opened": 3 }, { "day": "day-2", "opened": 5 } ] } }
```

The key `data.rawDataKey` names the path of the rows in that answer, and without it FINOS Workspace reads the field `results`, or else the whole answer. A list of objects becomes a table, so the Copilot answers from numbers. Asked how many tickets were opened on the third day, the Copilot loads the widget, receives the rows and answers with the value of that row. The request that it sent carried `raw=true`, and it did not carry the `theme` parameter that the widget's own requests carry.

Three more points apply to `raw`:

- The name `raw` is reserved for `html` and plugin types, so a widget of those types cannot have a parameter of that name. A backend has to answer the plain request with the view and the `raw=true` request with the rows.
- The card of the widget gets a button with a database icon that switches between the view and its rows, for people as well as for the Copilot. With `data.rawType` you name a plugin type that shows the rows. Without it an `html` widget shows them as a table.
- `data.rawDataKey` and `data.rawType` are valid only together with `"raw": true`.

[Widget rows](../../reference/protocols/raw-rows.md) describes the key in full.

## Link a widget to a query tool

Some widgets show data that the Copilot can fetch better with a tool than with a plain request, for example when a database sits behind a query tool of your own MCP server. The key `mcp_tool` links the widget to such a tool, so that the Copilot knows which tool answers questions about the data that the widget shows.

1. Declare the MCP server in the `mcpServers` list of an app in the backend's `apps.json`, with a `name`, a `description`, a `url` and an `authType`.
2. Add `mcp_tool` to the widget. The key `mcp_server` is the name that you declared, `tool_id` is the name of the tool on that server, and `args` says how the widget's parameters fill the tool's arguments:

   ```json
   "mcp_tool": { "mcp_server": "Team data", "tool_id": "get_team_report", "args": { "team_id": "$team", "period": "$period" } }
   ```

3. Connect the backend. FINOS Workspace registers each declared server once for the user.

The link takes effect for a user only when the server is connected and enabled for them, the tool is turned on and granted by their roles, and MCP tools are turned on for the Copilot. Otherwise the widget behaves as if it had no link. When the Copilot calls the tool, FINOS Workspace cites the widget whose arguments match the call. [The MCP tool link](../../reference/protocols/mcp-tool-link.md) lists the rules, and [How to connect an MCP server](../use/connect-an-mcp-server.mdx) shows the user's side.

## Keep a widget away from the Copilot

Set `disableRetrievalForCopilot` to `true` on a widget whose data the Copilot must not read, for example because it holds personal data. The widget stays on the dashboard, but it does not appear in the list of widgets that the Copilot searches, a user cannot add it as context or mention it with `@`, and the FINOS Workspace MCP server leaves it out of the widgets that it lists as available. A widget with this key cannot have an `mcp_tool`.

## Check it

1. Connect the backend with Validate widgets set to Yes, as [How to review and debug a backend](review-and-debug-a-backend.md) describes, and add the widget to a dashboard.
2. Open the Copilot and ask a question that only the widget's data can answer.
3. Open Step-by-step reasoning. The Copilot should find the widget and show the line that the data was loaded.
4. Look at the requests that your backend received. A widget with `raw` should see one request with `raw=true` for the question.
5. When the answer is wrong or empty, ask the Copilot to name the widget that it used. A widget whose description does not say what it shows is the usual cause, and a backend that answers `raw=true` with the view is the second.
