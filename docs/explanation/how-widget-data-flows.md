---
title: About how a widget gets its data
sidebar_position: 3
---

# About how a widget gets its data

When a card on a dashboard shows data, a request has gone from the browser to a backend and an answer has come back. The path is short, but each step of it is a decision, and the decisions explain behavior that people ask about: why a change of a parameter reloads a card, why the Copilot sees what a card sees, why a backend needs to allow the web app's address, and why a card can be empty for one person and full for another. This page follows one request from a card to the screen.

## The request is built in one place

A card holds three things that matter here: the definition that its backend gave it, the values of its parameters, and the connection through which the person reaches the backend. The web app combines them in a single function that builds every widget request. It puts the endpoint and the parameters that go in the path or the query into the address, it adds the parameters that go in headers and in a body, and it adds the credentials of the person's connection. Cards, the option lists of the parameter bar, forms and the Copilot all use that one function, so a request that works for a card works for the Copilot, and a request that a card cannot build, because a required value is missing, fails in the same way for both. [Widget requests](../reference/protocols/widget-requests.mdx) lists what it produces.

The function also adds two things that the card did not ask for. It adds `theme`, the color mode of the site, so that a backend which draws its own pictures can draw them for the mode that the person sees. A change of mode sends the request again. It adds `raw=true` when somebody needs the rows behind a picture, as the next section says.

## The browser calls the backend

The request goes from the browser straight to the backend. FINOS Workspace's own API is not in the path. That is why a backend has to answer the preflight requests that a header, a body or a method other than `GET` make the browser send, and why it has to allow the address of the web app: the browser refuses to hand the answer to a page that the backend did not allow. [About the architecture of FINOS Workspace](architecture.mdx) explains why the design puts the browser at the center, and the consequence here is that a connection's credentials travel from the person's browser to the backend, and the owner of a dashboard never lends theirs to the people who open it.

When the answer arrives, the card reads it according to its type. A Markdown card draws the text, an HTML card puts the page in a frame, and a plugin's card passes the answer to the plugin as the value `data`. A card whose definition names a `dataKey` first takes the part of a JSON answer that the path names.

## Parameters make the cycle repeat

Everything that a person can change in a card is a parameter, and a change sets the cycle off again with the new values. Parameters are saved with the dashboard, not the data, so the next person who opens the dashboard, or the same person tomorrow, starts the cycle with the values that were saved. A card whose definition asks for a Run button waits for the person to press it before it repeats, which suits a request that is slow or costs money. A card may also repeat by itself: its definition can name an interval in which it asks again.

Parameters can be linked, so that the cards of a group take one value. A change in one card then changes the stored value of every card in the group, and each of them sends its own request. This is also how an app can start a dashboard with all its cards on the same year.

## The Copilot reads the same way

When a question needs a card's data, the agent does not fetch it. It asks the browser, and the browser builds the card's request with the same function, sends it with the person's credentials and hands the answer to the agent. The only difference is that this request does not carry `theme`, because the model has no use for colors. If the card's definition sets `raw`, the request carries `raw=true` and the backend answers with the rows instead of the picture, so that the model reads numbers and does not read the markup of a chart. The agent turns a list of objects into a table that it can query, and it reads everything else as text. [Widget data for the agent](../reference/protocols/ines-widget-data.mdx) follows that read in detail, and [How to make a widget readable by the Copilot](../how-to/build/make-a-widget-readable-by-the-copilot.md) shows how to prepare a widget for it.

## Where it can go wrong

Each step can fail on its own, and the card says which one. A card whose parameter has no value does not send a request and names the parameter. A backend that does not allow the web app's address makes the browser refuse the answer, which looks like a network failure. A backend that answers with an error shows its error. A person who has no way to reach the backend, or no grant for the widget, sees a message about access and never sends the request. [How to review and debug a backend](../how-to/build/review-and-debug-a-backend.md) goes through these cases from the backend author's side.
