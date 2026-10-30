"""The examples of OpenBB Workspace's AgGrid table page, as `ag-grid` widgets.

An OpenBB widget of type `table` with `data.table` is here a widget of type `ag-grid` with
`data["ag-grid"]`; the rows its endpoint returns are the same.
"""

import math

CATEGORY = "AgGrid table chart examples"

ASSETS = [
    {"name": "Ethereum", "tvl": 45000000000, "change_1d": 2.5, "change_7d": 5.2},
    {"name": "Bitcoin", "tvl": 35000000000, "change_1d": 1.2, "change_7d": 4.8},
    {"name": "Solana", "tvl": 8000000000, "change_1d": -0.5, "change_7d": 2.1},
]

PROJECTS = {
    "Ethereum": ("A decentralized, open-source blockchain with smart contract functionality", "2015-07-30"),
    "Bitcoin": ("The first decentralized cryptocurrency", "2009-01-03"),
    "Solana": ("A high-performance blockchain supporting builders around the world", "2020-03-16"),
}

COMPANIES = [
    {"symbol": "AAPL", "company": "Apple", "sector": "Technology", "revenue": 391035, "growth_rate": 2.0, "market_cap": 3400, "url": "https://www.apple.com/investor-relations/"},
    {"symbol": "MSFT", "company": "Microsoft", "sector": "Technology", "revenue": 245122, "growth_rate": 15.7, "market_cap": 3100, "url": "https://www.microsoft.com/investor"},
    {"symbol": "JPM", "company": "JPMorgan Chase", "sector": "Financials", "revenue": 177556, "growth_rate": 12.0, "market_cap": 690, "url": "https://www.jpmorganchase.com/ir"},
    {"symbol": "XOM", "company": "Exxon Mobil", "sector": "Energy", "revenue": 339247, "growth_rate": -1.5, "market_cap": 470, "url": "https://investor.exxonmobil.com/"},
]

ASSET_COLUMN = {"field": "name", "headerName": "Asset", "cellDataType": "text", "formatterFn": "none", "renderFn": "titleCase", "width": 120, "pinned": "left"}
TVL_COLUMN = {"field": "tvl", "headerName": "TVL (USD)", "headerTooltip": "Total Value Locked", "cellDataType": "number", "formatterFn": "int", "width": 150}


def change_column(field: str, header: str, **extra) -> dict:
    return {
        "field": field,
        "headerName": header,
        "cellDataType": "number",
        "formatterFn": "percent",
        "width": 120,
        "maxWidth": 150,
        "minWidth": 70,
        **extra,
    }


def widget(name: str, description: str, endpoint: str, table: dict | None = None, w: int = 20, h: int = 6, **extra) -> dict:
    return {
        "name": name,
        "description": description,
        "category": CATEGORY,
        "type": "ag-grid",
        "endpoint": f"/ag-table-chart/{endpoint}",
        "gridData": {"w": w, "h": h},
        **({"data": {"ag-grid": table}} if table is not None else {}),
        **extra,
    }


WIDGETS = {
    "ag_table_chart_basic": widget("Table widget", "Rows only: columns, types and formats inferred", "assets", w=12, h=4),
    "ag_table_chart_column_definitions": widget(
        "Table with column definitions",
        "columnsDefs: header names and tooltips, data types, formats, widths, pinning and a hidden column",
        "assets",
        {
            "columnsDefs": [
                ASSET_COLUMN,
                TVL_COLUMN,
                change_column("change_1d", "24h Change"),
                change_column("change_7d", "7d Change", hide=True),
            ]
        },
    ),
    "ag_table_chart_render_functions": widget(
        "Table with render functions",
        "columnColor rules, greenRed and titleCase",
        "assets",
        {
            "columnsDefs": [
                ASSET_COLUMN,
                {
                    **TVL_COLUMN,
                    "renderFn": "columnColor",
                    "renderFnParams": {
                        "colorRules": [
                            {"condition": "between", "range": {"min": 30000000000, "max": 40000000000}, "color": "blue", "fill": False},
                            {"condition": "lt", "value": 10000000000, "color": "#FFA500", "fill": False},
                            {"condition": "gt", "value": 40000000000, "color": "green", "fill": True},
                        ]
                    },
                },
                change_column("change_1d", "24h Change", renderFn="greenRed"),
                change_column("change_7d", "7d Change", renderFn="greenRed"),
            ]
        },
    ),
    "ag_table_chart_hover_card": widget(
        "Table with hover card",
        "Hover the asset: a card with Markdown filled from the cell's object",
        "projects",
        {
            "columnsDefs": [
                {
                    "field": "name",
                    "headerName": "Asset",
                    "cellDataType": "text",
                    "formatterFn": "none",
                    "width": 120,
                    "pinned": "left",
                    "renderFn": "hoverCard",
                    "renderFnParams": {
                        "hoverCard": {
                            "cellField": "value",
                            "title": "Project Details",
                            "markdown": "### {value} (since {foundedDate})\n**Description:** {description}",
                        }
                    },
                },
                {**TVL_COLUMN, "renderFn": "columnColor"},
                change_column("change_1d", "24h Change", renderFn="greenRed"),
                change_column("change_7d", "7d Change", renderFn="greenRed"),
            ]
        },
    ),
    "ag_table_chart_table_to_chart": widget(
        "Table to chart",
        "chartView: opens as a column chart of TVL by asset; the toolbar switches to the table",
        "assets",
        {
            "enableCharts": True,
            "showAll": False,
            "chartView": {"enabled": True, "chartType": "column"},
            "columnsDefs": [
                {"field": "name", "headerName": "Asset", "chartDataType": "category"},
                {"field": "tvl", "headerName": "TVL (USD)", "chartDataType": "series"},
            ],
        },
        h=12,
    ),
    "ag_table_chart_time_series": widget(
        "Table to time series",
        "A line chart over dates, with the navigator and its mini chart",
        "time-series",
        {
            "enableCharts": True,
            "showAll": False,
            "chartView": {"enabled": True, "chartType": "line", "chartNavigatorEnabled": True, "chartMiniChartEnabled": True},
            "columnsDefs": [
                {"field": "date", "headerName": "Date", "chartDataType": "time"},
                {"field": "Ethereum", "headerName": "Ethereum", "chartDataType": "series"},
                {"field": "Bitcoin", "headerName": "Bitcoin", "chartDataType": "series"},
                {"field": "Solana", "headerName": "Solana", "chartDataType": "series"},
            ],
        },
        h=12,
    ),
    "ag_table_chart_chart_ranges": widget(
        "Chart with default ranges",
        "cellRangeCols: the columns each chart type starts with, here a stacked area of two regions",
        "regions",
        {
            "enableCharts": True,
            "chartView": {
                "enabled": True,
                "chartType": "stackedArea",
                "cellRangeCols": {"stackedArea": ["month", "emea", "apac"], "heatmap": ["month", "emea", "apac", "americas"]},
            },
            "columnsDefs": [{"field": "month", "chartDataType": "category"}],
        },
        h=12,
    ),
    "ag_table_chart_sparklines": widget(
        "Table with sparklines",
        "Line and bar sparklines with their minimum and maximum points",
        "sparklines",
        {
            "columnsDefs": [
                {"field": "stock", "headerName": "Stock", "cellDataType": "text", "width": 120, "pinned": "left"},
                {
                    "field": "price_history",
                    "headerName": "Price History",
                    "width": 200,
                    "sparkline": {
                        "type": "line",
                        "options": {
                            "stroke": "#2563eb",
                            "strokeWidth": 2,
                            "markers": {"enabled": True, "size": 3},
                            "pointsOfInterest": {
                                "maximum": {"fill": "#22c55e", "stroke": "#16a34a", "size": 6},
                                "minimum": {"fill": "#ef4444", "stroke": "#dc2626", "size": 6},
                            },
                        },
                    },
                },
                {
                    "field": "volume",
                    "headerName": "Volume",
                    "width": 150,
                    "sparkline": {
                        "type": "bar",
                        "options": {
                            "fill": "#6b7280",
                            "stroke": "#4b5563",
                            "pointsOfInterest": {
                                "maximum": {"fill": "#22c55e", "stroke": "#16a34a"},
                                "minimum": {"fill": "#ef4444", "stroke": "#dc2626"},
                            },
                        },
                    },
                },
            ]
        },
    ),
    "ag_table_chart_sparkline_formatter": widget(
        "Sparklines with custom formatters",
        "customFormatter colours each bar by its value",
        "profit-loss",
        {
            "columnsDefs": [
                {"field": "company", "headerName": "Company", "cellDataType": "text", "width": 150, "pinned": "left"},
                {
                    "field": "profit_loss",
                    "headerName": "P&L Trend",
                    "width": 200,
                    "sparkline": {
                        "type": "bar",
                        "options": {
                            "customFormatter": "(params) => ({ fill: params.yValue >= 0 ? '#22c55e' : '#ef4444', stroke: params.yValue >= 0 ? '#16a34a' : '#dc2626' })"
                        },
                    },
                },
                {
                    "field": "revenue_growth",
                    "headerName": "Revenue Growth",
                    "width": 200,
                    "sparkline": {
                        "type": "bar",
                        "options": {
                            "customFormatter": "(params) => ({ fill: params.yValue > 10 ? '#22c55e' : params.yValue < 0 ? '#ef4444' : '#f59e0b', fillOpacity: 0.3, stroke: params.yValue > 10 ? '#16a34a' : params.yValue < 0 ? '#dc2626' : '#d97706' })"
                        },
                    },
                },
            ]
        },
    ),
    "ag_table_chart_cell_click": widget(
        "Companies (cell clicks)",
        "Click a symbol to set the symbol of the Company detail widget, a company to prepare a prompt for the AI agent, a link to open it",
        "companies",
        {
            "columnsDefs": [
                {
                    "field": "symbol",
                    "headerName": "Symbol",
                    "pinned": "left",
                    "renderFn": ["cellOnClick", "columnColor"],
                    "renderFnParams": {
                        "actionType": "groupBy",
                        "groupBy": {"paramName": "symbol"},
                        "colorValueKey": "growth_rate",
                        "colorRules": [
                            {"condition": "gte", "value": 10, "color": "green", "fill": True},
                            {"condition": "lt", "value": 0, "color": "red", "fill": True},
                        ],
                    },
                },
                {
                    "field": "company",
                    "headerName": "Company",
                    "renderFn": "cellOnClick",
                    "renderFnParams": {
                        "actionType": "sendToAgent",
                        "sendToAgent": {
                            "markdown": "Please analyze the company **{company}** with the following details:\n\n- **Revenue:** ${revenue}M\n- **Growth Rate:** {growth_rate}%\n- **Market Cap:** ${market_cap}B\n- **Sector:** {sector}\n\nProvide insights on the company's financial performance, growth prospects, and market position."
                        },
                    },
                },
                {"field": "sector", "headerName": "Sector", "renderFn": "columnColor", "renderFnParams": {"colorRules": [{"condition": "contains", "value": "Tech", "color": "blue", "fill": False}]}},
                {"field": "revenue", "headerName": "Revenue", "formatterFn": "int", "prefix": "$", "suffix": "M"},
                {"field": "growth_rate", "headerName": "Growth", "formatterFn": "percent", "renderFn": "greenRed", "decimalPlaces": 1},
                {"field": "market_cap", "headerName": "Market Cap", "formatterFn": "int", "prefix": "$", "suffix": "B"},
                {"field": "url", "headerName": "Investor relations", "renderFn": "cellOnClick", "renderFnParams": {"actionType": "openUrl"}},
            ]
        },
        params=[{"paramName": "symbol", "type": "text", "label": "Symbol", "value": "AAPL"}],
    ),
    "ag_table_chart_company_detail": widget(
        "Company detail",
        "The company the Companies widget's symbol names, transposed: one row per field",
        "company",
        {
            "transpose": True,
            "columnsDefs": [
                {"field": "symbol", "headerName": "Field"},
                {"field": "company", "headerName": "Company"},
                {"field": "sector", "headerName": "Sector"},
                {"field": "revenue", "headerName": "Revenue", "formatterFn": "int", "prefix": "$", "suffix": "M"},
                {"field": "growth_rate", "headerName": "Growth", "formatterFn": "percent", "renderFn": "greenRed"},
                {"field": "market_cap", "headerName": "Market Cap", "formatterFn": "int", "prefix": "$", "suffix": "B"},
            ],
            "showAll": False,
        },
        w=12,
        params=[{"paramName": "symbol", "type": "text", "label": "Symbol", "value": "AAPL"}],
    ),
    "ag_table_chart_live": widget(
        "Live prices",
        "showCellChange: prices move every five seconds and flash green or red; the symbol takes the colour of its price's move",
        "live",
        {
            "wsRowIdColumn": "symbol",
            "columnsDefs": [
                {"field": "symbol", "headerName": "Symbol", "pinned": "left", "renderFn": "showCellChange", "renderFnParams": {"colorValueKey": "price"}},
                {"field": "price", "headerName": "Price", "renderFn": "showCellChange", "decimalPlaces": 2, "prefix": "$"},
                {"field": "change", "headerName": "Change", "formatterFn": "normalizedPercent", "renderFn": ["greenRed", "showCellChange"]},
                {"field": "volume", "headerName": "Volume", "formatterFn": "int", "enableCellChangeWs": False, "renderFn": "showCellChange"},
            ],
        },
        refetchInterval=5000,
    ),
}


def assets() -> list[dict]:
    return ASSETS


def projects() -> list[dict]:
    return [
        {**row, "name": {"value": row["name"], "description": PROJECTS[row["name"]][0], "foundedDate": PROJECTS[row["name"]][1]}}
        for row in ASSETS
    ]


def time_series() -> list[dict]:
    rows = []
    for i in range(60):
        rows.append(
            {
                "date": f"2024-{6 + i // 30:02d}-{i % 30 + 1:02d}",
                "Ethereum": round(1 + 0.08 * math.sin(i / 5) + i * 0.002, 4),
                "Bitcoin": round(1 + 0.05 * math.cos(i / 7) + i * 0.003, 4),
                "Solana": round(1 + 0.12 * math.sin(i / 3) - i * 0.001, 4),
            }
        )
    return rows


def regions() -> list[dict]:
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return [
        {
            "month": month,
            "emea": round(100 + 30 * math.sin(i / 2)),
            "apac": round(80 + 25 * math.cos(i / 3)),
            "americas": 120 + 10 * i,
        }
        for i, month in enumerate(months)
    ]


def sparklines() -> list[dict]:
    return [
        {"stock": "AAPL", "price_history": [150, 155, 148, 162, 158, 165, 170], "volume": [1000, 1200, 900, 1500, 1100, 1300, 1800]},
        {"stock": "GOOGL", "price_history": [2800, 2750, 2900, 2850, 2950, 3000, 2980], "volume": [800, 950, 700, 1200, 850, 1100, 1400]},
        {"stock": "MSFT", "price_history": [340, 335, 350, 345, 360, 355, 365], "volume": [900, 1100, 800, 1300, 950, 1200, 1600]},
    ]


def profit_loss() -> list[dict]:
    return [
        {"company": "TechCorp", "profit_loss": [5, -2, 8, -3, 12, 7, -1], "revenue_growth": [15, 8, -5, 20, -8, 25, 18]},
        {"company": "DataSoft", "profit_loss": [10, -5, 15, -8, 20, 12, -3], "revenue_growth": [12, 5, 8, -2, 15, 10, 22]},
        {"company": "CloudInc", "profit_loss": [8, -15, 25, 12, -5, 18, 28], "revenue_growth": [8, -3, 12, 18, 6, 14, 9]},
    ]


def companies() -> list[dict]:
    return COMPANIES


def company(symbol: str) -> list[dict]:
    match = [row for row in COMPANIES if row["symbol"] == symbol.upper()]
    return [{key: value for key, value in row.items() if key != "url"} for row in match or COMPANIES[:1]]


def live(tick: int) -> list[dict]:
    base = {"AAPL": 227.5, "MSFT": 415.2, "NVDA": 131.8, "AMZN": 186.4, "TSLA": 251.1}
    rows = []
    for i, (symbol, price) in enumerate(base.items()):
        move = math.sin(tick * (0.9 + i * 0.37) + i) * 0.02
        previous = math.sin((tick - 1) * (0.9 + i * 0.37) + i) * 0.02
        rows.append(
            {
                "symbol": symbol,
                "price": round(price * (1 + move), 2),
                "change": round(move - previous, 4),
                "volume": 1000000 + ((tick * 7919 + i * 104729) % 500000),
            }
        )
    return rows
