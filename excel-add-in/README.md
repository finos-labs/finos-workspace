# Workspace Add-in for Excel

An Office.js add-in that brings the data of your Workspace backends into Excel. It adds two custom
functions and a task pane:

| Function | What it does |
| :-- | :-- |
| `WORKSPACE.WIDGET(backend, widget, [parameters])` | The data of a widget that lives in one of your backends. `parameters` is a range of two columns (name, value) or an array constant such as `{"symbol","AAPL";"year",2024}`. |
| `WORKSPACE.GET(array, [rows], [columns])` | Slices a range by row and column labels or indices. |

Users sign in to the task pane with their Workspace account. The backends that the account has
connected in Workspace show up in the **Account** page, together with a button that copies a
ready-made `WIDGET` formula for each widget. The add-in works for accounts on the full tier.

## Installation

```bash
npm ci
```

## Configuration

Copy `.env.example` to `.env` (or `.env.local`; see [Vite env files](https://vitejs.dev/guide/env-and-mode.html#env-files)) and fill it in:

| Variable | Meaning |
| :-- | :-- |
| `VITE_BACKEND_URL` | The Workspace backend that the add-in signs in to. |
| `VITE_HELP_URL` | Where your documentation lives. The About and Reference pages embed it. Empty: they say that it is not configured. |
| `VITE_ADDIN_BASE_URL` | Where the add-in is served from. |
| `VITE_ENV` | `DEVELOPMENT`, `PRODUCTION` or any label you use for your deployment. |
| `ADDIN_UUID` | A GUID that identifies the add-in to Office. Generate your own. |
| `ADDIN_BASE_URL` | The same address as `VITE_ADDIN_BASE_URL`; the build writes it into `manifest.xml`. |
| `ADDIN_HELP_URL` | The documentation address that `manifest.xml` points Office to. |

The add-in sends no analytics.

## Development

```bash
npm run dev
```

To load the add-in in desktop Excel, use one of the `start` scripts:

```bash
npm run start
```

> On a Mac, run `npm run office:tools-mac` and restart Excel to enable the "inspect" button of the
> task pane. To see the console and the network of the custom functions, inspect the task pane from
> the sign-in page, before signing in: the functions' runtime lives there.

To load it in Excel on the web:

1. Run `npm run build`.
2. Go to Insert > Office Add-ins in Excel.
3. Open the Manage My Add-ins menu and choose Upload My Add-in.
4. Select `manifest.xml` from the `dist` folder.

## Build

```bash
npm run build
```

builds the static bundle and a `manifest.xml` with your `ADDIN_*` values in `dist/`, then validates
the manifest. A build whose `ADDIN_BASE_URL` points at `localhost` or a `.dev` host names its
functions `WORKSPACE.LOCAL.*` or `WORKSPACE.DEV.*`, so that they can live next to the production
add-in in one workbook.

See [DEPLOYMENT.md](DEPLOYMENT.md) for rolling the add-in out in an organization.

## Tests

```bash
npm run test
```

runs the unit tests (`tests/unit`).

## Origin of the template

The project started from the Vite and React template for Office add-ins at
[ExtraBB/Office-Addin-React-Vite-Template](https://github.com/ExtraBB/Office-Addin-React-Vite-Template),
which in turn is based on the [Office-Addin-Taskpane-React](https://github.com/OfficeDev/Office-Addin-TaskPane-React)
project. It uses Vite instead of Webpack, React 18, and TypeScript in strict mode, and it has no
polyfills for Internet Explorer 11 (add [@vitejs/plugin-legacy](https://github.com/vitejs/vite/tree/main/packages/plugin-legacy)
if you need them).
