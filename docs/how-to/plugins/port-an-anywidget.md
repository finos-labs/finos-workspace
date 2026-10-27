---
title: How to port an anywidget to a plugin
sidebar_position: 5
---

# How to port an anywidget to a plugin

A plugin's module is an anywidget front-end module, so you can re-package the JavaScript of an existing anywidget. What you have to replace is everything that the Python side did, because a plugin has no kernel.

1. Take the `_esm` and `_css` of the Python package and bundle them into `entry.js` and `entry.css`. Inline dynamic imports and remove imports from a CDN, because a remote `import` fails unless the frame's policy allows the origin, as [Plugin frame policy](../../reference/plugins/frame-policy.mdx) describes.

2. Map the module's trait names in `model.traits`, so that the module keeps reading the names that it already knows:

   ```json
   "model": { "traits": { "rows": { "bind": "data" } } }
   ```

3. Replace each thing that the Python side did. Data now comes from a backend endpoint through the `data` trait, and settings come through `config`. A round trip to code on a server goes through a [proxy](../../reference/plugins/proxies.mdx) or through a route of the plugin's own [backend](../../reference/plugins/backends.mdx). Kernel messages do not exist.

4. Remove every use of storage, popups, alerts and cookies, because the sandbox forbids them. Keep a widget's preferences in `state`, which requires the permission `core:state:write`.

5. Check the package and try it in your own Workspace, as [How to build and try a widget plugin](build-a-plugin.md) describes. The first failures are usually attempts to use storage and remote imports.

[Plugin module contract](../../reference/plugins/module-contract.mdx) lists all the differences from anywidget in Jupyter.
