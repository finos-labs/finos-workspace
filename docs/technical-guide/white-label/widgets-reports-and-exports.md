---
title: Widgets, reports and exports
sidebar_position: 6
---

# Widgets, reports and exports

Some parts of the page draw in frames of their own, and some things the app creates outside the page. Your theme reaches each of them in a different way.

## HTML and iframe widgets

An HTML widget or an iframe widget shows a page that a backend serves. The page inherits nothing from the app, so its author styles it. FINOS Workspace sends `theme=dark` or `theme=light` with each request, and the page can choose its colors from it. Your brand reaches these widgets when their authors use your colors: [Style an HTML widget for both themes](../build-a-backend/style-an-html-widget.mdx) shows how, and [HTML documents](../../reference/css/html-documents.mdx) lists what the frame adds.

## Plugin widgets

A plugin widget receives the app's current theme as its `theme` trait: the brand color, the background and text colors, and the font, read from the page at that moment. A plugin that uses the trait follows your theme stylesheet and your presets with no work on your side. [Style a plugin widget](../../plugins/style-a-plugin-widget.md) and [Plugin theme](../../plugins/reference/plugin-theme.mdx) describe it.

## Reports, charts and tables from the Agent

The Agent writes HTML reports, charts and tables with skills that are part of the agent. Those skills fix the colors, use the Montserrat font, and end a report with "Generated with Workspace" and the organization's name. A theme does not reach them. To change them, edit the skills in `agent/src/skills/` (`html-report.md`, `html-chart.md` and `html-table.md`) and build the agent image.

## Exported images

When a user exports a dashboard or a widget as an image, the image carries "Exported with Workspace" and the product's logo. Both are in the code.

## Messages from FINOS Workspace

FINOS Workspace sends no email. Notifications for admins, such as the creation of a new organization, go to a webhook that `ADMIN_NOTIFY_WEBHOOK_URL` names, with the sender and recipient in `ADMIN_NOTIFY_SENDER` and `ADMIN_NOTIFY_RECIPIENT`; the service behind the webhook decides how a message looks. [Backend settings](../../reference/configuration/backend.mdx) lists them.

Authenticator apps show the account of a user's two-factor sign-in under the issuer name "Workspace", which is in the code.
