---
title: How to build and try a widget plugin
---

# How to build and try a widget plugin

Workspace has no developer mode for plugins. To try a plugin, you run your own Workspace as its administrator and put the plugin through the same review that a deployment applies. This guide shows how to build a package, check it, approve it and see its widget on a dashboard.

1. Run a Workspace stack of your own. The local development stack is the simplest. Its guide, `local/LOCAL_SETUP.md`, shows in its Widget plugins section how to mount a plugins directory into the backend and how to set `WIDGET_PLUGINS_DIR`. On any other stack, the API needs the same two things, as [How to deploy a widget plugin](deploy-a-plugin.md) describes.

2. Build your package into `<plugins directory>/<plugin-id>/<version>/`. It needs a `plugin.json`, one bundled `entry.js`, and optionally an `entry.css` and an `assets/` directory. [Plugin package and manifest](../../reference/plugins/package-and-manifest.md) lists the rules for the package, and [Plugin module contract](../../reference/plugins/module-contract.md) describes what the module must do.

3. Check the version with the server's own validator. Run both commands from `backend-api/backend`:

   ```bash
   python -m scripts.plugin_check <plugins directory>/<plugin-id>/<version>
   python -m scripts.plugin_check --digest <plugins directory>/<plugin-id>/<version>
   ```

   The first command exits with status 1 and prints the reasons when the version would be blocked. The second command prints the `checksum` that belongs in `plugin.json`. Write the checksum into the manifest and run the first command again.

4. Open Admin, Widgets, Deployment, rescan, review the version and approve it. Then enable the plugin under Plugin widgets, and grant it to a role that you hold in Roles and Access. [How to review and enable a widget plugin](review-and-enable-a-plugin.md) describes these steps.

5. Add the plugin's widget to a dashboard.

6. When you want to change the plugin, publish a new version and approve it. Editing the files of an approved version blocks that version.

If your plugin calls a proxy, set the proxy's secret on the plugin's Deployment page. A service on your own machine or network resolves to a private address, so it needs a superuser's override of the server network with the confirmation `private-host`. A server that uses a certificate from a private authority needs `WIDGET_PLUGIN_PROXY_CA_FILE`.

## Before you publish

Check that the plugin meets these conditions before you hand it to a deployer:

- Every permission, policy source, server host and secret in the manifest is one that a widget actually uses, and each policy directive has a line in `cspNotes`.
- The module still works when an admin removes a permission that it asks for.
- The module follows the `theme` trait and resizes together with `el`.
- The module cleans up through the cleanup function that it returns, or through `signal`.
- The command `plugin_check` passes, and the `checksum` in the manifest is current.

The folder `docs/examples/` contains two complete packages that you can build and try.
