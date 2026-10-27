---
title: Plugin package and manifest
sidebar_position: 1
---

# Plugin package and manifest

A plugin is a package of files that adds widget types to Workspace. This page describes how a package is laid out and what each part of its manifest means. The JSON Schema of the manifest is on [plugin.json](../schemas/plugin-json.mdx).

## The package

Every package lives in a directory that is named after the plugin and its version:

```
<plugin-id>/<version>/
  plugin.json        the manifest
  entry.js           the module, one bundled file
  entry.css          optional styles
  assets/            optional: the icon, and files that the module reads with core:asset:read
  backend/           optional server-side code, which is never served to browsers
```

The names and sizes follow these rules:

- The plugin id has between 2 and 48 characters. It consists of lowercase letters, digits and hyphens, and it starts with a letter.
- The version has the form `major.minor.patch` and contains only numbers. A version is immutable, so a change of any kind requires a new version directory.
- A file name may contain letters, digits, `.`, `_` and `-`. A package may not contain symbolic links.
- A version may hold at most 200 files and 64 MiB by default. The deployment can lower or raise both limits.
- The file `plugin.json` may be at most 256 KiB.

The frame receives `entry.js` and the style sheets. It receives a file from `assets/` only when the module asks for it with the `core:asset:read` command, which is described on [Plugin permissions and commands](commands-and-permissions.md). Nothing else in the package reaches the frame, which means that neither `plugin.json` nor `backend/` is ever sent to a browser.

## The manifest

The manifest describes the plugin, the permissions that it asks for and the widgets that it contributes. This example shows every top-level key with placeholder values:

```jsonc
{
  "manifestVersion": 1,
  "id": "<plugin-id>",
  "version": "1.0.0",
  "name": "<name shown to admins and users>",
  "description": "<one or two sentences>",
  "publisher": { "name": "<who publishes it>", "url": "https://<publisher site>" },
  "icon": "assets/icon.svg",
  "host": { "api": 1, "afm": "0.11" },
  "checksum": "sha256-<printed by plugin_check --digest>",
  "entry": { "module": "entry.js", "styles": ["entry.css"] },
  "csp": { "img-src": ["https://<tile host>"] },
  "cspNotes": { "img-src": "<why the frame loads images from that host>" },
  "secrets": [{ "name": "<secret_name>", "purpose": "<what the key is for>" }],
  "server": { "network": ["https://<api host>"], "proxies": [] },
  "adminSettings": { "schema": {}, "defaults": {} },
  "contributes": { "widgets": [] }
}
```

The manifest is closed, so an unknown key blocks the version. Every string and every list has a bound.

| Key | Required | Meaning |
|---|---|---|
| `manifestVersion` | Yes | The version of the manifest format, which is `1`. |
| `id`, `version` | Yes | The plugin id and the version. They must equal the names of the directories that hold the package. |
| `name` | Yes | The name that admins and users see, between 1 and 80 characters. |
| `description` | No | A short description of at most 300 characters. |
| `publisher` | Yes | A `name` of 1 to 100 characters and an optional `https://` `url`. Admins see these values as the package states them, and Workspace does not verify them. |
| `icon` | No | A file under `assets/`. |
| `host` | Yes | The host API version, `1`, and the AFM version, `"0.11"`, that the package is built against. A host that implements other versions blocks the package. |
| `checksum` | Yes | The text `sha256-` followed by the base64url SHA-256 of the sorted lines `<path>\0<sha256 hex of the file>\n` for every file except `plugin.json`. The command `plugin_check --digest` prints it. |
| `entry` | Yes | The `module`, which is one `.js` file, and up to 8 `styles`, which are `.css` files. None of them may be under `backend/`. |
| `csp`, `cspNotes` | No | The sources that the frame itself may reach, which [Plugin frame policy](frame-policy.md) describes, and one sentence for each directive that explains why. |
| `secrets` | No | Up to 16 secrets that the proxies send. Each has a `name` of lowercase letters, digits and underscores and a `purpose` of at most 300 characters. A manifest never contains a value. |
| `server` | No | The `network`, which lists the https origins that the server may call for the plugin and, for a backend, the `tcp://host:port` endpoints that it opens. Also the `proxies` that the server makes, described on [Plugin proxies and secrets](proxies.md), and the `backend`, which is the plugin's own server-side code, described on [Plugin backends](backends.md). |
| `dataSources`, `identity` | No | Settings for a backend. `dataSources` lists the data that the backend reads for the user, each with an `id` and a `purpose`. `identity` can be `"pseudonymous"`, so that the backend learns an anonymous id of the user, and it is `"none"` by default. |
| `adminSettings` | No | A settings form that an organization's admin fills in, as the section on schemas below describes. It must not hold secrets. |
| `contributes.widgets` | Yes | Between 1 and 20 widgets. |

The host blocks a manifest that asks for the permission `core:data:query` or that contains `signatures`, because this host implements neither.

## Widgets

The `contributes.widgets` list holds one entry for each widget type that the plugin offers.

```jsonc
{
  "id": "<widget-id>",
  "name": "<name in Add widget>",
  "description": "<what it shows>",
  "category": "<category in Add widget>",
  "handles": [
    {
      "type": "<viz type>",
      "definition": { "type": "object", "additionalProperties": false, "properties": {} },
      "response": { "accepts": "json", "description": "<what the backend returns>" }
    }
  ],
  "standalone": false,
  "permissions": ["core:data:read"],
  "server": { "proxies": [] },
  "model": { "traits": {} },
  "params": [],
  "settings": { "schema": {}, "defaults": {} },
  "grid": { "w": 20, "h": 12 }
}
```

| Key | Meaning |
|---|---|
| `id` | The widget's id, between 1 and 48 characters of lowercase letters, digits, `_` and `-`, starting with a letter. It is unique within the plugin. |
| `name`, `description`, `category`, `subCategory` | The texts that Add widget shows. |
| `handles` | The viz types that this widget renders for backend widgets, up to 8 of them. A type is the `"type"` value in a backend's `widgets.json`. It has 2 to 32 lowercase characters and cannot be a built-in type, which means that it cannot be `markdown`, `html`, `iframe`, `newsfeed` or `pdf`. The `definition` is the JSON Schema of the `data.<type>` object that a backend writes for the type, and `response` describes the JSON that the backend's endpoint returns. |
| `standalone` | When it is `true`, the widget appears in Add widget on its own and needs no backend. Every widget must handle at least one type or be standalone. |
| `permissions` | The host permissions that the widget asks for, which [Plugin permissions and commands](commands-and-permissions.md) lists. |
| `server.proxies` | The ids of the proxies that the widget may call. It then needs the permission `core:proxy:call`, and it needs that permission only for this purpose. |
| `server.routes` | The ids of the backend routes that the widget may call. It then needs the permission `core:backend:call`, and it needs that permission only for this purpose. |
| `model.traits` | The module's own trait names, which are bound to host state as [Plugin module contract](module-contract.md) describes. |
| `params` | The parameters of a standalone widget, written as in `widgets.json` with `paramName`, `type`, `value`, `label` and so on. Every parameter has a unique `paramName`. |
| `settings` | A form that the user edits for each widget instance. |
| `grid` | The default size on the 40-column dashboard grid: `w` from 1 to 40, `h` from 1 to 100, and the optional `minW` and `minH`. |

One plugin cannot handle the same type twice. When two plugins handle a type, the organization's admin chooses which of them renders it.

A type that a plugin handles works with any backend whose `widgets.json` declares a widget of that type and whose endpoint returns what `response` describes. Workspace adds `theme=dark` or `theme=light` to the endpoint's query, which carries the site's mode, and it asks again when the user switches the mode, exactly as it does for `markdown` and `html` widgets. The backend's author decides what each mode looks like. The names `theme` and `raw` are reserved, so a backend's widgets cannot use them as query parameters of their own. [Widget requests](../protocols/widget-requests.md) and [Widget rows](../protocols/raw-rows.md) explain both names.

## Schemas

The `definition` of a handled type describes the `data.<type>` object that a backend writes for that type. It is a closed and bounded JSON Schema of at most 64 KiB and 8 levels of nesting. Every object has `additionalProperties: false`, or a value schema when the object is a map. Every array has `maxItems` and `items`, and every string has `maxLength`, `enum`, `const` or `pattern`. The allowed keywords are `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, `uniqueItems`, `oneOf` and `anyOf` over closed objects, local `$defs` and `$ref`, and the annotations `title`, `description`, `default` and `examples`. A pattern has at most 256 characters and no backreferences. Workspace checks backends' widgets against the definition, and the AI agent reads it when it builds widgets of the type.

The `settings` and `adminSettings` entries describe forms that the host renders. A form is a flat object of at most 64 properties, and each property name consists of letters, digits and underscores. Each property is a `string` with a `maxLength`, a `number`, an `integer`, a `boolean` or an `enum`. It can have a `title`, a `description`, a `default`, a `minimum` and a `maximum`, and the form can mark properties as `required`. The `defaults` must satisfy the schema, and the settings of one instance may not exceed 32 KiB.

## Checking a package

Before a package is placed on a server, its author can check it with the server's own validator. The commands run offline from the `backend-api/backend` directory:

```bash
python -m scripts.plugin_check <plugins dir>/<plugin-id>/<version>
python -m scripts.plugin_check --digest <plugins dir>/<plugin-id>/<version>
```

The first command runs discovery exactly as the server does. It checks the files, the links, the caps, the manifest, the policy, the proxies and the checksum. When the version would be blocked, it prints the reasons and exits with status 1. Warnings, such as a remote import or `eval` without `'unsafe-eval'`, do not block a version. The second command prints the `checksum` that belongs in `plugin.json` and the version digest that a deployer can pin.
