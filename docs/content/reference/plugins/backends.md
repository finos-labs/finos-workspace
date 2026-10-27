---
title: Plugin backends
sidebar_position: 6
---

# Plugin backends

Some work cannot run in the browser and cannot be written as a request template. For that work, a package can carry server-side code in its `backend/` directory. The person who deploys Workspace builds that code, runs it as a restricted process of its own, and lists it in `WIDGET_PLUGIN_BACKENDS`, as [How to run a plugin backend](../../how-to/plugins/run-a-plugin-backend.md) explains. The API is the only caller of a backend.

## In the manifest

The manifest declares the backend's routes, the secrets that the routes send, the data sources that the backend reads, and whether the backend learns a pseudonymous id of the user:

```jsonc
"secrets": [{ "name": "model_key", "purpose": "Authenticates to the forecast model" }],
"dataSources": [{ "id": "sales", "purpose": "The sales of the user's organization" }],
"identity": "pseudonymous",
"server": {
  "network": ["https://models.example.org"],
  "backend": {
    "protocol": 1,
    "routes": [
      {
        "id": "forecast",
        "args": { "region": { "type": "string", "maxLength": 8, "required": true } },
        "secrets": ["model_key"],
        "response": { "maxBytes": 1048576, "timeoutMs": 10000 }
      }
    ]
  }
}
```

A widget lists the routes that it may call as `"server": { "routes": ["forecast"] }`, asks for the permission `core:backend:call`, and then calls a route from its module:

```js
const [forecast] = await experimental.invoke("core:backend:call", {
  route: "forecast",
  args: { region: "emea" },
});
```

## What the backend answers

The API talks to the backend over HTTP on its internal address. The backend must answer three kinds of requests:

| Request | Answer |
|---|---|
| `GET /.workspace/identity` | The backend answers with `{ "plugin": "<id>", "version": "<version>", "digest": "<version digest>", "protocol": 1 }`. The digest is the one that `plugin_check --digest` prints for the package that the backend was built from. The API routes nothing to a backend whose answer does not match the approved version. |
| `GET /.workspace/health` | The backend answers with any 200 response. |
| `POST /.workspace/routes/<route-id>` | The request body is `{ "args": {...}, "widget": { "id", "instanceId" }, "caller": {} }`. The request carries the header `X-Workspace-Call: <token>` and, for each secret of the route, a header `X-Workspace-Secret-<name>`, in which underscores in the name become hyphens. The backend answers with JSON that stays within the route's limits. |

## Rules for a backend

**Network.** The `server.network` list names everything that the backend contacts. It contains https origins, and it contains `tcp://host:port` for anything else, such as a database. The deployment enforces the list around the backend. A host that belongs to the deployment rather than to the package, such as its database, is added by a superuser's override, and the package names that host in its `purpose` texts and in its README.

**Arguments.** The API checks the arguments against the route's `args` before it makes the call, using the same types as [proxies](proxies.md). A string argument of a route may have a `maxLength` of up to 32,768 characters, because it travels in the call's JSON body. A proxy's strings stay at 2,048 characters.

**The caller.** The `caller` object is empty, unless the admin approved `identity: "pseudonymous"`. In that case it is `{ "id": "<pseudonymous id>" }`. The id is an HMAC of the plugin id and the user id. It is stable for one user within one plugin and different in every other plugin, and it is never the user's name, email address or Workspace id.

**Data of the user.** A backend reads a data source that it declares by sending the call's token to the broker. It sends `POST <API>/internal/plugin-broker/data/<data-source-id>` with the header `X-Workspace-Call: <token>`, the header `Origin: <the web app's origin>` and a body of the form `{ "path": "/<path under the backend's URL>", "method": "GET", "query": {...}, "body": ... }`. The deployment gives the backend its origin value, and the API refuses requests from origins that it does not allow. The broker answers with `{ "status", "content_type", "body" }`. The organization chooses which of its backends serves each data source, and the user's own access applies. The API adds the backend's credentials itself, so the plugin never holds them.

**The token.** The call token is encrypted and authenticated with a key that is derived from `WORKSPACE_AES_KEY`. It lasts 60 seconds and is opaque to the backend.

**Limits.** A route's `maxBytes` may be at most 5 MiB and defaults to 1 MiB. Its `timeoutMs` may be at most 30 seconds and defaults to 10 seconds. The deployment caps both values. The API rate limits calls, and it lets at most 8 calls of one plugin run at the same time. After repeated failures, such as time-outs, errors or 5xx answers, the API pauses calls to the backend for a short time. A 4xx answer from the backend is passed on as a refusal and does not count as a failure.

**Errors in the frame.** A refused call rejects with `out_of_scope` when the widget does not list the route. It rejects with `invalid_args`, `not_granted`, `rate_limited`, `timeout` or `too_large` when the matching condition holds. In every other case it rejects with `unavailable`, for example when the backend is not registered, when it runs another version, when calls are paused, when a secret is not set, or when the backend itself returned an error.

**Review.** The admin who reviews the plugin sees that code runs on the server. The review lists each route with the secrets that it sends, each data source, and the pseudonymous id if the plugin asks for it.

**Logs.** The API writes one log line for each call with the plugin, the widget, the outcome, the number of bytes and the duration. It never logs arguments, bodies or secrets.
