---
title: How to share a dashboard
sidebar_position: 1
---

# How to share a dashboard

This guide gives colleagues in your organization access to one of your dashboards, and takes it away again. Sharing an app works in the same way, and the differences are at the end.

## What you need

Your roles have to give you the sharing level Can share, and each person you share with needs Receive only or Can share. An organization also has a master switch for sharing, which a superuser controls, and nobody can share or receive while it is off. When your roles do not let you share, the Share item is missing from your menus. [About roles and access](../../explanation/roles-and-access.md) explains the levels, and [How to create a role](../administer/create-a-role.md) shows an admin how to grant them.

## Share the dashboard

1. Right-click the dashboard in the sidebar, or select the three dots that appear next to it, and choose Share.
2. If the dashboard has widgets that come from a connected backend or from files that you uploaded, Workspace first asks "Widgets uploaded may contain sensitive data". Check that the dashboard holds nothing that the recipients should not see, and select Continue. When the address of one of those widgets contains a word such as `secret`, `api`, `key`, `token` or `auth`, the question adds a warning that Workspace found a high probability of sensitive keys, so check those widgets before you continue.
3. In the dialog Share dashboard with, find the person. The list, which is headed Users from your organization, holds the people of your organization whose roles let them receive shares, and you can narrow it by typing part of an email address in the Email box.
4. Change the person's menu from No Access to View.
5. Select Save.

A message says "Dashboard shared permissions updated". When the dashboard has widgets from a data backend or a file, the message adds that shared users will not be able to view data connector widgets. The next section says when such a widget does load.

The dialog lists the people who already have access first. A tooltip on a person's menu shows the day on which you shared the dashboard.

## What the recipient sees

The recipient finds the dashboard in the sidebar under Shared with me. Its widgets show the data that they load, and the button that removes a widget is disabled. The menu of the dashboard offers Duplicate, Delete, Export PDF and Refresh data. Duplicate creates a copy that is named like the original with `(Duplicate)` added, puts it under My Dashboards and opens it, and the recipient can change the copy freely.

A widget's request carries the credentials of the viewer's own connection to its backend, or those of a backend that one of the viewer's roles shares, and nothing else. The credentials of your connections are not shared with a dashboard. A widget whose backend needs a credential can therefore fail for a recipient who has no access to that backend. Widgets of a backend that needs no credential load as they do for you.

## When a Developer shares

A share by a person whose type is Developer waits for an admin. After Save, the message reads "Sent to an admin for approval", and the person's row in the dialog carries the tag Waiting for approval until an admin decides. [How to approve share requests](../administer/approve-share-requests.md) describes what the admin does.

## Stop sharing

Open the Share dialog again, change the person's menu to No Access and select Save. Workspace deletes the share, so the person no longer has access to the dashboard.

## Share an app

An app is shared from the Apps page. Select the share icon at the bottom right of the app's card, which only apps that you created have, confirm the same question about sensitive data, and then select Click here to add people in the dialog titled `Share '<name>' App`. The list has a search box and a Select All box, and each person has a box of their own. Tick the people, select Save, and the people with access appear under People with access, with you as the owner. [How to save a dashboard as an app](save-a-dashboard-as-an-app.mdx) explains how to create the app.
