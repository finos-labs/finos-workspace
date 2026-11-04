---
title: Widget rows
sidebar_position: 3
---

import { RawRowCases } from "@site/src/components/Reference/cases";

# Widget rows

Some widgets draw a view from data, for example an HTML page or a plugin's chart. Such a widget can also answer with the data itself, as rows, so that the AI Agent, MCP clients and the user can read what the view shows. The key `raw` enables this, and it is available on `html` widgets and on every plugin type.

The keys `raw`, `data.rawDataKey` and `data.rawType` are listed under Widget definition on [widgets.json](../schemas/widgets-json.mdx). [Make a widget readable by the Agent](../../tutorials/build-a-backend/make-a-widget-readable-by-the-agent.md) explains what the host does with the rows.

## Where the rows come from

The host reads the rows from the response of the widget's request with `raw=true`, which [Widget requests](widget-requests.mdx) describes. The function `rowsOf` in `frontend/src/lib/utils/rawRows.ts` reads them, and this table shows what it returns for each case.

<RawRowCases />
