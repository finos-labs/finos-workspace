---
title: How to link the parameters of widgets
sidebar_position: 5
---

# How to link the parameters of widgets

This guide makes widgets on one dashboard share a parameter, so that a change of the value in one widget changes it in all of them. You link widgets with a group. A group has a name, a color and a value, and every widget that you add to it follows the value.

## What you need

You need a dashboard with at least two widgets that declare a parameter of the same name, for example two widgets that both have a `year` parameter. A parameter shows the link icon in its widget's header only when the dashboard offers something to link it to: another widget on the dashboard that declares a parameter of that name, or a group that already exists. When the parameters have lists of choices, more than half of the choices of the shorter list have to appear in the other list too. A dashboard of widgets whose parameters have different names has nothing to link.

You can change the value in a widget of a shared dashboard, but you cannot add or remove its widgets, so duplicate the dashboard first when you want to build groups on it, as [How to share a dashboard](share-a-dashboard.md#what-the-recipient-sees) describes.

## Create a group

1. In the header of a widget, select the link icon in front of the parameter. The menu Groups opens. It says "No Active Groups" while the dashboard has none for this parameter.
2. Select the plus sign, which has the tooltip "Create a group".

Workspace creates a group named Group 1, or the next free number, and gives it the next color of the palette. The group takes the value that the parameter has now, and the widget joins it at once. The link icon in the widget's header turns into a small colored badge with the number of the group.

## Add widgets to the group

1. In the header of another widget, select the link icon in front of the same parameter. The menu lists the group with a checkbox, its color and its value.
2. Tick the checkbox.

The widget adopts the group's value and loads its data again. Untick the checkbox to take the widget out of the group, and the widget keeps the value that it had. From now on, a change of the parameter in any widget of the group changes it in all of them.

A group that is linked to a ticker works in the same way for widgets that show a ticker. Such a group links only widgets of the same asset class, and Workspace explains with the message "Widget from a different asset class" when a widget does not fit. A group of an endpoint parameter links the widgets that share that endpoint parameter.

## Change the color of a group

In the menu Groups, select the colored square in front of a group and pick a color. The color shows on the badge in every widget of the group.

## See and hide the groups

At the bottom right of a dashboard is a small toolbar. Point at it and it opens up. Its first button shows or hides the group labels and indicators in the dashboard, and the shortcut Ctrl+G, or Cmd+G on a Mac, does the same. The menu of the dashboard in the sidebar has the matching item Hide grouping or Show grouping. While the labels are hidden, a parameter that belongs to a group has no menu. It shows a tooltip that says that the parameter is associated with a group and that changing it changes the group, and the border of the parameter takes the group's color when you point at it.

The arrow next to the first button opens Manage groups, a list of every group of the dashboard and its kind, with a button to delete each of them. If no group exists, the list says "No groups available".

The toolbar shows only while the setting Quick add toolbar is ticked, as [How to change your settings](change-your-settings.md) describes. When you have unticked it, the toolbar and its Manage groups list are gone, and the shortcut and the menu item of the dashboard still show and hide the group labels.

## Delete a group

Point at a group in either menu and select the trash icon. Workspace deletes an empty group at once. When widgets still belong to the group, it asks "Group not empty" and explains that deleting the group unlinks all of its widgets. The widgets stay on the dashboard, and each keeps the value that it has.

## Keep the groups in an app

A dashboard that you save as an app keeps its groups, so a dashboard that someone creates from the app starts with the same links. A backend can also ship an app whose layout names groups, as [the schema of `apps.json`](../../reference/schemas/apps-json.mdx) describes.
