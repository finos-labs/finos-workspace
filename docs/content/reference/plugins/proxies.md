---
title: Plugin proxies and secrets
sidebar_position: 5
---

# Plugin proxies and secrets

A proxy is a request that the server makes on behalf of a widget, built from a template in the manifest. The frame names the proxy and supplies arguments. It never builds a URL or a header itself, and it never sees a secret. A proxy is the right choice whenever a call needs an API key, or whenever the answer should not appear in the browser's network panel.

This manifest excerpt declares a secret and a proxy that reads quotes from an external service:

```jsonc
"secrets": [{ "name": "api_key", "purpose": "Reads quotes from the quote service" }],
"server": {
  "network": ["https://quotes.example.org"],
  "proxies": [
    {
      "id": "quote",
      "method": "GET",
      "url": "https://quotes.example.org/v1/quotes/${arg:symbol}",
      "query": { "period": "${arg:period}" },
      "headers": { "Authorization": "Bearer ${secret:api_key}" },
      "args": {
        "symbol": { "type": "string", "maxLength": 12, "required": true },
        "period": { "type": "enum", "values": ["day", "week"] }
      },
      "response": { "accepts": ["application/json"], "maxBytes": 1048576, "timeoutMs": 10000 }
    }
  ]
}
```

The widget lists the proxy as `"server": { "proxies": ["quote"] }`, asks for the permission `core:proxy:call`, and then calls the proxy from its module:

```js
const [quote] = await experimental.invoke("core:proxy:call", {
  id: "quote",
  args: { symbol: "IBM", period: "day" },
});
```

## The parts of a proxy

| Part | Rules |
|---|---|
| `id` | The id consists of lowercase letters, digits, `_` and `-`, and it is unique within the plugin. |
| `method` | The method is `GET` or `POST`. |
| `url` | The URL uses `https://` with a literal host and port that appear in `server.network`, and it has no query or fragment. A `${arg:<name>}` token may appear only in the path after the host. The server encodes its value as one path segment, and the argument is required. |
| `query` | The query holds up to 32 literal names. A value may contain `${arg:<name>}`, and the server leaves out a value whose argument is absent. |
| `headers` | There may be up to 16 headers. A value may contain `${secret:<name>}` and nothing else. A manifest cannot set headers that change how a request travels, such as `Host`, `Content-Type`, `Content-Length`, `Cookie`, `Accept-Encoding`, `Forwarded`, `X-Forwarded-*`, `Sec-*` and `Proxy-*`. Header values may contain printable ASCII only. |
| `body` | A body is allowed only with `POST`, and it is a flat object with literal names. A field whose value is exactly `${arg:<name>}` keeps the type of the argument, and text around a token turns the field into a string. A field whose argument is absent is left out. The server sends the body as JSON. |
| `args` | A proxy may declare up to 32 arguments. An argument is a `string` with a `maxLength` that defaults to 256, a `number` with optional `minimum` and `maximum`, a `boolean`, or an `enum` with its `values`. The flag `required` makes an argument mandatory. The server refuses unknown arguments. |
| `response` | The field `accepts` lists one or more of `application/json`, `text/plain`, `text/csv`, `text/markdown`, `text/html` and `application/xml`, and it defaults to JSON. The field `maxBytes` may be up to 25 MiB and defaults to 1 MiB. The field `timeoutMs` may be up to 30 seconds and defaults to 10 seconds. The deployment caps both values, by default at 5 MiB and 30 seconds. |

Several further rules apply to every proxy:

- A `${secret:...}` token is never allowed in the URL, the query or the body. A key therefore never ends up in a URL or a log.
- The `server.network` list contains https origins, and it follows the host rules of the [frame policy](frame-policy.md), so it cannot contain an IP address or a private host. The host of every proxy must appear in it. A `tcp://` entry belongs to a backend and never to a proxy.
- The server resolves the host itself. It refuses a name that resolves to a private, loopback, link-local or metadata address, and it does not follow redirects. It asks for an uncompressed answer and refuses a compressed one. When the upstream answers with a status outside the 2xx range, the widget receives an error that names only the class of the status, and the server keeps only the `Content-Type` of the answer.
- A successful call resolves to the response body. That is parsed JSON for `application/json` and text for every other type.
- A refused call rejects with one of the error names on [Plugin permissions and commands](commands-and-permissions.md). The name is `invalid_args` for bad arguments, `not_granted` when the permission was removed, and `out_of_scope` for a proxy that the widget does not list. It is `rate_limited`, `timeout` or `too_large` when the matching limit is exceeded, and `unavailable` in every other case, for example when a secret is not set or when the upstream failed.
- The server rate limits calls for each user and for each plugin.

## Secrets

A manifest declares the secrets that it needs by name and purpose, and it never ships a value. The deployment or a superuser sets the values, as [How to deploy a widget plugin](../../how-to/plugins/deploy-a-plugin.md) explains. A value can be written but never read back: the server encrypts it at rest with `WORKSPACE_AES_KEY`, sends it only in the requests that declare it, and never returns it, logs it or puts it in an error message.

## The outbound guard

Every proxy request passes through the outbound guard in `backend-api/backend/utilities/egress.py`. The guard resolves the host name itself and refuses the request when any resolved address is loopback, private, link-local (including the cloud metadata address), shared, multicast, reserved or part of a documentation range, in IPv4 or in IPv6. A superuser's override can allow private hosts. The guard connects to the address that it checked, and it keeps the name for the `Host` header and for TLS. It verifies the certificate and follows no redirects. It also refuses a compressed answer, so that the size cap counts the bytes that actually arrive. An upstream that uses a certificate from a private authority needs `WIDGET_PLUGIN_PROXY_CA_FILE`.
