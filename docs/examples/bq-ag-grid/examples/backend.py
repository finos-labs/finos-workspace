import json
import random
import sys
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 7779
ORIGIN = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:1420"  # noqa: PLR2004

SECTORS = {
    "Energy": ["Oil & Gas", "Renewables", "Utilities"],
    "Finance": ["Banking", "Insurance", "Asset Management"],
    "Healthcare": ["Biotech", "Hospitals", "Medical Devices"],
    "Industrials": ["Aerospace", "Logistics", "Machinery"],
    "Technology": ["Semiconductors", "Software", "Hardware"],
}
STATES = ["CA", "IL", "MA", "NY", "TX", "WA"]
NAME_PARTS = ["Apex", "Blue", "Cedar", "Delta", "Echo", "Summit", "Nova", "Orbit", "Pine", "Vertex"]
NAME_SUFFIXES = ["Corp", "Holdings", "Group", "Labs", "Partners", "Systems"]
# (employees, revenue in $M) per size
SIZES = {
    "Small": ((10, 250), (1, 60)),
    "Mid": ((250, 2_500), (60, 900)),
    "Large": ((2_500, 60_000), (900, 25_000)),
}
TICKERS = {"ACME": 120.0, "BOLT": 45.0, "CBLT": 310.0, "DLTA": 18.0, "ECHO": 76.0}
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# The prices' columns and options, declared once here rather than in every response
PRICES_GRID = {
    "columnDefs": [
        {"field": "date", "cellDataType": "dateString", "valueFormat": {"style": "date"}, "sort": "desc"},
        {"field": "ticker", "enableRowGroup": True, "pinned": "left", "width": 110},
        {"field": "close", "aggFunc": "avg", "valueFormat": {"style": "currency", "decimals": 2}},
        {"field": "change", "headerName": "Change", "aggFunc": "avg", "valueFormat": {"style": "percent", "decimals": 2}},
        {"field": "volume", "aggFunc": "sum", "valueFormat": {"style": "decimal", "notation": "compact"}},
    ],
    "gridOptions": {"pagination": True, "paginationPageSize": 50, "defaultColDef": {"floatingFilter": True}},
}

# A pivot table of the companies' rows: the same endpoint as Companies (rows), another definition
PIVOT_GRID = {
    "columnDefs": [
        {"field": "company", "minWidth": 220},
        {"field": "sector", "enableRowGroup": True, "enablePivot": True, "rowGroup": True},
        {"field": "industry", "enableRowGroup": True, "enablePivot": True},
        {"field": "state", "enableRowGroup": True, "enablePivot": True},
        {"field": "size", "enableRowGroup": True, "enablePivot": True, "pivot": True},
        {"field": "revenueUsdM", "headerName": "Revenue", "aggFunc": "sum", "valueFormat": {"style": "currency", "decimals": 1}},
        {"field": "employees", "aggFunc": "sum", "valueFormat": {"style": "decimal", "notation": "compact"}},
    ],
    "gridOptions": {"pivotMode": True},
}

WIDGETS = {
    "grid_companies_rows": {
        "name": "Companies (rows)",
        "description": "500 company rows as a plain list: the grid infers every column",
        "category": "BQ AG Grid examples",
        "type": "bq-ag-grid",
        "endpoint": "/companies/rows",
        "gridData": {"w": 24, "h": 14},
    },
    "grid_companies": {
        "name": "Companies (grid)",
        "description": "The same companies as a grid: headers, formats, and grouped by sector and state",
        "category": "BQ AG Grid examples",
        "type": "bq-ag-grid",
        "endpoint": "/companies",
        "gridData": {"w": 24, "h": 14},
    },
    "grid_companies_pivot": {
        "name": "Companies (pivot table)",
        "description": "Revenue and employees by sector and size: the rows of Companies (rows) as a pivot table",
        "category": "BQ AG Grid examples",
        "type": "bq-ag-grid",
        "endpoint": "/companies/rows",
        "gridData": {"w": 28, "h": 14},
        "data": {"bq-ag-grid": PIVOT_GRID},
    },
    "grid_prices": {
        "name": "Daily prices",
        "description": "A year of prices for five tickers, with columns declared in widgets.json",
        "category": "BQ AG Grid examples",
        "type": "bq-ag-grid",
        "endpoint": "/prices",
        "gridData": {"w": 24, "h": 14},
        "data": {"bq-ag-grid": PRICES_GRID},
    },
    "grid_trades": {
        "name": "Trades (20,000 rows)",
        "description": "Twenty thousand rows, inferred, paged",
        "category": "BQ AG Grid examples",
        "type": "bq-ag-grid",
        "endpoint": "/trades",
        "gridData": {"w": 24, "h": 14},
        "data": {"bq-ag-grid": {"gridOptions": {"pagination": True, "paginationPageSize": 100}}},
    },
    "plotly_sales": {
        "name": "Sales by month",
        "description": "A Plotly chart whose rows button shows its rows in AG Grid",
        "category": "BQ AG Grid examples",
        "type": "plotly",
        "endpoint": "/sales",
        "gridData": {"w": 20, "h": 12},
        "raw": True,
        "data": {"rawType": "bq-ag-grid"},
    },
}


def companies(count: int = 500, seed: int = 42) -> list[dict]:
    """The same rows on every start: the seed fixes them."""
    rng = random.Random(seed)
    rows = []
    for index in range(1, count + 1):
        sector = rng.choice(list(SECTORS))
        size = rng.choice(list(SIZES))
        employees, revenue = SIZES[size]
        name = f"{rng.choice(NAME_PARTS)} {rng.choice(NAME_PARTS)} {rng.choice(NAME_SUFFIXES)}"
        rows.append(
            {
                "id": str(index),
                "company": f"{name} {index}",
                "sector": sector,
                "industry": rng.choice(SECTORS[sector]),
                "state": rng.choice(STATES),
                "size": size,
                "revenueUsdM": round(rng.uniform(*revenue), 1),
                "employees": rng.randint(*employees),
                "foundedYear": rng.randint(1950, 2023),
            }
        )
    return rows


def companies_grid(rows: list[dict]) -> dict:
    grouped = {"enableRowGroup": True}
    return {
        "rowData": rows,
        "columnDefs": [
            {"field": "company", "headerName": "Company", "minWidth": 220},
            {
                "headerName": "Classification",
                "children": [
                    {"field": "sector", "rowGroup": True, "rowGroupIndex": 0, **grouped},
                    {"field": "industry", **grouped},
                    {"field": "state", "rowGroup": True, "rowGroupIndex": 1, **grouped},
                    {"field": "size", **grouped},
                ],
            },
            {
                "field": "revenueUsdM",
                "headerName": "Revenue",
                "aggFunc": "sum",
                "valueFormat": {"style": "currency", "decimals": 1},
                "headerTooltip": "Millions of US dollars",
            },
            {"field": "employees", "aggFunc": "sum", "valueFormat": {"style": "decimal"}},
            {"field": "foundedYear", "headerName": "Founded", "aggFunc": "min"},
        ],
        "gridOptions": {"autoGroupColumnDef": {"headerName": "Sector / State / Company", "field": "company"}},
    }


def prices(seed: int = 7) -> list[dict]:
    rng = random.Random(seed)
    start = date(2025, 1, 1)
    rows = []
    for ticker, price in TICKERS.items():
        for day in range(365):
            if (start + timedelta(days=day)).weekday() >= 5:  # noqa: PLR2004
                continue
            change = rng.gauss(0.0004, 0.018)
            price = round(price * (1 + change), 2)
            rows.append(
                {
                    "date": (start + timedelta(days=day)).isoformat(),
                    "ticker": ticker,
                    "close": price,
                    "change": round(change, 4),
                    "volume": rng.randint(200_000, 9_000_000),
                }
            )
    return rows


def trades(count: int = 20_000, seed: int = 11) -> list[dict]:
    rng = random.Random(seed)
    tickers = list(TICKERS)
    return [
        {
            "tradeId": index,
            "ticker": rng.choice(tickers),
            "side": rng.choice(["buy", "sell"]),
            "quantity": rng.randint(1, 5_000),
            "price": round(rng.uniform(10, 400), 2),
            "venue": rng.choice(["NYSE", "NASDAQ", "ARCA", "BATS"]),
            "settled": rng.random() > 0.1,  # noqa: PLR2004
        }
        for index in range(1, count + 1)
    ]


SALES = [{"month": month, "emea": 100 + 7 * i, "apac": 80 + 5 * (i % 4), "americas": 120 + 10 * i} for i, month in enumerate(MONTHS)]


def sales_figure() -> dict:
    """A Plotly figure written by hand: the plotly-charts plugin draws it."""
    return {
        "data": [{"type": "bar", "name": region, "x": MONTHS, "y": [row[region] for row in SALES]} for region in ("emea", "apac", "americas")],
        "layout": {"title": {"text": "Sales by month"}, "barmode": "stack"},
    }


COMPANIES = companies()
RESPONSES = {
    "/widgets.json": json.dumps(WIDGETS).encode(),
    "/companies/rows": json.dumps(COMPANIES).encode(),
    "/companies": json.dumps(companies_grid(COMPANIES)).encode(),
    "/prices": json.dumps(prices()).encode(),
    "/trades": json.dumps(trades()).encode(),
    "/sales": json.dumps(sales_figure()).encode(),
}
# The rows of the widgets with raw: true, asked for with raw=true
RAW = {"/sales": json.dumps(SALES).encode()}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes = b"") -> None:
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204 if urlsplit(self.path).path in RESPONSES else 404)

    def do_GET(self):
        # The grid sorts, filters and groups in its frame, so the rows ignore the query (theme=)
        url = urlsplit(self.path)
        raw = parse_qs(url.query).get("raw", [""])[0] == "true"
        body = RAW.get(url.path) if raw else RESPONSES.get(url.path)
        if body is None:
            self._send(404, json.dumps({"detail": "not found"}).encode())
        else:
            self._send(200, body)

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    print(f"serving AG Grid example widgets on http://localhost:{PORT} for {ORIGIN}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
