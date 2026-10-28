---
title: How to deploy a widget plugin
sidebar_position: 1
---

# How to deploy a widget plugin

A plugin reaches a deployment only through the plugins directory that the API reads and through the API's configuration. The app itself has no upload. How the files get into the API's container depends on the platform that runs your deployment, so this guide first states what the API needs, then shows two ways to provide it, and then describes the steps that are the same on every platform.

## What the API needs

The API needs a directory inside its container that holds one folder for each plugin version, in the form `<plugin-id>/<version>/`. The environment variable `WIDGET_PLUGINS_DIR` names that directory, and while the variable is unset the plugin feature stays off. The API only reads the directory, so it should be mounted read-only.

Every API replica must see the same files. A version is approved against a digest of its files, and each replica serves the files itself, so replicas with different files would contradict the approval. A package has this layout:

```
<plugins directory>/
  <plugin-id>/
    <version>/
      plugin.json
      entry.js
      entry.css         optional
      assets/           optional
      backend/          optional, never served to browsers
```

The API reads the plugin settings like any other API setting, from its environment. The Widget plugins group of [Backend configuration](../reference/configuration/backend.mdx) lists them with their defaults. Set them wherever your deployment sets the API's other values.

## Provide the directory

Choose the way that fits how you build and release the API.

**Build the packages into an image.** Derive an image from the API image and copy the packages into it. Every replica then carries identical files, and a new plugin version becomes a new image. Make sure that the API's user can read the files.

```dockerfile
FROM <the API image>
COPY <plugins directory> /opt/widget-plugins
```

**Mount a volume.** Mount a volume that every API replica can read, and mount it read-only. On Kubernetes, the container and pod specification looks like this. The claim must support read-only access from several pods:

```yaml
containers:
  - name: api
    env:
      - name: WIDGET_PLUGINS_DIR
        value: /opt/widget-plugins
    volumeMounts:
      - name: widget-plugins
        mountPath: /opt/widget-plugins
        readOnly: true
volumes:
  - name: widget-plugins
    persistentVolumeClaim:
      claimName: <claim that holds the packages>
```

## Pin the version and give it its secrets

These steps do not depend on the platform.

1. Print the version's digest and pin it. Run the following command in the API container, where the scripts are installed, or from `backend-api/backend` in a checkout of the repository:

   ```bash
   python -m scripts.plugin_check --digest <plugins directory>/<plugin-id>/<version>
   ```

   The command prints the manifest's `checksum`, which covers every file except `plugin.json`, and the version digest, which covers every file. Write the version digest into `WIDGET_PLUGINS_PINS` in the form `{"<plugin-id>@<version>": "sha256-..."}`. From then on the API blocks that version at the next rescan when its files differ. In production, also set `WIDGET_PLUGINS_REQUIRE_PINS=true`, so that the API blocks every version that has no pin.

2. Ask a superuser to rescan and review the plugin, as [How to review and enable a widget plugin](review-and-enable-a-plugin.md) describes. The API scans only when someone asks, and it never scans at startup.

3. Give the plugin its secrets. A plugin declares its secrets by name and purpose, and the deployment provides the values. You can provide a value as a file at `<WIDGET_PLUGIN_SECRETS_DIR>/<plugin-id>/<secret-name>`. The API drops the final line break of such a file, so a secret that your platform mounts as files, such as a Kubernetes Secret, works as it is. Alternatively, a superuser can set the value on the plugin's Deployment page or with `plugin secret set`. When both exist, the file wins, and the Deployment page then shows the value as set by configuration.

4. If the package contains a `backend/` directory, build and run the backend as [How to run a plugin backend](run-a-plugin-backend.md) describes.

## Publish a new version

To publish a new version, add a new version directory next to the old one and approve it. Do not edit the files of an approved version, because the API hashes a file again whenever its size or modification time changes, and a changed file blocks its version. Keep the active version's directory in place until the new version is approved. A version whose directory is gone is `missing`, so when you ship the packages in an image, include both versions until the approval is done. A deployment runs only approved versions, so it has no counterpart of the Patch, Minor and Major actions that [How to build and try a widget plugin](build-a-plugin.md) describes for a local stack.

[Plugin package and manifest](reference/package-and-manifest.mdx) describes the rules for the package, and [Plugin lifecycle and administration](reference/lifecycle.mdx) describes the states that a version passes through.
