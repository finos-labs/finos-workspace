---
title: Widget types
sidebar_position: 1
---

# Widget types

FINOS Workspace draws five widget types itself: Markdown, HTML, news feed, PDF and iframe. A plugin can add more, such as charts. The type of a widget decides how its data is drawn. [Widget](../../concepts/widget.md) says what a widget is, and [Create and arrange dashboards](../dashboards/create-and-arrange-dashboards.md) adds widgets to a dashboard.

FINOS Workspace has no built-in table or chart type. A backend can draw a table as an HTML widget and offer its rows, and a plugin can draw tables and charts.

## Markdown

A Markdown widget shows formatted text, such as prose, lists and small tables. It follows the theme and the typography of the app.

It comes from a backend widget of the type `markdown`, from an uploaded `txt`, `md` or `docx` file, or from a note that your AI tool or the Agent adds.

## HTML

An HTML widget shows a document in a sandboxed frame. The document draws its own colors and fonts, and the backend that serves it can follow the theme of the app, because FINOS Workspace adds `theme=dark` or `theme=light` to the request. [HTML widgets and artifacts](../../reference/css/html-documents.mdx) lists what the frame does and does not allow.

It comes from a backend widget of the type `html`, from an uploaded `html` file, or from an artifact of the Agent. When a backend offers the rows behind the document, the card has a database button that switches between the document and its rows, and the Agent reads the rows instead of the HTML.

## News feed

A news feed widget lists articles with their title, date and author. A search box filters the list, and you select an article to read it. It comes from a backend widget of the type `newsfeed`.

## PDF

A PDF widget shows a document page by page. It comes from a backend widget of the type `pdf`, or from an uploaded `pdf` file. [Add files to a dashboard](add-files-to-a-dashboard.mdx) describes the upload.

## Iframe

An iframe widget shows a web page. A page can ask FINOS Workspace for the parameters of the dashboard, and for the credentials of a backend, through a protocol. A backend can also mark an iframe widget with `requires_auth`, and FINOS Workspace then opens the page through the API, which adds the connection's credentials, in a sandbox without storage. [Embed a web page as a widget](embed-a-web-page.md) adds a page to your library and describes what the frame allows.

It comes from a backend widget of the type `iframe`, from the core widget **Iframe** under **Others** and **Utils**, which starts empty, or from a page that you add to your library with **Add Data**.

## Navigation Bar

The core widget **Navigation Bar**, under **Others** and **Utils**, creates nested tabs inside the main tab of a dashboard. It spans the full width of the dashboard and is two rows high. The Agent does not read it.

## Types that plugins add

A plugin adds widget types, and the widgets of such a type look and work as the plugin defines them. An organization admin enables the plugins that its people may use. [Plugins](../plugins/index.md) lists what a plugin can do.

## What decides the type

The backend that offers a widget names its type in its `widgets.json`, and a file that you upload gets the type of its extension. You cannot change the type of a widget. [widgets.json](../../reference/schemas/widgets-json.mdx) lists the types, and [Widget types](../../tutorials/build-a-backend/widget-types.mdx) shows a backend that offers one widget of each type.
