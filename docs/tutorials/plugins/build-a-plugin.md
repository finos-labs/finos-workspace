---
title: Build and try a widget plugin
sidebar_position: 4
---

# Build and try a widget plugin

Run your own FINOS Workspace as its administrator, put your plugin through the same review that a deployment applies, and change it in place while you develop.

## Before you start

You need a FINOS Workspace stack of your own. The local development stack of `local/` and the root `docker-compose.yml` are the simplest; both run with `MODE=local`, which steps 6 to 8 need.

:::warning

Deployments run with `MODE=production`, including those built from the `develop` and `main` branches. Steps 6 to 8 do not exist there.

:::

On either stack, the plugins directory is `widget-plugins/` at the root of the repository: the Widget plugins section of `local/LOCAL_SETUP.md` shows how the local stack mounts it, and the root compose file mounts the same directory. On any other stack, the API needs the same two things, as [Deploy a widget plugin](deploy-a-plugin.md) describes.

## 1. Build the package

Build it into `<plugins directory>/<plugin-id>/<version>/`. It needs:

- a `plugin.json`,
- one bundled `entry.js`,
- optionally an `entry.css` and an `assets/` directory.

[Plugin package and manifest](../../reference/plugins/package-and-manifest.mdx) lists the rules, and [Plugin module contract](../../reference/plugins/module-contract.mdx) describes what the module must do.

## 2. Check the package

Run both commands from `backend-api/backend`:

```bash
python -m scripts.plugin_check <plugins directory>/<plugin-id>/<version>
python -m scripts.plugin_check --digest <plugins directory>/<plugin-id>/<version>
```

- The first command exits with status 1 and prints the reasons when the version would be blocked.
- The second prints the `checksum` that belongs in `plugin.json`.

Write the checksum into the manifest, then run the first command again.

## 3. Approve and enable the plugin

1. Select **Admin → Widgets → Deployment**, rescan, review the version and approve it.
2. Enable the plugin under **Plugin widgets**.
3. Grant it to a role that you hold, in **Roles and Access**.

[Review and enable a widget plugin](review-and-enable-a-plugin.md) describes each step.

## 4. Add the widget to a dashboard

Add the plugin's widget to a dashboard.

## 5. Set the secrets of a proxy

If your plugin calls a proxy, set the proxy's secret on the plugin's Deployment page.

- A service on your own machine or network resolves to a private address. A superuser must override the server network, with the confirmation `private-host`.
- A server whose certificate comes from a private authority needs `WIDGET_PLUGIN_PROXY_CA_FILE`.

## 6. Start a development version

On the plugin's Deployment page, choose **Patch**, **Minor** or **Major**. The API:

- copies the active version to the next version number,
- rewrites the copy's `version` and `checksum`,
- marks the copy `development`.

A stack where `MODE` is not `local` refuses this.

## 7. Edit the copy

Edit the copy's files, or build into its directory. The app serves them as they are.

- A dashboard reads the plugin list when its window gets focus and every minute. A frame restarts when its files changed.
- An edit does not block the copy. A `checksum` that no longer matches is only a warning.
- The other declarations of the manifest apply as you change them. These are the [frame policy](../../reference/plugins/frame-policy.mdx), the [proxies](../../reference/plugins/proxies.mdx), the routes and the widgets' `definition`s.
- A copy that fails a check is not served, and the Deployment page says why.

## 8. Finish the copy

Write its `checksum` into the manifest, with `plugin_check --digest` or with your build. Then choose one:

- **Approve it.** It becomes the active version.
- **Commit its directory and open a pull request.** A deployment then discovers it as a new version, and its superuser reviews and approves it.

:::note

An approved version is never edited, because changing its files blocks it. Only one version of a plugin is in development at a time. Delete its directory and rescan to end it. [Plugin lifecycle and administration](../../reference/plugins/lifecycle.mdx#developing-on-a-local-stack) describes the feature in full.

:::

## Read data from a backend

A widget of a type that you handle can read a data backend. Add it under Connections with the address you use in your browser, for example `http://localhost:9000`, with your own key, read-only where the backend has such keys. This stack runs with `MODE=local`, so the API accepts a private or plain `http` address for any user's connection, and for `localhost`, `127.0.0.1` and `[::1]` it calls your machine through `host.docker.internal`. The backend needs no CORS settings, the key is stored encrypted in this stack's database and added by the API, and the browser never holds it. On Linux the backend has to listen on `0.0.0.0`, not only on `127.0.0.1`.

A deployment's data backend works the same way as long as it has a public `https` address. The key is stored in this stack's database, so nothing is written to the deployment's FINOS Workspace. The reverse does not work: a deployed Workspace cannot call a backend on your machine, so develop against a local backend on this stack.

The agent and the plugin backends of a deployment accept only that deployment's sessions and call tokens. A local stack can neither use them nor write to them. Run them on your machine instead:

- The root `docker-compose.yml` runs the agent.
- `docs/examples/backend/compose.yaml` shows a plugin backend.

## Before you publish

Check these before you hand the plugin to a deployer:

- Every permission, policy source, server host and secret in the manifest is one that a widget uses, and each policy directive has a line in `cspNotes`.
- The module still works when an admin removes a permission that it asks for.
- The module follows the `theme` trait and resizes together with `el`.
- The module cleans up through the cleanup function that it returns, or through `signal`.
- `plugin_check` passes, and the `checksum` in the manifest is current.

The folder `docs/examples/` holds three complete packages and one backend for all of them. You can build and try them.
