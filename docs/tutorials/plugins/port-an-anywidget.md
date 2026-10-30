---
title: Port an anywidget to a plugin
sidebar_position: 5
---

# Port an anywidget to a plugin

A plugin's module is an anywidget front-end module, so you can re-package the JavaScript of an existing anywidget. You replace everything that the Python side did, because a plugin has no kernel.

## 1. Bundle the front end

Take the `_esm` and `_css` of the Python package and bundle them into `entry.js` and `entry.css`.

- Inline dynamic imports.
- Remove imports from a CDN. A remote `import` fails unless the frame's policy allows the origin, as [Plugin frame policy](../../reference/plugins/frame-policy.mdx) describes.

## 2. Map the trait names

Map the module's trait names in `model.traits`, so that the module keeps reading the names that it already knows:

```json
"model": { "traits": { "rows": { "bind": "data" } } }
```

## 3. Replace what the Python side did

| Python side | Plugin |
|---|---|
| Data | A backend endpoint, through the `data` trait |
| Settings | The `config` trait |
| A round trip to code on a server | A [proxy](../../reference/plugins/proxies.mdx), or a route of the plugin's own [backend](../../reference/plugins/backends.mdx) |
| Kernel messages | None. They do not exist. |

## 4. Remove what the sandbox forbids

Remove every use of storage, popups, alerts and cookies. Keep a widget's preferences in `state`, which needs the permission [`core:state:write`](../../reference/plugins/commands-and-permissions.mdx).

## 5. Try it

Check the package and try it in your own FINOS Workspace, as [Build and try a widget plugin](build-a-plugin.md) describes. The first failures are usually attempts to use storage and remote imports.

## Next steps

[Plugin module contract](../../reference/plugins/module-contract.mdx) lists all the differences from anywidget in Jupyter.
