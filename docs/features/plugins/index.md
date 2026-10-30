---
slug: /features/plugins
title: Plugins
sidebar_position: 0
sidebar_label: Overview
---

# Plugins

A widget plugin teaches FINOS Workspace to draw a new type of widget. This section shows how to build, try, deploy and administer plugins.

## Start here

[Build your first widget plugin](../../tutorials/plugins/build-your-first-widget-plugin.md) walks you through a plugin that draws rows as a table, from the first file to a widget on a dashboard.

## Guides

| I want to | Read |
|---|---|
| Try a plugin on my own stack | [Build and try a widget plugin](../../tutorials/plugins/build-a-plugin.md) |
| Style a plugin for the light and dark themes | [Style a plugin widget for both themes](../../tutorials/plugins/style-a-plugin-widget.md) |
| Let users export what a widget shows | [Add an export to a plugin widget](../../tutorials/plugins/add-an-export-to-a-plugin.mdx) |
| Call an API whose key must stay on the server | [Call an API with a secret from a plugin](../../tutorials/plugins/call-an-api-from-a-plugin.md) |
| Reuse the JavaScript of an anywidget | [Port an anywidget to a plugin](../../tutorials/plugins/port-an-anywidget.md) |
| Put plugins on a deployment | [Deploy a widget plugin](../../tutorials/plugins/deploy-a-plugin.md) |
| Run the server code of a plugin | [Run a plugin backend](../../tutorials/plugins/run-a-plugin-backend.md) |
| Approve a plugin and give it to users | [Review and enable a widget plugin](../../tutorials/plugins/review-and-enable-a-plugin.md) |

## Background

- [Widget plugins](../../concepts/widget-plugins.md) explains what a plugin is and how it works.
- [The widget plugin security model](../../concepts/widget-plugin-security.md) explains why a plugin cannot harm a deployment.

## Reference

The [plugin reference](../../reference/plugins/package-and-manifest.mdx) has the package and manifest, the module contract, permissions and commands, the frame policy, proxies, backends and the lifecycle. The format of the manifest is [plugin.json](../../reference/schemas/plugin-json.mdx).
