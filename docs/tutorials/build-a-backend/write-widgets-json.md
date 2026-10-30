---
title: Write the widgets.json of a backend
sidebar_position: 2
---

# Write the widgets.json of a backend

A backend tells FINOS Workspace which widgets it offers in a file named `widgets.json`. This guide builds that file step by step: one widget, then its type, its parameters, its size and its refresh, and then it shows how to turn an endpoint that you already have into a widget. It assumes that your backend is a web server that FINOS Workspace can reach, as [Connect a backend and build a dashboard](connect-a-backend-and-build-a-dashboard.mdx) shows. [widgets.json](../../reference/schemas/widgets-json.mdx) lists every key that a definition may contain, and [Widget requests](../../reference/protocols/widget-requests.mdx) describes the request that FINOS Workspace sends for each definition.

## Describe one widget

The file is a JSON object. Each key is the id of a widget, and each value is its definition. A definition needs four keys:

```json
{
  "ticket_summary": {
    "name": "Ticket summary",
    "description": "Open and closed support tickets for one team over a period",
    "type": "markdown",
    "endpoint": "/summary"
  }
}
```

- **`name`** is the title that the widget shows.
- **`description`** says what the widget shows. The catalog displays it, and the Agent finds widgets by it, so write it for a person who has not seen the widget. [Make a widget readable by the Agent](make-a-widget-readable-by-the-agent.md) goes further.
- **`type`** decides how the widget is drawn.
- **`endpoint`** is a path on your backend, or an absolute URL, that returns the widget's data. It contains neither `?` nor `#`. A value for the query is a parameter, as the next sections show.

The contract defines every key. A key that it does not define is ignored: FINOS Workspace loads the widget without it, so a misspelled key has no effect, and the warning "Unrecognized fields" lists the key with its path when you test the backend. Any other problem leaves the widget out.

## Choose the type

The built-in types are `markdown`, `html`, `newsfeed`, `pdf` and `iframe`. Choose the one that matches what your endpoint returns:

| Type | The endpoint returns |
|---|---|
| `markdown` | A Markdown string, as text or as JSON with the string at the path `data.dataKey`. |
| `html` | An HTML document, which the widget shows in a frame. |
| `newsfeed` | A JSON array of articles, each with a title, an excerpt and a full text, or JSON with the array at `data.dataKey`. |
| `pdf` | A PDF, or JSON that holds the file. |
| `iframe` | Nothing. The endpoint is the address of a page that the browser opens, as [Embed a web page](../../features/widgets/embed-a-web-page.md) describes. |

A type that a widget plugin handles works the same way, and it appears only for the organizations that enabled the plugin. When the endpoint answers with JSON and the text is not at the top of it, name the path in `data.dataKey`, for example `"data": { "dataKey": "result.text" }`.

## Add parameters

A parameter is a control in the widget's header whose value goes into the request. This definition has four of them, one of which fills a placeholder in the path:

```json
{
  "team_report": {
    "name": "Team report",
    "description": "Report for one team and period",
    "type": "markdown",
    "method": "POST",
    "endpoint": "/teams/{team}/report",
    "params": [
      { "paramName": "team", "type": "endpoint", "label": "Team",
        "optionsEndpoint": "/teams/search", "optionsMethod": "POST", "optionsParams": { "active": true },
        "value": "platform" },
      { "paramName": "period", "type": "text", "label": "Period", "value": "month" },
      { "paramName": "X-Region", "type": "text", "label": "Region", "value": "eu", "in": "header" },
      { "paramName": "filters", "type": "text", "label": "Filters", "value": "active", "in": "body" }
    ]
  }
}
```

Each parameter needs a `paramName` and a `type`. The types are `text`, `tabs`, `date`, `number`, `boolean`, `button`, `endpoint` and `form`. A `text` parameter takes free text, `tabs` and `endpoint` offer a choice, `date` takes a date, `number` a number and `boolean` a box to tick. `button` is a button whose value goes into the request, and `form` is a set of inputs that FINOS Workspace sends to its own endpoint. The other keys of a parameter set `label`, `description` for the help that appears on hover, `placeholder`, `options` for a fixed choice, `multiSelect` for a choice of several values and `value` for the default.

Where the value goes depends on the key `in`. With the widget above, and `team` set to `platform`, FINOS Workspace sends this request:

```text
POST <backend>/teams/platform/report?period=month&theme=dark
X-Region: eu
Content-Type: application/json

{"filters":"active"}
```

- **A placeholder in the endpoint**, such as `{team}`, takes the value of the parameter of that name. The parameter declares no `in`, it takes one value and it is required.
- **`"in": "query"`** is the default, and it puts the value into the query.
- **`"in": "header"`** sends `paramName: value` as a header. Some header names are reserved, as [Widget requests](../../reference/protocols/widget-requests.mdx#rules-for-definitions) lists, and credentials never belong in a parameter.
- **`"in": "body"`** puts the value into a JSON body and needs `"method": "POST"`.

Three more things about parameters matter in practice.

- **The theme.** For `markdown`, `html`, `iframe` and plugin types, FINOS Workspace adds `theme=dark` or `theme=light` to every request, as you see above, so a backend that draws its own colors can follow the site. You cannot use `theme` as the name of a parameter.
- **Choices from your backend.** An `endpoint` parameter loads its choices from its `optionsEndpoint`, which answers with a list of strings or of objects with `label` and `value`. With `optionsMethod` set to `POST`, the values of `optionsParams` go into a JSON body, and a value that starts with `$`, such as `"$team"`, stands for the current value of the parameter of that name.
- **Defaults.** A date default may be a date written `YYYY-MM-DD` or `$currentDate` with a modifier, such as `$currentDate-1M` for one month ago. A default of `false` or `0` is a value like any other, and FINOS Workspace sends it. An empty default means that the parameter has no value, and FINOS Workspace leaves it out of the request. A static value for the query, such as a fixed `format=compact`, is a parameter with a default and `"show": false`, which hides the control and still sends the value.

### Arrange the parameters

A parameter is a control in the header, and a list of parameters in the `params` array makes a row of them. This arrangement puts the team and the period on one row and the other two controls on another:

```json
"params": [
  [
    { "paramName": "team", "type": "endpoint", "label": "Team", "optionsEndpoint": "/teams", "value": "platform" },
    { "paramName": "period", "type": "tabs", "label": "Period",
      "options": [{ "label": "Week", "value": "week" }, { "label": "Month", "value": "month" }], "value": "week" }
  ],
  [
    { "paramName": "include_closed", "type": "boolean", "label": "Include closed" },
    { "paramName": "since", "type": "date", "label": "Since", "value": "$currentDate-1M" }
  ]
]
```

The widget shows its first control in the header and the other controls in the parameter bar below it, and a `tabs` parameter gets a row of its own, so a widget with many parameters stays readable on a narrow card. A user can change a value at any time, and FINOS Workspace remembers it with the dashboard. When the parameters of several widgets should move together, a user links them, as [Link the parameters of widgets](../../features/widgets/link-the-parameters-of-widgets.md) describes.

## Size, refresh and the catalog

These keys of a definition are all optional:

- **`gridData`** is the default size on a dashboard, in grid units: `w` of at most 40 columns and `h` rows. `{ "w": 20, "h": 12 }` makes the widget half as wide as the dashboard.
- **`staleTime`** is the number of milliseconds for which FINOS Workspace reuses a response before it asks again. The value `false` asks every time.
- **`refetchInterval`** makes the widget ask again every so many milliseconds, or on a five-field cron schedule. A widget with `"refetchInterval": 30000` fetches every thirty seconds.
- **`runButton`** set to `true` makes the widget fetch only when the user selects its Run button. The widget fetches once when it is first added, and after that a change of a parameter dims the content until the user runs it. Use it for a request that is slow or costs something.
- **`dataUpdateDisplay`** is a cron expression for the times at which the data changes, which the widget shows to the user.
- **`showTitle`** set to `false` leaves the title off, and **`exportable`** set to `false` removes Export from the widget's menu.
- **`category`**, **`subCategory`** and **`source`** place the widget in the Widget Menu. The menu groups the widgets by category and, within it, by subcategory, and it shows the source as a label beside the widget.

## Turn an endpoint you already have into a widget

Suppose that your service answers a request for `https://tickets.example.com/api/teams/platform/tickets?period=month` with a JSON document `{ "summary": "..." }` and expects the header `X-Region`. These steps turn it into a widget:

1. **Pick the id and the text.** Choose a short id such as `team_tickets` and write the `name` and the `description`.
2. **Pick the type from the response.** The response is text inside JSON, so the type is `markdown` and `"data": { "dataKey": "summary" }` names the field. A response that is a finished HTML page is `html`, and a JSON array of articles is `newsfeed`.
3. **Make every changing part a parameter.** The segment `platform` becomes the placeholder `{team}` in the endpoint and a parameter named `team`, `period` becomes a parameter that goes into the query, and `X-Region` becomes a parameter with `"in": "header"`.
4. **Leave the credentials out.** An API key or a bearer token belongs to the connection that the user creates for the backend, as [Connect a backend](../../features/data-backends/connect-a-backend.md) describes, and never to a parameter. The contract refuses a parameter that has the name of one of the connection's credentials.
5. **Allow the browser to call it.** The browser calls the backend directly, so the service has to answer the preflight requests that a header, a body or a method other than `GET` cause, and to allow the address of the web app. [Widget requests](../../reference/protocols/widget-requests.mdx#cors) lists what it has to answer.

The result is this definition:

```json
{
  "team_tickets": {
    "name": "Team tickets",
    "description": "Open tickets of one team over a period, as a short summary",
    "type": "markdown",
    "endpoint": "/api/teams/{team}/tickets",
    "data": { "dataKey": "summary" },
    "params": [
      { "paramName": "team", "type": "text", "label": "Team", "value": "platform" },
      { "paramName": "period", "type": "text", "label": "Period", "value": "month" },
      { "paramName": "X-Region", "type": "text", "label": "Region", "value": "eu", "in": "header" }
    ]
  }
}
```

An AI host can help with this conversion. The FINOS Workspace MCP server serves a guide for converting an endpoint into a widget among its resources, and [Connect an outside AI host to FINOS Workspace](../../quick-start/connect-your-ai-tool.mdx) shows how to connect one.

## Test the file

1. Serve the file at `/widgets.json` on your backend, and serve `/apps.json` too, with `[]` when you have no apps.
2. In Connections, select Connect Backend, enter the name and the address, set Validate widgets to Yes and select Test. The result says how many widgets FINOS Workspace found, and it lists the problems of every definition that breaks the contract, each with the path of the key. [Review and debug a backend](review-and-debug-a-backend.md) explains the notices.
3. Add the widgets to a dashboard and open the network tool of your browser. Check that each request has the URL, the headers and the body that you expect, and that the backend answers each with the right data.
