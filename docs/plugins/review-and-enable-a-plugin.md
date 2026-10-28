---
title: How to review and enable a widget plugin
sidebar_position: 3
---

# How to review and enable a widget plugin

A plugin that the deployer placed on the server runs for nobody until a superuser approves a version and an organization admin enables the plugin and grants it to roles. The seeded administrator is both a superuser and an organization admin, so on a single-organization deployment one person does all of the steps below.

## As a superuser

1. Open Admin, Widgets, Deployment and select Rescan. The command `plugin rescan` does the same. The new version appears as `discovered`, or as `blocked` together with the reason.

2. Open the plugin and read the review. The review shows what the plugin is, whether its files are intact, which network the frame can reach, where its egress goes and what runs on the server. It starts with every host that the frame can send its data to, and it rates each directive, as [Plugin frame policy](reference/frame-policy.mdx) describes.

3. Approve the version. Every request that the version adds to what the active version already asked for needs its own acknowledgement. Such a request can be a permission, a frame source, a server host, a proxy, a secret, a backend route, a data source or the pseudonymous id. The approval binds to the digest that you reviewed. The first approval also enables the plugin at the deployment.

4. Enable the plugin for organizations. On the plugin's page, use the Enabled for section to enable it for one organization at a time or for all of them.

On the command line, `plugin approve <id> <version>` prints the review and approves nothing until you add `--acknowledge`. The `--digest` option stops the approval when the server's files are not the ones that you checked.

## As an organization admin

1. Open Admin, Widgets, Plugin widgets and enable the plugin for the organization. Here you can also choose which plugin renders a type that two plugins handle, fill in the plugin's settings, and map the data sources of a plugin backend to the organization's backends. You can narrow what the plugin may do for your organization by removing permissions, frame sources and server hosts. You can never widen it.

2. Open Admin, Roles and Access and use the role's Widget plugins action to grant either all of the plugin's widget types or only chosen ones. Members of those roles then see the widgets. Admins use a plugin through a role like everyone else.

## Take a plugin away

A superuser has three ways to take a plugin away, and they differ in their reach:

- Revoking a plugin is the kill switch. The plugin leaves every user's list at its next refresh, which happens within a minute, and the API refuses proxy and backend calls at once. Restoring the plugin undoes the revocation.
- Narrowing the plugin or removing a role's grant takes the plugin away from one organization or one role.
- Forgetting a plugin deletes it together with its reviews, grants, settings and secrets. This works only when every version of the plugin is missing.

## When a frame blocks a request

The plugin's Blocked requests list shows what its frame's policy refused, grouped by directive and origin. Each entry has an Allow action that opens the policy override with that source already filled in. Sources that are not https, that are private, or that appear in `script-src` need a confirmation, which is `insecure-scheme`, `private-host` or `remote-script`. The override's event records the confirmation.

[Plugin lifecycle and administration](reference/lifecycle.mdx) describes the states, the pages and the commands.
