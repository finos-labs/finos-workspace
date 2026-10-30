---
title: Talk to FINOS Workspace from an iframe page
sidebar_position: 14
---

# Talk to FINOS Workspace from an iframe page

An iframe widget embeds a page from another server. By default the page is just shown, but a page can also talk to FINOS Workspace, and then it can offer several widgets to the dashboard and the Agent, show parameter controls in the widget's header, and receive the backend connection's credentials. The page and FINOS Workspace talk through `window.postMessage`. This page explains the order in which the messages are sent and the rules that decide whether FINOS Workspace accepts a message. The host side is `frontend/src/components/Widgets/Helpers/useIframeProtocol.tsx`, and the messages are defined in `frontend/src/types/iframeProtocol.ts`.

## How a conversation starts

The embedded page starts the conversation. It sends a `workspace-connect` message to its parent window, which lists the widgets that the page can supply and, optionally, the parameters that it understands. FINOS Workspace remembers the window and the origin that the message came from, and it uses them as the address of every later message to the page. A page that never sends `workspace-connect` is shown as an ordinary iframe, and none of the features below apply to it.

When the handshake succeeds, three things happen:

- The widgets in the manifest become sub-widgets of the iframe widget. The Agent lists each one under an id of the form `<iframe widget uuid>::iframe::<widgetId>`, and it can ask for their data.
- The parameters in `params` appear as controls in a row below the widget's navigation bar, unless the widget's own definition already declares a parameter with the same name.
- If the backend connection has header credentials, FINOS Workspace sends them to the page in a `workspace-auth` message.

## Which messages FINOS Workspace accepts

FINOS Workspace accepts a protocol message only when it comes from the iframe that belongs to the widget. A message qualifies when its source is the iframe's window, when it is the window that sent the `workspace-connect` message, or when it comes from a frame nested inside the iframe, up to eight levels deep. This lets a page forward messages from an inner frame, for example when the visible content is a second frame.

FINOS Workspace sends credentials with `workspace-auth` only when the origin of the window that connected equals the origin of the iframe's address. A page that connects from any other origin does not receive them. FINOS Workspace sends the message again whenever the credentials change. The credentials never appear in the iframe's URL.

[Iframe widget protocol](../../reference/protocols/iframe-widget.mdx) lists every message with its fields.
