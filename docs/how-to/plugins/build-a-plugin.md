---
title: How to build and try a widget plugin
sidebar_position: 4
---

# How to build and try a widget plugin

To try a plugin, you run your own FINOS Workspace as its administrator and put the plugin through the same review that a deployment applies. On the local development stack you can also develop a new version of an approved plugin in place. This guide shows how to build a package, check it, approve it, see its widget on a dashboard and change it.

1. Run a FINOS Workspace stack of your own. The local development stack is the simplest, and it runs with `MODE=local`, which the steps from 6 on need. Deployments, including those that are built from the `develop` and `main` branches, run with `MODE=production`, and none of those steps exist there. The stack's guide, `local/LOCAL_SETUP.md`, shows in its Widget plugins section how to mount a writable plugins directory into the backend and how to set `WIDGET_PLUGINS_DIR`. On any other stack, the API needs the same two things, as [How to deploy a widget plugin](deploy-a-plugin.md) describes.

2. Build your package into `<plugins directory>/<plugin-id>/<version>/`. It needs a `plugin.json`, one bundled `entry.js`, and optionally an `entry.css` and an `assets/` directory. [Plugin package and manifest](../../reference/plugins/package-and-manifest.mdx) lists the rules for the package, and [Plugin module contract](../../reference/plugins/module-contract.mdx) describes what the module must do.

3. Check the version with the server's own validator. Run both commands from `backend-api/backend`:

   ```bash
   python -m scripts.plugin_check <plugins directory>/<plugin-id>/<version>
   python -m scripts.plugin_check --digest <plugins directory>/<plugin-id>/<version>
   ```

   The first command exits with status 1 and prints the reasons when the version would be blocked. The second command prints the `checksum` that belongs in `plugin.json`. Write the checksum into the manifest and run the first command again.

4. Open Admin, Widgets, Deployment, rescan, review the version and approve it. Then enable the plugin under Plugin widgets, and grant it to a role that you hold in Roles and Access. [How to review and enable a widget plugin](review-and-enable-a-plugin.md) describes these steps.

5. Add the plugin's widget to a dashboard.

6. When you want to change the plugin, open its Deployment page and choose Patch, Minor or Major. The API copies the active version to the next version number, rewrites the copy's `version` and `checksum`, and marks the copy `development`. A stack where `MODE` is not `local` refuses this.

7. Edit the copy's files, or build into its directory. The app serves them as they are. A dashboard reads the plugin list when its window gets focus and every minute, and a frame restarts when its files changed. An edit does not block the copy, and a `checksum` that no longer matches is only a warning. The other declarations of the manifest, such as the frame policy, the proxies, the routes and the widgets' `definition`s, apply as you change them. A copy that fails a check is not served, and the Deployment page says why.

8. When the copy is done, write its `checksum` into the manifest, with `plugin_check --digest` or with your build. Then approve it, which makes it the active version. Or commit its directory and open a pull request, so that a deployment discovers it as a new version and its superuser reviews and approves it.

An approved version is never edited, because changing its files blocks it. Only one version of a plugin is in development at a time, and deleting its directory and rescanning ends it. [Plugin lifecycle and administration](../../reference/plugins/lifecycle.mdx#developing-on-a-local-stack) describes the feature in full.

If your plugin calls a proxy, set the proxy's secret on the plugin's Deployment page. A service on your own machine or network resolves to a private address, so it needs a superuser's override of the server network with the confirmation `private-host`. A server that uses a certificate from a private authority needs `WIDGET_PLUGIN_PROXY_CA_FILE`.

A widget of a type that you handle can read the data backend of a deployment. Add that backend to your local stack as a connection with your own key, read-only where the backend has such keys, and have the backend allow the origin of your local web app. The agent and the plugin backends of a deployment accept only that deployment's sessions and call tokens, so a local stack can neither use them nor write to them. Run them on your machine instead: the root `docker-compose.yml` runs the agent, and `docs/examples/sql-explorer/examples/compose.yaml` shows a plugin backend.

## Before you publish

Check that the plugin meets these conditions before you hand it to a deployer:

- Every permission, policy source, server host and secret in the manifest is one that a widget actually uses, and each policy directive has a line in `cspNotes`.
- The module still works when an admin removes a permission that it asks for.
- The module follows the `theme` trait and resizes together with `el`.
- The module cleans up through the cleanup function that it returns, or through `signal`.
- The command `plugin_check` passes, and the `checksum` in the manifest is current.

The folder `docs/examples/` contains two complete packages that you can build and try.
