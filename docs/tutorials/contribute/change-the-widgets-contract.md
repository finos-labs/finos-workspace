---
title: Change the widgets.json contract
sidebar_position: 7
---

# Change the widgets.json contract

Change what a `widgets.json` file may contain, and regenerate every file that follows from the contract.

## What you need

- A clone of the repository.
- Node.js, to run the script in `frontend/` and the Vitest tests.
- Python, to run the backend's pytest tests.

## 1. Edit the contract

Edit `frontend/src/lib/types/widgetsContract.ts`. It holds the strict Zod objects, the header tables, each type's methods and parameter locations, and the reserved query names. The file `widgetsSchemaKit.ts` turns the contract into the kit, which contains the base keys, the rules of each built-in type and the rules for plugin types.

A rule that JSON Schema cannot express goes into the function `contractProblems`, which runs after the schema check passed.

## 2. Regenerate the kit

From `frontend/`, run:

```bash
node scripts/generate-widgets-schema.ts
```

The script writes the kit to `backend-api/backend/api/widget_plugins/widgets_schema_kit.json`. A Vitest test fails when the committed kit is out of date, so the test passes once you have run the script.

## 3. Check the composed schema

The module `backend-api/backend/api/widget_plugins/widgets_schema.py` composes the schema from the kit and from the `definition` of each plugin type. To print a composition without a running stack, run this from `backend-api/backend`:

```bash
python -m scripts.compose_widgets_schema
```

A pytest test fails when the web app's fixture `frontend/tests/mocks/widgets-schema.json` is not the composer's output. Replace the fixture with the output, and the test passes.

## 4. Regenerate the app-builder pages

The script `backend-api/backend/scripts/generate_app_builder_specs.py` generates the pages that the app-builder resources of the MCP servers serve. These pages hold the type catalog, the response of each type, the widget fields, and the parameter fields and header-name rules. The script writes them from the kit between `<!-- generated:<name> -->` markers, and a pytest test fails when a page is out of date.

The pages list only the built-in types, because the plugin types differ between organizations. They point to `workspace://specs/widgets-json-schema` instead, which the user's FINOS Workspace tab answers over the bridge with the organization's composed schema.

## 5. Keep the schema closed

A test walks the kit and fails when it finds anything open. Every object needs `additionalProperties: false` or a defined value schema, every string needs a `maxLength`, an `enum`, a `const` or a `pattern`, and every array needs `maxItems`. The same walk runs on a plugin's `definition` when the plugin is discovered.

## 6. Regenerate the reference

The page [widgets.json](../../reference/schemas/widgets-json.mdx) is generated from the schema. Write the reference data again, as [Regenerate the reference data](regenerate-reference-data.md) describes.
