---
title: Deploy a widget plugin
sidebar_position: 1
---

# Deploy a widget plugin

Put plugin packages where the API can read them, pin each version, and give each plugin its secrets. The app has no upload, so a plugin reaches a deployment only through the plugins directory and the API's configuration.

## What the API needs

- A directory in its container with one folder for each plugin version, as `<plugin-id>/<version>/`.
- The variable `WIDGET_PLUGINS_DIR` set to that directory. The plugin feature stays off while the variable is unset.
- The directory mounted read-only. The API only reads it.
- The same files in every API replica. An approval is bound to a digest of the files, and each replica serves its own copy, so replicas with different files would contradict the approval.

A package has this layout:

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

The API reads the other plugin settings from its environment, like every API setting. The Widget plugins group of [Backend settings](../../reference/configuration/backend.mdx) lists them with their defaults.

## 1. Provide the directory

Pick the way that fits how you build and release the API.

**Build the packages into an image.** Every replica then carries identical files, and a new plugin version becomes a new image. Make sure the API's user can read the files.

```dockerfile
FROM <the API image>
COPY <plugins directory> /opt/widget-plugins
```

**Mount a volume.** Mount a volume that every replica can read, read-only. On Kubernetes, the claim must allow read-only access from several pods:

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

## 2. Pin the version

Run this in the API container, where the scripts are installed, or from `backend-api/backend` in a checkout:

```bash
python -m scripts.plugin_check --digest <plugins directory>/<plugin-id>/<version>
```

The command prints two values:

- The manifest's `checksum`, which covers every file except `plugin.json`.
- The version digest, which covers every file.

Write the version digest into `WIDGET_PLUGINS_PINS`:

```json
{"<plugin-id>@<version>": "sha256-..."}
```

From then on, the API blocks that version at the next rescan if its files differ. In production, also set `WIDGET_PLUGINS_REQUIRE_PINS=true`, so that the API blocks every version that has no pin.

## 3. Review and enable the plugin

Ask a superuser to rescan and review the plugin, as [Review and enable a widget plugin](review-and-enable-a-plugin.md) describes. The API scans only when someone asks, never at startup.

## 4. Give the plugin its secrets

A plugin declares its secrets by name and purpose. The deployment provides the values, in one of two ways:

- **A file** at `<WIDGET_PLUGIN_SECRETS_DIR>/<plugin-id>/<secret-name>`. The API drops the final line break, so a secret that your platform mounts as files, such as a Kubernetes Secret, works as it is.
- **The Deployment page** of the plugin, or `plugin secret set`, run by a superuser.

When both exist, the file wins, and the Deployment page shows the value as set by configuration.

## 5. Run the backend

If the package has a `backend/` directory, build and run the backend as [Run a plugin backend](run-a-plugin-backend.md) describes.

## Publish a new version

1. Add a new version directory next to the old one.
2. Approve the new version.
3. Remove the old directory only after the approval.

:::warning

Never edit the files of an approved version. The API hashes a file again whenever its size or modification time changes, and a changed file blocks its version.

:::

- Keep the active version's directory in place until the new version is approved. A version whose directory is gone is `missing`, so when you ship packages in an image, include both versions until the approval is done.
- A deployment runs only approved versions. It has no counterpart of the Patch, Minor and Major actions that [Build and try a widget plugin](build-a-plugin.md) describes for a local stack.

## Next steps

- [Plugin package and manifest](../../reference/plugins/package-and-manifest.mdx) lists the rules for a package.
- [Plugin lifecycle and administration](../../reference/plugins/lifecycle.mdx) describes the states that a version passes through.
