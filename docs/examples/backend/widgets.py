PLOTLY = "Plotly examples"
GRID = "AgGrid examples"
SQL_PARAM = {
    "paramName": "sql",
    "type": "text",
    "label": "SQL",
    "description": "One SELECT over the files: sales, deals, readings, stations",
    "value": "SELECT region, sum(units) AS units FROM sales GROUP BY region ORDER BY region",
}


def plotly(name: str, description: str, endpoint: str, **extra) -> dict:
    return {
        "name": name,
        "description": description,
        "category": PLOTLY,
        "type": "plotly",
        "endpoint": endpoint,
        "gridData": {"w": 20, "h": 12},
        **extra,
    }


def grid(name: str, description: str, endpoint: str, kind: str = "aggrid-table", **extra) -> dict:
    return {
        "name": name,
        "description": description,
        "category": GRID,
        "type": kind,
        "endpoint": endpoint,
        "gridData": {"w": 24, "h": 14},
        **extra,
    }


WIDGETS = {
    "plotly_sales": plotly(
        "Sales by region",
        "Monthly sales of three regions, stacked; the rows button shows them in AgGrid",
        "/plotly/sales",
        raw=True,
        data={"rawType": "aggrid-table"},
    ),
    "plotly_trend": plotly("Sales trend", "The same sales, as lines", "/plotly/trend"),
    "plotly_signal": plotly("Signal and noise", "A sampled signal, from numpy arrays", "/plotly/signal"),
    "plotly_correlation": plotly("Correlation", "A heatmap of five series' correlations", "/plotly/correlation"),
    "plotly_sql": plotly(
        "SQL chart",
        "The first column of a query as categories, the others as bars",
        "/sql/chart",
        params=[SQL_PARAM],
    ),
    "grid_explicit": grid("Deals", "Explicit column definitions, rows and grid options", "/ag-grid/explicit"),
    "grid_records": grid("Deals, records", "A list of records: columns inferred", "/ag-grid/records"),
    "grid_columns": grid("Deals, columns", "A dict of columns, as pandas to_dict('list')", "/ag-grid/columns"),
    "grid_split": grid("Deals, split", "Pandas split format", "/ag-grid/split"),
    "grid_dates": grid("Event timeline", "ISO 8601 dates and timestamps", "/ag-grid/dates"),
    "grid_grouped": grid("Deals by region", "Rows grouped by region", "/ag-grid/grouped"),
    "grid_multicolumn": grid("Quarterly revenue and cost", "Column groups", "/ag-grid/multicolumn"),
    "grid_stream": grid(
        "Streaming rows",
        "New rows every five seconds, applied as transactions",
        "/ag-grid/stream",
        refetchInterval=5000,
    ),
    "grid_live": grid(
        "Live prices",
        "A WebSocket sends a snapshot, then upserts and removals by row id",
        "/ag-grid/live",
        "aggrid-livegrid",
        data={"streamEndpoint": "/ws/ticks"},
    ),
    "grid_ssrm": grid(
        "Trades, server-side",
        "200,000 trades paged, sorted, filtered, grouped and pivoted in Postgres",
        "/ssrm/trades",
        "aggrid-ssrm",
        data={"aggrid-ssrm": {"table": "demo.trades", "pageSize": 100}},
        gridData={"w": 30, "h": 18},
    ),
}
