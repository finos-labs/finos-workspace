---
title: Create and arrange dashboards
sidebar_position: 1
---

# Create and arrange dashboards

This guide creates a dashboard, adds widgets to it, moves and resizes them, splits the dashboard into tabs, refreshes the data, and renames, duplicates or deletes the dashboard. [Dashboard](../../concepts/dashboard.md) says what a dashboard is.

## Create a dashboard

1. Select **Create Dashboard** under **My Dashboards** in the sidebar.

To create a dashboard inside a folder, open the menu of the folder and choose **Create dashboard**, as [Organize dashboards in folders](organize-dashboards-in-folders.mdx) describes.

The new dashboard is empty. It shows the card **Add Widgets** with the text "Add widgets to your dashboard to start visualizing data".

## Add widgets

1. Select **Add widgets** on the card of an empty dashboard. On a dashboard that has widgets, select the widget button at the bottom right of the dashboard, whose tooltip says "Add widgets". You can also press Ctrl+K, or Cmd+K on a Mac, to open the widget menu.
2. Choose the widgets that you want. The menu lists the widgets that your backends offer and the files and pages that you added. The core widgets **Iframe** and **Navigation Bar** are under **Others** and **Utils**.
3. Select **Add widgets**.

The widgets appear on the dashboard. You can add the same widget again, and each card keeps its own parameter values.

On a dashboard that somebody shared with you, the button is disabled. You can change parameters and switch tabs, but you cannot add, remove or resize widgets. To change the dashboard, select **Duplicate dashboard** in the tooltip of the button, and work on your copy. The button is also disabled on a dashboard that an app locked, as [Browse and open apps](../apps/browse-and-open-apps.md) describes.

## Move and resize widgets

A dashboard is a grid that is 40 columns wide. Each row is 25 pixels high.

1. Drag a card by its header to move it.
2. Drag a corner of a card to resize it.

The options menu of a card, whose tooltip says "Options", has **Minimize** and **Expand**. A minimized card is one row high.

## Use tabs

A dashboard has one page. To split it into tabs, add the **Navigation Bar** widget, which creates nested tabs inside the main tab. It always spans the full width of the dashboard and is two rows high. Each tab of the bar needs a name that no other tab of the bar has.

## Refresh the data

Each card has a refresh button in its header. Its tooltip says "Last refresh" and how long ago it was. Select the button to fetch the data again. A widget that has a **Run** button, which a backend can ask for, fetches only when you select the button, and the tooltip says "Click to run" and shows when it last ran.

## Rename, duplicate or delete a dashboard

Right-click the dashboard in the sidebar, or select the three dots that appear next to it. The menu has these entries:

- **Rename** opens a dialog with the name.
- **Move to** puts the dashboard into a folder, as [Organize dashboards in folders](organize-dashboards-in-folders.mdx) describes.
- **Duplicate** copies the dashboard and opens the copy.
- **Open in a new window** opens the dashboard in a second browser window.
- **Share** gives other people access, as [Share a dashboard](../sharing/share-a-dashboard.md) describes.
- **Delete** removes the dashboard. A dashboard that you have not changed disappears at once. For a dashboard with changes, a message asks "Delete dashboard?" and says that the action is permanent and cannot be undone. Select **Yes, delete** to remove it.
- **Export PDF** exports the dashboard that is open, as [Export a dashboard](export-a-dashboard.md) describes.
- **Save App** saves the dashboard as an app, as [Save a dashboard as an app](../apps/save-a-dashboard-as-an-app.mdx) describes.
- **Show grouping** and **Hide grouping** show or hide the labels of the groups of linked parameters, as [Link the parameters of widgets](../widgets/link-the-parameters-of-widgets.md) describes.
