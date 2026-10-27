---
title: How to add an export to a plugin widget
---

# How to add an export to a plugin widget

The Export entry on a widget's card calls two functions that the plugin's module returns from `initialize`. What a widget can export depends on its state and its data, and only the widget's own code knows those, so the host defines no export formats.

1. Ask for the permission in the widget's manifest entry:

   ```json
   "permissions": ["core:data:read", "core:export:provide"]
   ```

2. Return the two functions from `initialize`:

   ```js
   async initialize({ model }) {
     return {
       async exportOptions() {
         const rows = model.get("data") ?? [];
         return rows.length
           ? [{ id: "rows", label: "Rows (CSV)", extension: "csv", mime: "text/csv" }]
           : [];
       },
       async exportData(id, { title }) {
         return toCsv(model.get("data"));
       },
     };
   },
   ```

   The host calls `exportOptions` each time the user opens Export, and an empty list means that the widget has nothing to export right now. The function `exportData` returns the content of the chosen export as a string, an `ArrayBuffer`, a typed array or a `Blob`.

3. Do the module's cleanup through `signal`. Because `initialize` returns the exports, it cannot return a cleanup function as well.

[Plugin module contract](../../reference/plugins/module-contract.md) lists the limits, which are at most 16 options, 25 MiB for a file, and a fixed time for each function. A `copilotContext` function, together with the permission `core:copilot:context`, works the same way and tells the AI agent what the widget shows.
