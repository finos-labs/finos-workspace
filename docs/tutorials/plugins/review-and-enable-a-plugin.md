---
title: Review and enable a widget plugin
sidebar_position: 3
---

# Review and enable a widget plugin

A plugin that the deployer placed on the server runs for nobody until two things happen. A superuser approves a version, and an organization admin enables the plugin and grants it to roles.

The seeded administrator is both a superuser and an organization admin, so on a single-organization deployment one person does every step below.

## As a superuser

### 1. Rescan

Select **Admin → Widgets → Deployment**, then **Rescan**. The command `plugin rescan` does the same.

The new version appears as `discovered`, or as `blocked` with the reason.

### 2. Read the review

Open the plugin. The review shows:

- what the plugin is,
- whether its files are intact,
- which network the frame can reach,
- where its egress goes,
- what runs on the server.

It starts with every host that the frame can send its data to, and it rates each directive. [Plugin frame policy](../../reference/plugins/frame-policy.mdx) describes the ratings.

### 3. Approve the version

Approve it. Every request that the version adds to what the active version already asked for needs its own acknowledgement:

- a permission,
- a frame source,
- a server host,
- a [proxy](../../reference/plugins/proxies.mdx),
- a secret,
- a backend route,
- a data source,
- the pseudonymous id.

The approval binds to the digest that you reviewed. The first approval also enables the plugin at the deployment.

On the command line, `plugin approve <id> <version>` prints the review and approves nothing until you add `--acknowledge`. The option `--digest` stops the approval when the server's files are not the ones that you checked.

### 4. Enable it for organizations

On the plugin's page, use **Enabled for** to enable it for one organization at a time or for all of them.

## As an organization admin

### 1. Enable the plugin

Select **Admin → Widgets → Plugin widgets** and enable the plugin for your organization. On the same page you can:

- choose which plugin renders a type that two plugins handle,
- fill in the plugin's settings,
- map the data sources of a plugin backend to your organization's backends,
- narrow what the plugin may do for your organization, by removing permissions, frame sources and server hosts.

You can narrow a plugin, but never widen it.

### 2. Grant it to roles

Select **Admin → Roles and Access** and use the role's **Widget plugins** action. Grant either all of the plugin's widget types or only chosen ones. Members of those roles then see the widgets.

Admins use a plugin through a role like everyone else.

## Take a plugin away

A superuser has three ways, and they differ in reach:

| Action | What it does |
|---|---|
| Revoke the plugin | The kill switch. The plugin leaves every user's list at its next refresh, within a minute, and the API refuses proxy and backend calls at once. Restoring the plugin undoes it. |
| Narrow the plugin, or remove a role's grant | Takes the plugin away from one organization or one role. |
| Forget the plugin | Deletes the plugin with its reviews, grants, settings and secrets. This works only when every version is missing. |

## When a frame blocks a request

The plugin's **Blocked requests** list shows what its frame's policy refused, grouped by directive and origin.

1. Select **Allow** on an entry. The policy override opens with that source already filled in.
2. Confirm when asked. A source needs a confirmation when it is not https (`insecure-scheme`), when it is private (`private-host`), or when it appears in `script-src` (`remote-script`).

The override's event records the confirmation.

## Next steps

[Plugin lifecycle and administration](../../reference/plugins/lifecycle.mdx) describes the states, the pages and the commands.
