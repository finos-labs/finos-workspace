---
title: How to export a dashboard as a PDF or an image
sidebar_position: 7
---

# How to export a dashboard as a PDF or an image

This guide saves what a dashboard shows as a PDF file or as PNG images, for a report or an email. The export draws the dashboard as it looks in your browser, with the values that its parameters have now.

## Export the dashboard

1. Open the dashboard that you want to export. The export item of the menu works only on the dashboard that is open, and on any other dashboard it is disabled with the hint that you need to be inside the dashboard.
2. Right-click the dashboard in the sidebar, or select the three dots that appear next to it, and choose Export PDF. The dialog Export PDF opens, with the description "Export your dashboard as a PDF or PNG."
3. In Save as, keep or change the name of the file. It starts with the date and the time, then the values of the dashboard's groups when it has any, then the dashboard's name, and the word `report`.
4. In Export as, choose PDF or PNG.
5. When the dashboard has more than one tab, choose the Export scope: Current tab, or All tabs with the number of tabs in brackets. A dashboard has several tabs when it holds a Navigation Bar widget with more than one tab.
6. Select Export.

FINOS Workspace waits until every widget has finished loading its data, and then it draws the dashboard. When you export all tabs, a progress bar shows the tab that it is on, with the text "Exporting tab" and the tab's name. A message says "Report generated successfully" and tells you that the file is in your downloads folder. The picture follows the theme that you are using, so a dark dashboard gives a dark PDF.

A dashboard without widgets cannot be exported. FINOS Workspace says "No widgets to export" and asks you to add some widgets first. If drawing fails, the message says "Error generating report", with the reason when there is one.

## Export the dashboards of a folder

The menu of a folder also has Export PDF. It exports every dashboard in the folder at once into one ZIP file, as [How to organize dashboards in folders](organize-dashboards-in-folders.mdx#rename-export-or-delete-a-folder) describes.

## Export a dashboard that someone shared with you

The menu of a shared dashboard offers Export PDF too, and the dialog works in the same way. Exporting does not change the dashboard.

## Export a dashboard as an app for a backend

An export for a report is not an export for reuse. To turn a dashboard into a template that a backend can offer to its users, follow [How to turn a dashboard into an app of your backend](../build/export-a-dashboard-as-an-app.mdx), and to keep a template for yourself, follow [How to save a dashboard as an app](save-a-dashboard-as-an-app.mdx).
