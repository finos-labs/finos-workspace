---
title: How theming works
sidebar_position: 9
---

# How theming works

The web app has to look right in a light and a dark theme, and every deployment wants to make it look like its own. This page explains how the colors are organized so that both are possible, why a theme can be a single stylesheet or a preset that an admin saves in the app, and why the widgets that draw in frames are styled by their authors and not by FINOS Workspace.

## Roles and colors

The components of the web app mostly name a role and not a color. A button's background is `bg-btn-primary-bg`, for example, and a theme decides which color that is. This is the idea of design tokens, which Material and GitHub's Primer also use. The components stay the same, and the theme maps each role to a value, once for the light theme and once for the dark theme. The custom properties in `tokens.css` are those tokens.

Beneath the roles sits a palette of steps, such as `light-100`, which is a set of custom properties as well. A component can name a step directly, and the class then reads the same property that the roles refer to. A theme can therefore change a step and move everything that names it. The colors that remain outside the system are Tailwind's own, which are `white`, `black` and the named hues. [Styling surfaces](../reference/css/styling-surfaces.mdx) counts how often each is used.

## Why a theme is a stylesheet on top of the base

The app always carries a complete theme. The base stylesheets declare the FINOS palette, with the brand colors exactly as FINOS supplies them, and every semantic property. A deployment's theme is a second stylesheet, which `WL_STYLESHEET` names. It loads after the base and declares only what differs. This is the same layering that Bootstrap's CSS variables offer, with a framework's defaults underneath a site's own stylesheet, and it means that a theme never has to repeat the palette or rebuild the frontend.

The three brand steps are plain values and are not derived from one color, so that the base shows exactly the colors that FINOS gave. A theme that has a color of its own can derive the shades in its stylesheet with `color-mix`. The text color on brand-colored controls cannot be derived, because CSS has no rule for choosing light or dark text from a background. It is therefore a property of its own, which a theme sets when its brand color is light.

## Why a preset is stored on the server

A stylesheet belongs to a deployment. Whoever runs the containers decides it, and changing it means editing a file and restarting. A preset belongs to an organization instead. Its admins design it in the app, with the real components showing every change before anyone else sees it. The WordPress Customizer works in the same way: the live preview is yours alone until you publish. Applying a preset is the publish step, which is why the editor saves first and applies second, and why only one preset applies at a time.

The preset is stored with the organization in the database, so it survives restarts and travels with the data. The app applies it after the stylesheet, because the person who set it most recently, in the app, is the one who means it. The values enter the page through the CSS object model one property at a time, so what an admin types is never parsed as a stylesheet.

## Why widgets do not inherit the app's styles

An HTML widget, an iframe widget, a plugin and an Agent artifact each draw in a frame of their own. Figma's plugin iframes use the same arrangement. It keeps code from outside away from the page, so that the code cannot read the session or restyle the app. A side effect is that the frame inherits nothing, including the custom properties.

The theme therefore reaches such a frame as a message, either the `theme` query parameter or the `theme` trait, and the author decides what the light and dark versions look like. FINOS Workspace does not restyle what an author draws. The author owns the appearance of the widget, and the app owns the card around it.
