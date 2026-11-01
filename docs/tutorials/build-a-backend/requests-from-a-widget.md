---
title: Requests that a widget sends
sidebar_position: 13
---

# Requests that a widget sends

The web app builds every request in one place, the file `frontend/src/lib/utils/widgetRequest.ts`, and the FINOS Workspace API sends it to the backend from its routes under `/app/data-connectors`. The same builder serves widgets, the option lookups of the parameter bar, forms, the Agent's data and option requests, and the URL of an `iframe` widget's page. This page explains how the app builds a request and what the API sends to the backend. [Widget requests](../../reference/protocols/widget-requests.mdx) lists what a backend receives for each kind of value.

Three keys control how a request is shaped:

| Key | Where it appears | Values | Default |
|---|---|---|---|
| `method` | On the widget. | `GET` or `POST`. | `GET`. |
| `in` | On each parameter, except `form` parameters and parameters that fill a path placeholder. | `query`, `header` or `body`. | `query`. |
| `optionsMethod` | On `endpoint` parameters and on the `endpoint` inputs of a `form`. | `GET` or `POST`. | `GET`. |

## The widget's request

The app builds a widget's request in four steps:

1. **The URL.** The `endpoint` is a path on the backend or an absolute URL, and it contains neither `?` nor `#`. A static query value is written as a parameter with a default and `show: false`. The app fills the path placeholders first and then appends each parameter whose `in` is `query`.
2. **The headers.** The API sends the request, so it adds the credentials of the backend connection itself, the header `X-Workspace-User` with the signed-in user's email, the signed header `X-Workspace-Identity`, and the provider's ID token as `X-Microsoft-Id-Token` or `X-Okta-Id-Token` when the deployment turns that on. The browser holds none of these values. After these, the request carries each parameter whose `in` is `header`, as `paramName: value`.
3. **The body.** With `POST`, the parameters whose `in` is `body` are sent as one flat JSON object, with `Content-Type: application/json`. A request without body parameters has no body.
4. **The host parameters.** The app adds `theme` (`dark` or `light`) for `markdown`, `html`, `iframe` and plugin types. It adds `raw=true` when the host asks a widget for its rows, as [Widget rows](../../reference/protocols/raw-rows.md) describes. Both go into the query, whatever the method is. A change of the site's theme sends the request again.

The app does not send a parameter whose value is undefined, null or an empty string, but it does send `0` and `false`. A parameter's value is the value that the user stored for it, or else its default, so a default of `0` or `false` is sent like any other value, while an empty default means that the parameter has no value. The app sends only declared parameters. When the app cannot build a request, the widget shows the problems in place of its content and names each parameter, for example "`team` needs a value". An `iframe` widget shows the problems in place of the page, a form shows them in a toast, and the Agent receives them as the error of its call.

## Path parameters

A placeholder such as `{name}` in `endpoint` takes the value of the parameter that is called `name`. The app encodes the value as one path segment with `encodeURIComponent`. A parameter that fills a placeholder is sent nowhere else, it declares no `in`, it takes exactly one value, and it is required, so the request is not sent when the value is missing. A placeholder that names no parameter is an error.

## The route check

The request itself needs no CORS: the API calls the backend from the server, and the browser never talks to the backend. When you connect a backend with **Validate widgets** turned on, the API sends a plain `OPTIONS` request to every route and expects 204 for a route that exists and 404 for one that does not. Before it does so, it sends `OPTIONS` to a path that cannot exist; when that request does not receive a 404, the backend answers every `OPTIONS` request, and the dialog reports that the routes cannot be checked this way.

## Caching

The cache key of a widget request consists of the method, the URL with its query, the values of the header parameters and the body. Credential values are not part of the key.

## Option lookups

An `endpoint` parameter loads its choices from its `optionsEndpoint`, using `optionsMethod`. The app fills the placeholders from `optionsParams` in the same way as for the widget. The other `optionsParams` go into the query for `GET` and into a flat JSON body for `POST`. An `optionsParams` value is a string, a number or a boolean, and a string that starts with `$` stands for the current value of the widget's parameter with that name. The app does not send empty values. The answer must be a JSON array of strings or of `{ label, value }` objects.

## Other requests

Two other features build requests from a definition:

- **Validate widgets** in the Connect backend dialog checks that the routes exist without running any of them. For each distinct route, which means every widget `endpoint`, `optionsEndpoint` and form `endpoint`, it sends one plain `OPTIONS` request without credentials, query, headers or body, six at a time, with placeholders filled from their defaults. A `404` answer, or no answer, fails the route, as [The route check](#the-route-check) describes. It reports a route as not checked when a placeholder has no default or when the route is on another origin than the backend's.
- **The Agent** builds its data and option requests with the same builder, so the agent receives what the widget receives, except that its data request does not carry the host parameter `theme`. It refuses `input_args` that name no parameter of the widget, and it answers with the list of the widget's parameters.
