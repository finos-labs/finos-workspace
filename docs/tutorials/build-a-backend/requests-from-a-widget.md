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

## Which routes the API sends

For a backend that a person has only through a role, the API sends a request only when [`widgets.json`](../../reference/schemas/widgets-json.mdx) declares its route and one of the person's roles grants a widget that declares it. A person who connected the backend on the Connections page is not limited by roles.

A widget declares routes in these fields, each with its method:

| Field | Method |
|---|---|
| `endpoint` | The widget's `method`, which defaults to `GET`. |
| `optionsEndpoint` of an `endpoint` parameter, also inside a form's `inputParams` | The parameter's `optionsMethod`, which defaults to `GET`. |
| `endpoint` of a `form` parameter | The form's `method`, which defaults to `POST`. |

The API also sends the catalog files of the backend, which are `widgets.json`, [`apps.json`](../../reference/schemas/apps-json.mdx), `templates.json` and [`agents.json`](../../reference/schemas/agents-json.mdx), and the images that `apps.json` names in `img`, `img_dark` and `img_light`, whatever the person's roles grant.

The API compares the path as the backend reads it. A placeholder matches exactly one segment, and the query does not count. A path that holds `.` or `..`, an empty segment, a backslash or an encoded slash where the route has a placeholder matches no route. When two routes take the same path, the person needs a grant for the widgets of each of them. A route that two widgets declare is open to a role that grants either of them. The API answers every other request, and every request with a method that the route does not declare, with the status 403 and the header `X-Workspace-Proxy-Error`. It reads `widgets.json` as the person, with the person's identity headers, and keeps what it read for 60 seconds.

## The route check

The request itself needs no CORS: the API calls the backend from the server, and the browser never talks to the backend. When you connect a backend with **Validate widgets** turned on, the API sends a plain `OPTIONS` request to every route. A route that answers 404 fails the check, and any other answer counts as a route that exists, with 204 as the plain answer for it. Before it checks the routes, the API sends `OPTIONS` to a path that cannot exist. When that request does not receive a 404, the backend answers every `OPTIONS` request, and the dialog lists the routes as not checked.

## Caching

The cache key of a widget request consists of the method, the URL with its query, the values of the header parameters and the body. Credential values are not part of the key.

## Option lookups

An `endpoint` parameter loads its choices from its `optionsEndpoint`, using `optionsMethod`. The app fills the placeholders from `optionsParams` in the same way as for the widget. The other `optionsParams` go into the query for `GET` and into a flat JSON body for `POST`. An `optionsParams` value is a string, a number or a boolean, and a string that starts with `$` stands for the current value of the widget's parameter with that name. The app does not send empty values. The answer must be a JSON array of strings or of `{ label, value }` objects.

## Other requests

Two other features build requests from a definition:

- **Validate widgets** in the Connect backend dialog checks that the routes exist without running any of them. For each distinct route, which means every widget `endpoint`, `optionsEndpoint` and form `endpoint`, the app asks the API to send one plain `OPTIONS` request, six at a time, with placeholders filled from their defaults. The app sends no parameter and no body, and the API adds the credentials of the connection and the identity headers, as it does to every other request. A `404` answer, or no answer, fails the route, as [The route check](#the-route-check) describes. The dialog reports a route as not checked when a placeholder has no default or when the route is on another origin than the backend's.
- **The Agent** builds its data and option requests with the same builder, so the agent receives what the widget receives, except that its data request does not carry the host parameter `theme`. It refuses `input_args` that name no parameter of the widget, and it answers with the list of the widget's parameters.
