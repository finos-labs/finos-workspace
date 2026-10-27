---
title: Plugin permissions and commands
sidebar_position: 3
---

# Plugin permissions and commands

A permission is something that a widget's manifest asks for and an admin approves. A command is the call that the module makes with `experimental.invoke` to use a permission. The host checks every command against the widget's effective permissions before it carries the command out.

A widget should ask only for the permissions that it uses. An organization can remove permissions for its users, so the module reads the `capabilities` trait before it calls a command and degrades gracefully when a permission is missing.

## Permissions

| Permission | What it allows |
|---|---|
| `core:default` | The lifecycle, error reporting and logs. Every widget always has it. |
| `core:data:read` | Reading the `data` trait. |
| `core:params:write` | Writing to `params` and to `param:<name>`. Only declared names can be written, and the host coerces each value to the type of its parameter. |
| `core:state:write` | Writing to `state`. |
| `core:copilot:context` | Letting the host call the module's `copilotContext()` function. |
| `core:export:provide` | Letting the Export entry call the module's `exportOptions()` and `exportData()` functions. |
| `core:ui:notify`, `core:ui:open-link`, `core:clipboard:write`, `core:download:save`, `core:proxy:call` and `core:backend:call` | Using the command of the same name, which the next section describes. |

## Commands

The call `experimental.invoke(name, msg, { buffers, signal, timeout })` returns a promise that resolves to `[value, DataView[]]`. The call times out after 10 seconds unless the module passes a `timeout` or a `signal`. Buffers are `ArrayBuffer` objects or typed arrays.

| Command | Permission | Message | Behavior and limits |
|---|---|---|---|
| `core:asset:read` | `core:default`, which every widget has | `{ path }`, where the path names a file under `assets/` | The call resolves to `{ path, size }` and passes the file as the one buffer. The host checks the file against the approved version. Another path is an `invalid_args` error, and a file that the version does not contain is an `out_of_scope` error. A large file needs a longer `timeout`. |
| `core:ui:notify` | `core:ui:notify` | `{ level, text }`, where `level` is `info`, `success`, `warning` or `error` | The host shows the text as plain text of at most 500 characters, labelled with the plugin's name, and it rate limits the notices. |
| `core:ui:open-link` | `core:ui:open-link` | `{ url }` | The host opens only `https:` and `mailto:` links, and only after the user confirms. |
| `core:clipboard:write` | `core:clipboard:write` | `{ text }` | The text may be at most 1 MiB, and the user must have clicked in the widget. |
| `core:download:save` | `core:download:save` | `{ filename, mime }`, with the file as the first buffer | The file may be at most 25 MiB, and the host cleans the file name. |
| `core:proxy:call` | `core:proxy:call` | `{ id, args }` | The call runs a proxy that the widget declares, as [Plugin proxies and secrets](proxies.md) describes, and it resolves to the response body. |
| `core:backend:call` | `core:backend:call` | `{ route, args }` | The call runs a route of the plugin's backend that the widget declares, as [Plugin backends](backends.md) describes, and it resolves to the route's JSON. |

When the host refuses a call, the promise rejects with an `Error` whose `name` is one of the following values: `not_granted`, `invalid_args`, `out_of_scope`, `rate_limited`, `too_large`, `unknown_command`, `timeout` or `unavailable`. At most 32 calls may wait for an answer at the same time.

The messages that carry these calls between the frame and the host are on [Plugin frame protocol](../protocols/plugin-frame.md).
