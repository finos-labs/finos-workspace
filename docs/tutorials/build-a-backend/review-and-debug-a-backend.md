---
title: Review and debug a backend
sidebar_position: 12
---

# Review and debug a backend

This guide finds out why a backend does not show what you expect: no widgets, a missing app, a widget that fails or a connection that stays inactive. FINOS Workspace checks a backend every time it connects or refreshes it, and it reports what it finds. You read those reports, fix the backend and test again.

## Test the backend

1. Select Connections in the sidebar. To check a backend that you have not added yet, select Connect Backend. To check one that you have added, open it with Edit backend.
2. Enter the Name and the Endpoint URL, and add the credential under Add Authentication when the backend needs one.
3. Set Validate widgets to Yes when you also want FINOS Workspace to check the routes, as [Check the routes](#check-the-routes) describes.
4. Select Test.

The result has up to three notices. A green notice titled Test successful counts what FINOS Workspace found, for example "2 Widgets found, 0 Apps found, 0 Prompts found", and it adds the number of failed widgets and of MCP servers when there are any. A yellow notice titled Warning lists things that FINOS Workspace skipped without failing the test. A red notice titled Error lists what made the test fail, and for a new connection Add stays disabled until a test succeeds. Fix the backend and select Test again, as often as you need. FINOS Workspace requests each file of the backend with a timeout of one minute.

This is what the notices of a backend with several problems look like. The first widget has a key that the contract does not know and a parameter without a name, the second one has a type that no plugin renders, and the second app has no name:

```text
Warning
App warnings:
[widgets.json]: Not shown, no widget plugin enabled for your organization renders their type: weird_type
[widgets.json]: Widget types you can use: html, iframe, markdown, newsfeed, pdf.
Broken app (tab: main):
[widgets.json]: Missing widgets used in tab ghost

Error
Bad params (bad_params):
 [params/0]: missing paramName
App errors:
Unknown App:
[name]: Invalid input (expected string)
```

## The backend cannot be loaded

When the request for `widgets.json` fails, the Error notice names the cause and ends with the HTTP status, such as `(Status: 404)`:

| Status | What the notice says | What to check |
|---|---|---|
| 401 or 403 | Authentication failed, and a hint to check the Authorization header. | The credential of the connection, and what the backend demands. |
| 404 | The widgets.json file was not found on the server. | The Endpoint URL: the backend has to serve `/widgets.json` below it. |
| 422 | The server rejected the request. | The credential, and any other requirement of the backend. |
| 500 or more | A server error occurred. | The backend's own log. The notice also appears with status 500 when the browser could not reach the backend at all. |
| 23 | The request timed out. | Whether the backend answers within one minute. |
| Anything else | Unable to find a widgets.json file. | The console of your browser, where the details are logged. |

A backend on `localhost` or `127.0.0.1` gets a section Troubleshooting localhost, which lists the three usual causes. [Connect a backend](../../features/data-backends/connect-a-backend.md) describes them, and [Requests that a widget sends](requests-from-a-widget.md#cors) lists what the backend must answer so that the browser may call it.

## A widget does not appear

The web app checks every widget definition against the contract that [widgets.json](../../reference/schemas/widgets-json.mdx) describes. The Error notice reports a widget that breaks it, with the widget's name and key and then each problem on a line of its own: the path inside the definition in square brackets, and a sentence that says what is wrong. Read the path first, because it points at the key that you need to change. A key that the contract does not define is not a problem of this kind, because the web app ignores it, as the next section describes. A file that is not an object of widgets is reported with the text "Invalid format", followed by what the web app expected and what it received.

A widget that breaks the contract makes the test fail. Once the backend is connected, a refresh keeps the valid widgets and apps and leaves the invalid ones out, and it shows a warning toast titled "Invalid items in" and the backend's name. The button Inspect of the toast opens each invalid item with its JSON and its problems.

Two more causes make a valid widget disappear, and the Warning notice names both. A widget whose `type` no widget plugin of your organization handles is not shown, and the notice lists the types that you can use. A widget whose type a plugin handles but that no plugin available to you renders is not shown either.

## Fields that FINOS Workspace does not recognize

A key that the web app does not know, in a widget of `widgets.json` or in `apps.json`, is not an error in the test: the web app loads the widget or the app without the key. When the backend loads, FINOS Workspace shows a warning toast titled "Unrecognized fields" and the backend's name, which lists the keys and where they sit. The toast has a Copy button for the list, and a link to the reference when the deployment sets a documentation address.

## An app does not appear

FINOS Workspace reads `apps.json`, and when the backend has no such file, it reads `templates.json` instead. An `apps.json` that holds a single object instead of an array counts as an array with that one object. Each element has to satisfy the schema of [apps.json](../../reference/schemas/apps-json.mdx). The Error notice lists the elements that do not under the heading "App errors", with the path of each problem, and the app does not appear. The notice also reports these problems:

- A plugin widget whose configuration in `state.storage.plugin.config` the plugin's settings refuse, or a built-in widget that sets such a configuration.
- An MCP server whose name another app of the backend uses for a different address.
- A widget whose [`mcp_tool.mcp_server`](../../reference/protocols/mcp-tool-link.md) names a server that no app of the backend declares.

The Warning notice reports a layout item whose widget `widgets.json` does not define, with the text "Missing widgets used in tab" and the ids. The dashboard then opens without that widget.

## Check the routes

Setting Validate widgets to Yes makes FINOS Workspace send an `OPTIONS` request to every route that the widgets use: the endpoint of each widget, the option lookups of its parameters and the endpoint of each form. FINOS Workspace checks the routes only when the widgets themselves are valid, so fix the problems above first.

First FINOS Workspace asks for a path that cannot exist. The check goes on only when the backend answers that request with 404, because a backend that answers every `OPTIONS` request would pass every route. Otherwise the Warning notice says "Routes not checked" and gives the reason, which is either that the backend did not answer `OPTIONS` at all, usually because its CORS settings do not allow it, or that it answers for paths that do not exist.

After that, each route that answers 404 is listed as "no such route (404)", and each route that gives no response is listed as "no response". Both make the test fail, with the widget and the path of the route. Routes that the widgets do not use, such as the one that serves a picture, are not checked.

## A widget loads but shows an error

The routes can be right while a request still fails. A widget that cannot build its request shows the problem in its place, and it names the parameter, for example that `team` needs a value. A request that the backend rejects shows the backend's answer. Open the network tab of your browser to see the exact request, and compare it with [Widget requests](../../reference/protocols/widget-requests.mdx), which lists how FINOS Workspace builds the URL, the headers and the body.

## The connection is inactive

A connection turns inactive when its test fails. The Connections page then lists it under Inactive, and FINOS Workspace says "Backend marked as inactive". Edit the connection, fix the cause as above, test it, and save it. When it works again, the message says "Backend activated successfully".
