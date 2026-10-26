---
title: How to design and apply a theme in the admin area
sidebar_position: 1
---

# How to design and apply a theme in the admin area

An admin designs a theme as a preset on Admin → Theme → Presets. A preset is saved with the organization, so it survives restarts, and one preset at a time is applied to everyone in it.

1. Open Admin → Theme and stay on the Presets tab. The Preset menu starts on the preset that is applied, or on FINOS (default) when none is.

2. Choose Light Mode or Dark Mode. The app switches to that mode, so what you edit is what you see. The left column lists the custom properties in groups: Brand first, then the palette ramps, the groups of semantic properties, and Base last. Search by property name to find one. A property that you changed shows in bold, with a button that resets it.

3. Change values. Type a colour, such as `#7b2d8e`, `rgb(123 45 142)`, `color-mix(in srgb, var(--color-main-100) 70%, white)` or `var(--color-light-700)`, or open the colour picker. The font is a menu of the families the app ships. In the Brand group, "Derive from brand color" sets the two other brand shades and the text colour on brand-coloured controls from the brand colour you chose.

   Every change shows at once in the page itself and in the specimen on the right, which draws the buttons, tabs, tags, controls, alerts and a table with the real components. Only you see an unsaved change.

4. Save the changes. "Save" stores them in the selected preset. "Save as…" creates a new preset from them and asks for a name of up to 60 characters, which is unique within the organization without regard to case. FINOS (default) is not stored, so it can only be saved as a new preset.

5. Select "Apply to everyone" to make the selected preset the theme of the organization. Users see it the next time they sign in or load the app. The button is disabled while the preset has unsaved changes.

## Go back or go to another preset

- "Revert" drops the unsaved changes and shows the saved values again.
- Choosing another preset in the menu loads its values into the editor. If there are unsaved changes, the app asks whether to discard them.
- To undo an applied theme, choose FINOS (default) and select "Apply to everyone". Deleting the applied preset has the same effect.
- "Rename" and "Delete" work on the selected preset.

## Use the result as a stylesheet

"Copy CSS" and "Download theme.css" give the stylesheet for the editor's current values, with the light values on `:root` and the dark values on `.dark`. A deployment can mount that file as its theme stylesheet: [How to create a theme for the web app](create-a-theme.md). The applied preset loads after that stylesheet, so it wins where both set a property.

The sign-in page shows the deployment's stylesheet and no preset, since a preset belongs to the organization of a signed-in user.

How presets are stored and applied is on [Theme presets](../../reference/css/theme-presets.mdx).
