---
title: Call an API with a secret from a plugin
sidebar_position: 6
---

# Call an API with a secret from a plugin

Declare a proxy so a widget can call an API whose key must not reach the browser. The frame names the proxy, the server makes the request, and the server adds the key.

## 1. Declare the secret and the proxy

In the manifest, declare the secret and the proxy, together with the origin that the server may call:

```jsonc
"secrets": [{ "name": "api_key", "purpose": "Reads quotes from the quote service" }],
"server": {
  "network": ["https://quotes.example.org"],
  "proxies": [
    {
      "id": "quote",
      "method": "GET",
      "url": "https://quotes.example.org/v1/quotes/${arg:symbol}",
      "headers": { "Authorization": "Bearer ${secret:api_key}" },
      "args": { "symbol": { "type": "string", "maxLength": 12, "required": true } },
      "response": { "accepts": ["application/json"] }
    }
  ]
}
```

## 2. Let the widget use the proxy

In the widget's entry, list the permission and the proxy:

```json
"permissions": ["core:proxy:call"],
"server": { "proxies": ["quote"] }
```

## 3. Call the proxy from the module

```js
const [quote] = await experimental.invoke("core:proxy:call", {
  id: "quote",
  args: { symbol: "IBM" },
});
```

## 4. Provide the secret's value

A package never ships a value. Provide it in one of two ways, as [Deploy a widget plugin](deploy-a-plugin.md#4-give-the-plugin-its-secrets) describes:

- mount it as a file,
- set it on the plugin's Deployment page.

## 5. Check, publish and approve

Check the version, publish it and have it approved, as [Build and try a widget plugin](build-a-plugin.md) describes. The review shows the host that the server will call and the secret that it sends.

## Next steps

[Plugin proxies and secrets](../../reference/plugins/proxies.mdx) lists the rules for every part of the template.
