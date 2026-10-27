---
slug: /how-to
title: How-to guides
sidebar_label: Overview
sidebar_position: 0
---

# How-to guides

A how-to guide is a recipe for one goal. It assumes that you know the basics, it gives the steps, and it leaves out the teaching. If you are new to Workspace, start with the [tutorials](/tutorials) instead. For exact values, see the [reference](/reference), and for the reasons behind a step, see the [explanation](/explanation).

## Use Workspace

These guides are for everyone who works with dashboards:

- [How to share a dashboard](use/share-a-dashboard.md) gives colleagues access to a dashboard or an app and takes it away again.
- [How to save a dashboard as an app](use/save-a-dashboard-as-an-app.mdx) keeps a dashboard as a template, with suggested prompts for the Copilot.
- [How to connect a backend](use/connect-a-backend.md) adds a data backend to your own account and keeps it current.
- [How to organize dashboards in folders](use/organize-dashboards-in-folders.mdx) groups dashboards, and moves them between folders.
- [How to link the parameters of widgets](use/link-the-parameters-of-widgets.md) makes widgets share one value.
- [How to add files to a dashboard](use/add-files-to-a-dashboard.mdx) turns files that you drop on a dashboard into widgets.
- [How to export a dashboard as a PDF or an image](use/export-a-dashboard.md) saves what a dashboard shows.
- [How to connect an MCP server](use/connect-an-mcp-server.mdx) gives the Copilot the tools of a server of your own.
- [How to use and write skills for the Copilot](use/use-and-write-skills.mdx) saves instructions that the Copilot loads when it needs them.
- [How to save and reuse prompts](use/save-and-reuse-prompts.md) keeps the questions that you ask often.
- [How to attach files to a question](use/attach-files-to-a-question.mdx) lets the Copilot read a file for one chat.
- [How to dictate a question](use/dictate-a-question.mdx) speaks a question instead of typing it.
- [How to set up two-factor sign-in](use/set-up-two-factor-sign-in.md) protects your account with an authenticator app.
- [How to embed a web page as a widget](use/embed-a-web-page.md) shows a page of another site on a dashboard.
- [How to change your settings](use/change-your-settings.md) walks through the tabs of your settings.
- [How to connect an outside AI host to Workspace](use/connect-an-outside-ai-host.mdx) lets a desktop assistant or a coding tool work with your dashboards.

## Administer your organization

These guides are for the admins of an organization:

- [How to add a user](administer/add-a-user.mdx)
- [How to reset a password or two-factor sign-in](administer/reset-a-password-or-two-factor.mdx)
- [How to create a role](administer/create-a-role.md)
- [How to choose the models and tools of a role](administer/choose-the-models-and-tools-of-a-role.md)
- [How to give a role access to data](administer/give-a-role-access-to-data.md)
- [How to add a data backend for your organization](administer/add-a-data-backend-for-your-organization.md)
- [How to approve share requests](administer/approve-share-requests.md)
- [How to provision an organization from a file](administer/provision-an-organization.mdx)
- [How to manage organizations and move users between them](administer/manage-organizations.md)
- [How to set up single sign-on](administer/set-up-single-sign-on.md)

## Deploy and operate

These guides are for the people who run a deployment:

- [How to choose where files are stored](deploy/choose-file-storage.md)
- [How to serve Workspace over HTTPS and set the addresses](deploy/serve-over-https-and-cors.mdx)
- [How to connect Workspace to its database and cache](deploy/connect-the-database-and-cache.md)
- [How to run database migrations](deploy/run-database-migrations.mdx)
- [How to choose the Copilot's model and provider](deploy/choose-the-copilot-model.mdx)
- [How to switch on the search of documents](deploy/enable-document-search.mdx)
- [How to switch on dictation](deploy/enable-dictation.mdx)
- [How to run the agent on several replicas](deploy/run-the-agent-on-several-replicas.mdx)
- [How to ship logs and metrics](deploy/ship-logs-and-metrics.mdx)
- [How to export traces of the Copilot](deploy/export-traces.mdx)

## Customize the look

These guides change how the web app looks, for a whole deployment or for one organization:

- [How to design and apply a theme in the admin area](customize/design-a-theme-in-the-admin-area.mdx) edits every color and the font with the whole app showing the change, and saves the result as a preset.
- [How to create a theme for the web app](customize/create-a-theme.md) writes a stylesheet that the deployment loads.
- [How to change the brand color and font](customize/change-brand-color-and-font.md) changes the two properties that most deployments change first.

## Build for Workspace

These guides are for the people who write backends and widgets:

- [How to write the widgets.json of a backend](build/write-widgets-json.md) describes the widgets of a backend and turns an existing endpoint into one.
- [How to make a widget readable by the Copilot](build/make-a-widget-readable-by-the-copilot.md) helps the Copilot find a widget and read its rows.
- [How to turn a dashboard into an app of your backend](build/export-a-dashboard-as-an-app.mdx) writes the `apps.json` entry from a dashboard that you built.
- [How to review and debug a backend](build/review-and-debug-a-backend.md) reads the notices that Workspace gives and fixes what they report.
- [How to style an HTML widget for both themes](build/style-an-html-widget.md)
- [How to style a plugin widget for both themes](build/style-a-plugin-widget.md)

## Widget plugins

Plugins add new widget types. The first three guides are for the people who run a deployment, and the others are for plugin authors:

- [How to deploy a widget plugin](plugins/deploy-a-plugin.md)
- [How to run a plugin backend](plugins/run-a-plugin-backend.md)
- [How to review and enable a widget plugin](plugins/review-and-enable-a-plugin.md)
- [How to build and try a widget plugin](plugins/build-a-plugin.md)
- [How to port an anywidget to a plugin](plugins/port-an-anywidget.md)
- [How to call an API with a secret from a plugin](plugins/call-an-api-from-a-plugin.md)
- [How to add an export to a plugin widget](plugins/add-an-export-to-a-plugin.mdx)

## Contribute

These guides are for people who change the repository itself:

- [How to run the development stack](contribute/run-the-development-stack.md) starts the app with hot reload.
- [How to run the tests](contribute/run-the-tests.md) gives the commands of every part's checks.
- [How to add a database migration](contribute/add-a-database-migration.md) generates, edits and tests a revision.
- [How to add an icon](contribute/add-an-icon.md) puts an icon into the sprite and the type.
- [How to write and preview documentation](contribute/write-docs.md) explains the structure of these pages and how they are built.
- [How to regenerate the reference data](contribute/regenerate-reference-data.md) writes the files that the reference pages are generated from.
