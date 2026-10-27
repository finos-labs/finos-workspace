---
title: Plugin lifecycle and administration
sidebar_position: 7
---

# Plugin lifecycle and administration

This page describes the steps that a plugin version goes through, the states that it can be in, and the places where admins work with plugins.

## Lifecycle

A plugin version moves through five steps before users see its widgets.

1. The deployer places the version in `<WIDGET_PLUGINS_DIR>/<plugin-id>/<version>/`.
2. A superuser rescans, either in Admin, Widgets, Deployment or with the command `plugin rescan`. The new version then becomes `discovered`, or it becomes `blocked` together with the reason.
3. The superuser reviews the version and approves it. Every request that the version adds to what the active version already asked for needs its own acknowledgement. Such a request can be a permission, a frame source, a server host, a proxy, a secret, a backend route, a data source or the pseudonymous id. The approval binds to the digest that the superuser reviewed, and the first approval enables the plugin at the deployment.
4. An organization admin enables the plugin for the organization in Admin, Widgets, Plugin widgets. The admin then grants the plugin's widget types to roles in Admin, Roles and Access, using the role's Widget plugins action.
5. Members of those roles can now use the plugin. Backend widgets of the types that the plugin handles render through it, and its standalone widgets appear in Add widget.

A new version directory starts as `discovered` and waits. The active version keeps serving until a superuser approves the new version, and that approval retires the old one. The organization's settings and the role grants carry over to the new version.

| State | Applies to | Meaning |
|---|---|---|
| `disabled`, `enabled`, `revoked` | The plugin | A plugin is `disabled` until its first approval. `revoked` is the kill switch: the plugin leaves every user's list at its next refresh, which happens within a minute, and the API refuses proxy and backend calls at once. Restoring the plugin undoes it. |
| `discovered` | A version | The scan found and checked the version, but nobody has approved it. |
| `active` | A version | This is the one version that serves users. |
| `retired` | A version | The version was active once, and it can be approved again. |
| `blocked` | A version | A check failed, or the files changed after discovery. Versions are immutable, so the deployer has to publish a new version. |
| `missing` | A version | The version's directory is gone. When every version is missing, a superuser can forget the plugin, which deletes its reviews, grants, settings and secrets. |

A rescan reads every version directory. It refuses symbolic links, odd file names and anything above the caps. It parses and validates the manifest, hashes every file, checks the manifest's `checksum` and any pin, and records what it found. A remote import in the entry module, or `eval` without `'unsafe-eval'`, produces a warning that does not block the version. Before the API serves a file, it hashes the file again whenever the file's size or modification time has changed, and a file that no longer matches blocks its version. The API scans only when someone asks, and never at startup.

## Who may do what

[About widget plugins](../../explanation/widget-plugins.md) contains the table of who does what, and it states when a widget type is available to a user.

## The Widgets page

The Widgets page in the admin area has three tabs.

On the **Plugin widgets** tab, organization admins manage each plugin that is approved at the deployment. An admin can enable the plugin for the organization and choose which plugin renders a type when two plugins handle it. An admin can also fill in the plugin's settings and narrow what it may do for the organization by removing permissions, frame sources and server hosts. For a plugin with a backend, the admin maps each data source that the backend declares to one of the organization's backends.

The **Core widgets** tab lists the built-in widget types. It is read-only.

On the **Deployment** tab, superusers see every discovered plugin with its status, its active version and what it asks for. A plugin's page offers these sections:

- The Versions section shows each version and its review, which covers what the plugin is, its integrity, the frame's network, the egress and the server side. The Approve action is in this section.
- The Revoke, Restore and Forget actions control the plugin as a whole.
- The Enabled for section enables the plugin for organizations, one at a time or all at once.
- The Overrides section changes the frame's policy for each directive and the server network. It asks for the confirmations `insecure-scheme`, `private-host` and `remote-script` when they apply.
- The Secrets section sets secret values, and the Backend section shows the backend's registration and identity and offers a Check now action.
- The Activity section lists the plugin's events, and the Blocked requests section lists what the frame's policy refused. Each blocked request has an Allow action that opens the override with that source.

In Admin, Roles and Access, a role's Widget plugins action grants either all of a plugin's widget types or only chosen ones. The grants appear in the activity log. A superuser's entity dialog lists the plugins that the organization has enabled.

## Commands and routes

The admin command line tool runs inside the API container and works on the database directly. It does everything that the superuser's pages do. You start it inside the API container, with `python -m scripts.workspace_admin plugin <action>`, using whatever your platform offers for running a command in a container, for example `kubectl exec`. [Admin CLI](../command-line/admin-cli.mdx) lists the `plugin` commands. The command `plugin approve` prints the review and approves nothing unless you add `--acknowledge`, and its `--digest` option stops the approval when the server's files are not the ones that you checked. The command `plugin secret set` reads the value without echoing it, or from standard input, and never from an argument.

The routes carry the `widget-plugins` tag on [Workspace API](../http-api/workspace-api.mdx). Superuser routes are under `/plugins`, organization admin routes are under `/admin/plugins` and `/admin/role/{role_uuid}/plugin-access`, and user routes are under `/app/widget-plugins`. A backend reads data through `POST /internal/plugin-broker/data/{data_source_id}`. The route `GET /app/widget-plugins` answers with `{ enabled, etag, plugins, vizHandlers }`, which describes what the calling user may use. The API serves a plugin's files as `application/octet-stream` with `Content-Disposition: attachment`.

The settings are in the Widget plugins group of [Backend configuration](../configuration/backend.mdx).

## What users see

A user finds the widgets of a plugin in two places. Backend widgets of a type that a plugin handles appear in the catalog and render through the plugin, and standalone plugin widgets appear in Add widget.

A plugin widget's card behaves like any other card. It has a title, parameters, a refresh action, the Copilot, a fullscreen view, a settings form that comes from the widget's `settings`, and an Export entry when the plugin offers one. The frame follows the site's light or dark mode without restarting.

A widget that cannot run keeps its place and its settings, and it tells the user why. The possible messages are "This widget type is not available to you", "Plugin sandbox unavailable", "Failed to load", "Plugin error", "Not responding" and "The widget was stopped".

The host creates a plugin widget's frame when its card comes near the viewport, and it releases the frame when the card is scrolled far away or its tab is not active.

## Watching a plugin

Workspace records several kinds of information about plugins:

- **Events** record that versions were found, changed, gone or back, and they record approvals, blocks, revocations and restores. They also record overrides, an organization's enablement and settings, secrets that were set or cleared, and backend mismatches. You can read them in a plugin's Activity section and with `plugin events`.
- **Blocked requests** show what a frame's policy refused, by directive and origin, as [Plugin frame policy](frame-policy.md) describes.
- **Metrics** appear on `/metrics` when `PROMETHEUS` is on. They are `widget_plugin_discoveries_total`, `widget_plugin_blocks_total{reason}`, `widget_plugin_approvals_total`, `widget_plugin_file_fetches_total{outcome}`, `widget_plugin_proxy_calls_total`, `widget_plugin_proxy_call_seconds`, `widget_plugin_backend_calls_total`, `widget_plugin_backend_call_seconds`, `widget_plugin_backend_identity_checks_total`, `widget_plugin_broker_calls_total`, `widget_plugin_csp_reports_total{directive}` and `widget_plugin_frame_failures_total{plugin, version, kind}`. Workspace counts a plugin's labels only for a caller who may use that plugin.
- **Logs** hold one line for each proxy, backend and broker call, with the plugin, the widget, the outcome, the number of bytes and the duration. They never contain arguments, bodies or secrets.
