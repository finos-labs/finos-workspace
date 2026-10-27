---
title: How to call an API with a secret from a plugin
---

# How to call an API with a secret from a plugin

A proxy lets a widget call an API whose key must not reach the browser. The frame names the proxy, the server makes the request, and the server adds the key. This guide shows how to declare a proxy and call it.

1. Declare the secret and the proxy in the manifest, together with the origin that the server may call:

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

2. Let the widget use the proxy by listing the proxy and the permission in the widget's entry:

   ```json
   "permissions": ["core:proxy:call"],
   "server": { "proxies": ["quote"] }
   ```

3. Call the proxy from the module:

   ```js
   const [quote] = await experimental.invoke("core:proxy:call", {
     id: "quote",
     args: { symbol: "IBM" },
   });
   ```

4. Provide the secret's value. You can mount it as a file, or you can set it on the plugin's Deployment page, as [How to deploy a widget plugin](deploy-a-plugin.md) describes. A package never ships a value.

5. Check the version, publish it and have it approved, as [How to build and try a widget plugin](build-a-plugin.md) describes. The review shows the host that the server will call and the secret that it sends.

[Plugin proxies and secrets](../../reference/plugins/proxies.md) lists the rules for every part of the template.
