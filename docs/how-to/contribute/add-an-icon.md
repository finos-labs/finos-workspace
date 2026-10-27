---
title: How to add an icon
sidebar_position: 4
---

# How to add an icon

The web app draws all its icons from one file, the sprite `frontend/public/assets/icons/sprite.svg`, and a component looks an icon up by its id. This guide adds an icon to the sprite, makes the id known to the type checker and uses the icon. Run the commands in `frontend`.

## Get the SVG

Take the icon from your designer or from a library of open icons, as an SVG file. The icons of the sprite are drawn on grids of several sizes, most of them 16, 24 or 14 pixels wide, and most paint their strokes and fills with `currentColor`, so that they take the text color of the place where they appear. Do the same with yours, unless it is a logo with colors of its own.

## Add it to the sprite

1. Open `public/assets/icons/sprite.svg`. It is one `<svg>` that holds a `<symbol>` for each icon.
2. Turn your SVG into a `<symbol>` with an `id` that no other symbol uses, and put it inside the sprite's `<svg>`. The `id` is the name that you use in the code. The symbol keeps the `viewBox` and the paths of the file that you took.
3. Search the sprite for the `id` to be sure that it is unique. The existing ids are lower-case words joined with hyphens, such as `trash-04`.

## Make the id known

The type `IconId`, in `src/components/Icon.types.ts`, lists every id of the sprite, and the type checker refuses an id that is not in the list. A script reads the sprite and rewrites the list:

```bash
npm run update-icons
```

The script prints the ids that it found and says that it updated the list. It sorts the ids alphabetically, so the diff of `Icon.types.ts` shows only your new id. It stops with an error when it cannot find the list in the file.

## Use the icon

```tsx
import Icon from "~/components/Icon";

<Icon id="your-id" className="size-4" />
```

The component draws an `<svg>` of 16 by 16 pixels that refers to the symbol in the sprite. Pass a class to change the size or the color. The address of the sprite carries the version of the app, so that browsers load a new sprite after a release.

A few icons are components of their own in `src/components/Icons.tsx` and the folder `src/components/Icons`. They are not in the sprite, and you do not add new icons there.

## Check it

Run `npm run typecheck` to see that the new id is accepted, and `npm run test:unit` for the tests of the icon component. Start the app with `npm run dev` and look at the icon in both themes, because a symbol with a fixed fill color does not follow the theme.
