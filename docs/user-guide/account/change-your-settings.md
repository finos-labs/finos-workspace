---
title: How to change your settings
sidebar_position: 15
---

# How to change your settings

Every user has settings that change how FINOS Workspace looks and behaves for that person only: the theme, the size of the text, the controls of the dashboards and the security of the account. This guide lists them and what each one does. FINOS Workspace saves a change as soon as you make it, and a message says "Display settings updated". The settings belong to your account, so they follow you to another computer.

## Open the settings

Select the menu icon next to the logo at the top of the sidebar, which has the tooltip Settings Menu, and choose Settings. The same menu opens the admin area for an admin, through Admin Portal, and it has the item Shortcuts Menu, which lists the keyboard shortcuts, and the item Log out. The page has five tabs: General, Layout, Widget, Advanced and Security.

## General

- **Theme** switches between Dark mode and Light mode, and each choice shows a preview. The shortcut Ctrl+M, or Cmd+M on a Mac, switches it from anywhere. A deployment chooses the theme that new users start with, and an admin can change how the themes look, as [How to design and apply a theme in the admin area](../administration/design-a-theme-in-the-admin-area.mdx) describes.
- **Font size** is Medium or Large, and it changes the size of the text throughout the web app.
- **AI enhancements** switches on the features that rely on the language model of the deployment, which can be a third-party vendor. They suggest a title and a description for a widget that the agent creates and for a file that you upload, they give a chat its title, and they name a new dashboard. The setting is on by default. Switch it off when you do not want these suggestions, and the names then come from the files and from a list of generated names.

## Layout

- **Corner drag handles** lets you choose which corners of a widget show a handle for resizing it. Click a corner of the small drawing to switch its handle on or off.
- **Quick add toolbar** keeps the button at the bottom right of a dashboard, which adds widgets, always visible. Untick it to hide the toolbar, and add widgets from the widget menu, which Ctrl+K, or Cmd+K on a Mac, opens.
- **Collapsed sidebar and AI chat visibility** makes the button that expands a collapsed sidebar or a collapsed Copilot appear only when you point at its edge.

## Widget

- **Collapse widget controls** hides the action icons of a widget behind a chevron that you reveal by pointing at the widget.
- **Minimize button on header** adds an icon to the header of a widget that collapses the widget in place.
- **Auto-hide iframe widget navbar (show on hover)** hides the address bar of an iframe widget until you point at it.

## Advanced

The section Danger Zone deletes things for good, and neither action can be undone:

- **Clear All Dashboards** deletes all your dashboards and signs you out, so you sign in again.
- **Delete Account** deletes your account and everything in it. A dialog asks "Are you sure you want to delete this account" and the account's email address, and tells you that your access to FINOS Workspace and all API keys will be revoked. Select Yes, delete account to go on.

## Security

The tab Security switches two-factor sign-in on and off, as [How to set up two-factor sign-in](set-up-two-factor-sign-in.md) describes.
