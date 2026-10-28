---
title: The reference backend
sidebar_position: 0
---

# The reference backend

The [reference backend](https://github.com/openbq-org/backends-for-openbb/tree/main/getting-started/reference-backend) in the `backends-for-openbb` repository is a complete FastAPI backend with an example of every widget type and parameter. Each file covers one area:

- `widgets_types.py`: Markdown, HTML, metric, table, news feed, PDF and other basic types.
- `widgets_input_params.py`, `widgets_input_form.py` and `widgets_grouping.py`: parameters, input forms and linked widgets.
- `widgets_aggrid_table.py`, `widgets_live_grid.py` and `widgets_sparkline.py`: tables.
- `widgets_plotly_chart.py`, `widgets_highchart.py`, `widgets_tradingview.py` and `widgets_vegalite.py`: charts.
- `widgets_omni_sql_python.py`, `widgets_youtube.py` and `widgets_settings.py`: other widgets and widget settings.

:::note[Placeholder]

This page will show how to run the reference backend against your own FINOS Workspace, with Python and TypeScript versions of each example side by side. The reference backend allows only `https://pro.openbb.co` to call it; to use it locally, add your FINOS Workspace address, such as `http://localhost:3000`, to `origins` in `core.py`.

:::
