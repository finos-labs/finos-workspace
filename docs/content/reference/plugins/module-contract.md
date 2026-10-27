---
title: Plugin module contract
sidebar_position: 2
---

# Plugin module contract

A plugin's code is one bundled ES module named `entry.js`. Its default export is the widget, or an async function that returns the widget, and Workspace uses nothing else that the module exports. The contract is the one that Anywidget defines (AFM 0.11), so the same `render({ model, el })` function that Jupyter widgets use works here.

```js
export default {
  async initialize({ model, signal, experimental }) {},
  async render({ model, el, signal, host, experimental }) {
    const draw = () => {
      el.textContent = JSON.stringify(model.get("data"));
    };
    model.on("change:data", draw);
    draw();
    return () => model.off("change:data", draw);
  },
};
```

The `initialize` function runs once for each frame, before `render`. It may return nothing, a cleanup function, or an object of exports, which a later section describes.

## Lifecycle

A widget goes through four stages.

1. The frame starts and checks its own sandbox and policy. It then receives the verified files and the initial value of every bound trait.
2. The frame awaits `initialize` and then awaits `render`, and each of them has 15 seconds. When one of them throws or rejects, the next one does not run, `signal` aborts, and the card shows an error that contains the module's message.
3. While the widget runs, host pushes fire `change:<trait>` events. The module writes with `set` and `save_changes`, it calls host commands with `experimental.invoke`, and the host calls the module's exports.
4. When the widget is removed or reloaded, `signal` aborts and every cleanup function that the module returned runs once. The host then empties `el` and removes the frame.

Every frame runs its own `initialize`, and that includes a fullscreen view of the same widget. A module therefore must not rely on state that is shared between views. The module sizes itself with a `ResizeObserver` on `el`, because the host sizes the frame.

The `render` function can run before the frame has a size. A dashboard places its cards after their frames start, so `el` may measure 0×0 at first, and text measures zero width in a frame that has no size. A library that measures text when it draws, such as a chart that lays out its legend or its axis labels, and that keeps the measurement, would draw wrongly from then on. The module should therefore draw once `el` has a size and draw again whenever it gets a new one.

## The model

The model holds the widget's traits. A trait is a named value that is bound to some piece of host state, and the module reads and writes traits through these methods:

| Method | What it does |
|---|---|
| `model.get(name)` | It returns a copy of the trait's value. To change the value, the module calls `set`. |
| `model.set(name, value)` | It sets the local value and fires `change:<name>`. |
| `model.save_changes()` | It sends the changed traits that are bound and writable. The host echoes back what it accepted. A refused write is echoed with the previous value, which fires `change:` again. |
| `model.on(event, callback)` and `model.off(event?, callback?)` | They add and remove listeners. The callbacks of `change:<name>` receive no arguments. Calling `off()` removes every listener, and `off(event)` removes the listeners of that event. |
| `model.send(content, callbacks, buffers)` | It sends a message to the host. The host answers only anywidget's own `invoke` message, which has `kind: "anywidget-command"`, and it answers with a `msg:custom` event that has the same `id`. The host drops every other message. |
| `model.on("msg:custom", (content, buffers) => ...)` | It receives host events. The host sends `{ kind: "workspace-event", name: "refresh" }` when the user refreshes the widget, and `{ kind: "workspace-event", name: "visibility", visible }` when the widget becomes visible or hidden. |

When the manifest has no `model.traits` entry, the model offers these traits:

| Trait | Value | Writable |
|---|---|---|
| `data` | The JSON that the widget's backend endpoint returned, taken after `dataKey`, or the widget's rows while the user shows them. It requires `core:data:read`. | No. |
| `params` | The widget's parameters as an object of `{ name: value }`. | Yes, with `core:params:write`, but only for declared names. |
| `definition` | The `data.<type>` object of the backend widget, which has been checked against the `definition` schema. | No. |
| `config` | The settings of this widget instance. | No. |
| `adminSettings` | The settings that the organization's admin made. | No. |
| `state` | The module's own instance state, which is saved with the dashboard and may hold at most 64 KiB of JSON. | Yes, with `core:state:write`. |
| `theme` | An object of the form `{ mode, tokens, locale, decimals }`. The module should follow it and react to `change:theme`. It is meant for the plugin's own interface, whereas the content that a backend returns is drawn as its author made it. | No. |
| `capabilities` | The module's effective permissions. The module should check them before it calls a command. | No. |
| `meta` | An object of the form `{ pluginId, version, widgetId, instanceId }`. | No. |

A module that already uses other trait names can keep them by binding them in the manifest:

```json
"model": { "traits": { "rows": { "bind": "data" }, "filter": { "bind": "param:filter", "access": "readwrite" } } }
```

A binding names one of the traits above, or it has the form `param:<name>`, `config:<key>` or `adminSettings:<key>`. Only `params`, `param:<name>` and `state` can be `readwrite`. A trait without a binding exists only inside the frame.

### Rows

A backend widget that sets `raw` has a button that shows its rows instead of its view. When the widget has no `data.rawType`, or when the user may not use the plugin that `rawType` names, the module itself shows the rows. In that case `data` holds the rows, usually as an array of objects, and the frame starts again with them. It starts again when the user switches back to the view. The module should show the rows as a table, or it should say that it cannot show them. The AI agent receives the rows in either case, so a widget with `raw` does not need to provide `copilotContext`. [Widget rows](../protocols/raw-rows.md) describes the feature.

## Exports

The `initialize` function may return an object instead of a cleanup function. The host calls the members of that object:

```js
async initialize({ model }) {
  return {
    async exportOptions() {
      return [{ id: "rows", label: "Rows (CSV)", extension: "csv", mime: "text/csv" }];
    },
    async exportData(id, { title }) {
      return toCsv(model.get("data"));
    },
    async copilotContext() {
      return { rows: model.get("data")?.length ?? 0 };
    },
  };
}
```

The function `exportOptions` returns the exports that the widget offers right now, or an empty list when it offers none. The function `exportData` returns the content of one export as a string, an `ArrayBuffer`, a typed array or a `Blob`, or it returns `null` when there is nothing to export. The card's Export entry appears when the widget has the permission `core:export:provide` and the module provides both functions.

An export has the following limits. A widget may offer at most 16 options. An id may contain letters, digits, `_`, `.` and `-`, and a label has 1 to 60 characters. An extension has 1 to 10 letters or digits, and a `mime` value has the form `type/subtype`. The exported file may be at most 25 MiB. The function `exportOptions` has 10 seconds and `exportData` has 60 seconds.

The host calls `copilotContext` when the user asks the AI agent about the dashboard, provided that the widget has the permission `core:copilot:context`. The result may be at most 256 KiB, and the function has 10 seconds to produce it.

A module that returns exports from `initialize` cannot return a cleanup function as well, so it performs its cleanup through `signal`.

## Errors and budgets

The host logs uncaught errors and unhandled rejections, and it does not treat them as fatal. The frame does have a message budget of about 100 messages per second, with bursts of up to 200, and each message may be at most 1 MiB. The host ends the frame when the module breaks the budget, when it sends a message that the protocol does not define, or when it fails three times within ten seconds. The card then shows the reason. The host also pings the frame, and it ends a frame that stops answering as unresponsive.

## Differences from anywidget in Jupyter

| In Jupyter | In a Workspace plugin |
|---|---|
| A Python class holds the traits, and the kernel answers `model.send`. | There is no kernel. The traits are bound to host state, and a round trip to server code is a [proxy](proxies.md) or a [backend route](backends.md). |
| The `_esm` and `_css` values may be URLs. | The package supplies `entry.js` and `entry.css` as bundled files, and the host adds the CSS as a `<style>` element. |
| The calls `host.getWidget` and `host.getModel` and the property `model.widget_manager` reach other widgets. | They reject with `not_available`, because a widget cannot reach any other widget. |
| The views of one model share its `initialize`. | Every frame runs its own `initialize`, and that includes a fullscreen view. |
| `experimental.invoke` calls Python. | It calls a host command, which [Plugin permissions and commands](commands-and-permissions.md) lists. |
| The widget can use the page's storage, cookies, popups and network. | The widget has none of these. The opaque origin of the frame makes storage and cookies unavailable, the host blocks popups, alerts and navigation, and the network is limited to what the frame's [policy](frame-policy.md) allows. |
