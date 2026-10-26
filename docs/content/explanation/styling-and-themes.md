---
title: About styling and themes
---

# About styling and themes

## Roles and colours

The web app's components mostly name a role, not a colour: a button's background is `bg-btn-primary-bg`, and a theme decides what colour that is. This is the idea of design tokens, as in Material or GitHub's Primer: the components stay the same and the theme maps roles to values, once for the light theme and once for the dark theme. The custom properties of `tokens.css` are those tokens.

Beneath the roles sits a palette of steps, such as `light-100`, which is also a set of custom properties. A component can name a step directly, and the class reads the same property that the roles refer to, so a theme can change a step and move everything that names it. The colours that remain outside the system are Tailwind's own: `white`, `black` and the named hues. [Styling surfaces](../reference/css/styling-surfaces.mdx) counts each.

## Why a theme is a stylesheet on top of the base

The app always carries a complete theme: the base stylesheets declare the FINOS palette, with the brand colours as FINOS supplies them, and every semantic property. A deployment's theme is a second stylesheet, named by `WL_STYLESHEET`, that loads after the base and declares only what differs. This is the layering of a framework's defaults under a site's own stylesheet, as with Bootstrap's CSS variables, and it means a theme never has to repeat the palette or rebuild the frontend.

The three brand steps are plain values, not derived from one colour, so that the base shows exactly the colours FINOS gave. A theme with a colour of its own derives the shades in its stylesheet with `color-mix`. The text colour on brand-coloured controls cannot be derived, since CSS has no rule for choosing light or dark text from a colour, so it is a property of its own that a theme sets when the brand colour is light.

## Why a preset is stored on the server

A stylesheet belongs to a deployment: whoever runs the containers decides it, and changing it means editing a file and restarting. A preset belongs to an organization, and its admins design it in the app, with the real components showing every change before anyone else sees it. This is how the WordPress Customizer works: the live preview is yours alone until you publish. Applying a preset is the publish step, which is why the editor saves first and applies second, and why one preset is applied at a time.

The preset is stored with the organization in the database, so it survives restarts and travels with the data. It is applied after the stylesheet, since the person who set it most recently, in the app, is the one who means it. The values go in through the CSS object model one property at a time, so what an admin types is never parsed as a stylesheet.

## Why widgets do not inherit the app's styles

An HTML widget, an iframe widget, a plugin and a Copilot artifact each draw in a frame of their own. That is the arrangement of Figma's plugin iframes: code from outside is kept away from the page, so it cannot read the session or restyle the app. A side effect is that the frame inherits nothing, including the custom properties.

So the theme reaches such a frame as a message, the `theme` query parameter or the `theme` trait, and the author decides what the light and dark versions look like. Workspace does not restyle what an author draws: the author owns the appearance of the widget and the app owns the card around it.
