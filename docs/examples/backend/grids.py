from datetime import datetime, timedelta

from data import DEALS

COLUMN_DEFS = [
    {"field": "region", "headerName": "Region"},
    {"field": "sales", "headerName": "Sales"},
    {"field": "date", "headerName": "Date"},
    {"field": "status", "headerName": "Status"},
    {"field": "rep", "headerName": "Rep"},
]

def explicit() -> dict:
    return {
        "columnDefs": COLUMN_DEFS,
        "rowData": DEALS,
        "gridOptions": {
            "rowSelection": "multiple",
        },
    }


def records() -> list[dict]:
    return DEALS


def columns() -> dict:
    return {name: [row[name] for row in DEALS] for name in DEALS[0]}


def split() -> dict:
    return {
        "columns": list(DEALS[0]),
        "index": list(range(len(DEALS))),
        "data": [list(row.values()) for row in DEALS],
    }


def dates() -> list[dict]:
    start = datetime(2026, 1, 10, 9, 30)
    events = ["Launch", "Update", "Release", "Patch", "Hotfix", "Review"]
    rows = []
    for i, event in enumerate(events):
        stamp = start + timedelta(days=i * 3, hours=i)
        rows.append(
            {
                "event": event,
                "timestamp": stamp.isoformat(),
                "date_only": stamp.date().isoformat(),
                "value": 100 + i * 50,
                "duration_hours": i * 72,
            }
        )
    return rows


def grouped() -> dict:
    defs = [{**d, "rowGroup": True, "hide": True} if d["field"] == "region" else d for d in COLUMN_DEFS]
    return {"columnDefs": defs, "rowData": DEALS, "gridOptions": {}}


def multicolumn() -> dict:
    revenue = [("us", "US"), ("eu", "EU"), ("apac", "APAC")]
    quarters = [
        {"q": "Q1", "us": 120, "eu": 150, "apac": 90, "us_c": 40, "eu_c": 55, "apac_c": 30},
        {"q": "Q2", "us": 140, "eu": 130, "apac": 110, "us_c": 45, "eu_c": 50, "apac_c": 35},
        {"q": "Q3", "us": 160, "eu": 170, "apac": 130, "us_c": 50, "eu_c": 60, "apac_c": 40},
        {"q": "Q4", "us": 180, "eu": 190, "apac": 150, "us_c": 55, "eu_c": 65, "apac_c": 45},
    ]
    return {
        "columnDefs": [
            {"field": "q", "headerName": "Quarter"},
            {
                "headerName": "Revenue",
                "children": [{"field": key, "headerName": label, "type": "numericColumn"} for key, label in revenue],
            },
            {
                "headerName": "Cost",
                "children": [{"field": f"{key}_c", "headerName": label, "type": "numericColumn"} for key, label in revenue],
            },
        ],
        "rowData": quarters,
        "gridOptions": {},
    }


def stream(tick: int) -> dict:
    regions = ["EMEA", "APAC", "AMER"]
    statuses = ["active", "pending", "closed"]
    reps = ["Grace", "Heidi", "Ivan"]
    window = range(tick, tick + 3)
    rows = [
        {
            "id": f"stream-{i}",
            "region": regions[i % 3],
            "sales": 100000 + i * 5000,
            "status": statuses[i % 3],
            "rep": reps[i % 3],
        }
        for i in window
    ]
    return {
        "columnDefs": [
            {"field": "id", "headerName": "ID"},
            {"field": "region", "headerName": "Region"},
            {"field": "sales", "headerName": "Sales"},
            {"field": "status", "headerName": "Status"},
            {"field": "rep", "headerName": "Rep"},
        ],
        "rowData": rows,
        "gridOptions": {},
    }
