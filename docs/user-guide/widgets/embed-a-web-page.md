---
title: How to embed a web page as a widget
sidebar_position: 14
---

# How to embed a web page as a widget

This guide puts a web page on a dashboard as an iframe widget, for example a Streamlit app, a status page or a report that your company serves. The widget shows the page next to your other widgets, and you can arrange, share and save it like any other.

## What you need

You need an account of type Admin or Developer, because a User cannot add data to the widget library, and the address of a page that allows itself to be shown in a frame. A page that forbids framing, with the header `X-Frame-Options` or a `frame-ancestors` rule in its content security policy, shows nothing in the widget. The web app does not restrict which pages a widget may show, so the page's own policy decides.

## Add the page to your library

1. Select Widgets in the sidebar, then Add Data, and then Iframe under My Widgets. The page says "Add any embeddable iframe URL (e.g. a Streamlit app) to your workspace."
2. In Name, type the name of the widget. The field starts with `Iframe` and may not be empty.
3. In Iframe URL, type the address of the page. The `https://` at the start is optional, and the host is either `localhost`, with an optional port, or a domain name. A path may follow. An address of another shape gives "Invalid URL format".
4. Optionally open Metadata and fill in the Description, the Category, the Sub-category and the Source. The category is one of Economy, Crypto, Stocks, Fixed Income, Equity, Currency, ETF, Index, Derivatives and Others. The widget catalog uses these values to group and to find the widget.
5. To add several pages at once, select the plus sign next to the tab, which opens another form, and fill it in. The cross on a tab removes its form again.
6. Select Add.

A message says "1 widget added to widget menu", and that the widget is in the widget menu, which you open with Ctrl+K, or Cmd+K on a Mac. The message has a button Add to new dashboard that puts the widget on a dashboard of its own at once. When an address is invalid, the message says "Please ensure all iframe URLs are valid", and when you have removed every form, it says "Please enter at least one iframe URL".

The widget appears in the library under My Data, and you add it to a dashboard like any other widget, with Add widgets.

## Start from an empty widget instead

The widget menu also has the built-in widget Iframe, under Others and Utils. It starts empty, and you type the address in the box that says "Enter the URL". Use it when you want to try a page without saving it in your library.

## What the widget allows the page to do

The page runs in a frame that permits scripts, forms, downloads and pop-up windows, and the page keeps its own origin, so it keeps its own cookies. A page that needs more of your FINOS Workspace, such as the values of the dashboard's parameters or the credentials of a backend, can ask for them through the protocol that [Iframe widget protocol](../../technical-guide/reference/protocols/iframe-widget.mdx) describes.

## Change how the widget looks

The setting Auto-hide iframe widget navbar (show on hover) in the tab Widget of your settings hides the widget's address bar until you point at it. [How to change your settings](../account/change-your-settings.md) lists it with the others.

A backend can also offer iframe widgets that you cannot edit, with parameters that FINOS Workspace passes to the page. [widgets.json](../../technical-guide/reference/schemas/widgets-json.mdx) describes the type `iframe`.
