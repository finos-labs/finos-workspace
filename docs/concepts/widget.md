---
title: Widget
sidebar_position: 1
---

# Widget

A widget shows data from one source on a [dashboard](dashboard.md). The source is usually an endpoint of a [connector](connector.md). It can also be an uploaded file or an embedded web page.

- A widget has **parameters**: the controls that change what it shows, such as a year or a team.
- A widget has a **type**, which decides how the data is drawn: Markdown, HTML, news feed, PDF, iframe, or a type that a [plugin](plugin.md) adds.
- The connector defines a widget in its `widgets.json`. A widget is a catalog entry until someone adds it to a dashboard.
- A widget stores no data. The API asks the connector each time the browser needs the data.

## Where to go

- **Use it:** [Widget types](../features/widgets/widget-types.md), [Link the parameters of widgets](../features/widgets/link-the-parameters-of-widgets.md)
- **Build it:** [Write the widgets.json of a backend](../tutorials/build-a-backend/write-widgets-json.md)
- **Look it up:** [widgets.json](../reference/schemas/widgets-json.mdx), [Widget requests](../reference/protocols/widget-requests.mdx)
