"""A second, unrelated backend for the same ag-grid widget type: an HR directory.

Nothing here knows the companies backend, and the plugin is not changed for it. It reuses
the grid three ways: rows under a key with columns declared in widgets.json and params
that filter on the server (add the widget twice, one department each); columns that the
response builds from the data; and a team picker whose choices and path come from here.
"""

import json
import random
import sys
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 7780
ORIGIN = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:1420"  # noqa: PLR2004

DEPARTMENTS = {
    "Engineering": ["Software Engineer", "Senior Engineer", "Staff Engineer", "Engineering Manager"],
    "Sales": ["Account Executive", "Sales Engineer", "Sales Manager"],
    "Marketing": ["Marketing Analyst", "Content Lead", "Marketing Manager"],
    "Finance": ["Accountant", "Financial Analyst", "Controller"],
    "People": ["Recruiter", "People Partner", "People Manager"],
}
OFFICES = ["London", "New York", "Singapore", "Remote"]
FIRST = ["Ada", "Ben", "Chen", "Dara", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jun", "Kai", "Lea", "Max", "Noor", "Omar", "Pia"]
LAST = ["Abe", "Brooks", "Costa", "Diaz", "Evans", "Fischer", "Gupta", "Hale", "Ito", "Jensen", "Khan", "Lopez", "Meyer"]
YEARS = [2022, 2023, 2024, 2025]
TEAMS = {
    "platform": ("Platform", "Engineering"),
    "payments": ("Payments", "Engineering"),
    "enterprise": ("Enterprise sales", "Sales"),
    "brand": ("Brand", "Marketing"),
}

DEPARTMENT_OPTIONS = [{"label": "All departments", "value": "all"}] + [{"label": d, "value": d} for d in DEPARTMENTS]

WIDGETS = {
    "hr_people": {
        "name": "People",
        "description": "The directory: pick a department and whether to include leavers. Add it twice to compare two",
        "category": "HR examples",
        "type": "ag-grid",
        "endpoint": "/people",
        "gridData": {"w": 24, "h": 14},
        "params": [
            {"paramName": "department", "type": "text", "label": "Department", "value": "all", "options": DEPARTMENT_OPTIONS},
            {"paramName": "active", "type": "boolean", "label": "Current staff only", "value": True},
        ],
        "data": {
            # The response is {"results": [...], "count": n}: the rows are under results
            "dataKey": "results",
            "ag-grid": {
                "columnDefs": [
                    {"field": "name", "pinned": "left", "minWidth": 160},
                    {"field": "title", "enableRowGroup": True},
                    {"field": "department", "enableRowGroup": True},
                    {"field": "office", "enableRowGroup": True, "rowGroup": True},
                    {"field": "startDate", "headerName": "Started", "valueFormat": {"style": "date"}},
                    {"field": "salary", "aggFunc": "avg", "valueFormat": {"style": "currency", "decimals": 0}},
                    {"field": "rating", "aggFunc": "avg", "valueFormat": {"style": "decimal", "decimals": 1}},
                    {"field": "active", "headerName": "Current", "enableRowGroup": True},
                ],
                "gridOptions": {
                    "autoGroupColumnDef": {"headerName": "Office / Name", "field": "name"},
                    "defaultColDef": {"floatingFilter": True},
                },
            },
        },
    },
    "hr_headcount": {
        "name": "Headcount by office",
        "description": "Joiners per office and department in a year: the columns come from the data",
        "category": "HR examples",
        "type": "ag-grid",
        "endpoint": "/headcount",
        "gridData": {"w": 24, "h": 10},
        "params": [
            {
                "paramName": "year",
                "type": "number",
                "label": "Year",
                "value": YEARS[-1],
                "options": [{"label": str(y), "value": y} for y in YEARS],
            },
        ],
    },
    "hr_team": {
        "name": "Team roster",
        "description": "One team's members: the teams come from this backend, and the team is in the path",
        "category": "HR examples",
        "type": "ag-grid",
        "endpoint": "/teams/{team}/members",
        "gridData": {"w": 20, "h": 10},
        "params": [
            {"paramName": "team", "type": "endpoint", "label": "Team", "value": "platform", "optionsEndpoint": "/teams"},
        ],
    },
}


def people(count: int = 240, seed: int = 3) -> list[dict]:
    """The same people on every start: the seed fixes them."""
    rng = random.Random(seed)
    rows = []
    for index in range(1, count + 1):
        department = rng.choice(list(DEPARTMENTS))
        started = date(2015, 1, 1) + timedelta(days=rng.randint(0, 3900))
        rows.append(
            {
                "id": f"E{index:04d}",
                "name": f"{rng.choice(FIRST)} {rng.choice(LAST)}",
                "title": rng.choice(DEPARTMENTS[department]),
                "department": department,
                "office": rng.choice(OFFICES),
                "startDate": started.isoformat(),
                "salary": rng.randrange(45_000, 210_000, 500),
                "rating": round(rng.uniform(2.5, 5), 1),
                "active": rng.random() > 0.12,  # noqa: PLR2004
                "team": rng.choice([key for key, (_, d) in TEAMS.items() if d == department] or [None]),
            }
        )
    return rows


PEOPLE = people()


def directory(query: dict[str, list[str]]) -> dict:
    department = query.get("department", ["all"])[0]
    active_only = query.get("active", ["true"])[0] != "false"
    rows = [
        {key: value for key, value in person.items() if key != "team"}
        for person in PEOPLE
        if (department == "all" or person["department"] == department) and (person["active"] or not active_only)
    ]
    return {"results": rows, "count": len(rows)}


def headcount(query: dict[str, list[str]]) -> dict:
    """One row per office, one column per department: the response declares the columns."""
    year = query.get("year", [str(YEARS[-1])])[0]
    joiners = [p for p in PEOPLE if p["startDate"].startswith(year)]
    rows = []
    for office in OFFICES:
        row = {"office": office}
        for department in DEPARTMENTS:
            row[department] = sum(1 for p in joiners if p["office"] == office and p["department"] == department)
        row["total"] = sum(row[d] for d in DEPARTMENTS)
        rows.append(row)
    return {
        "rowData": rows,
        "columnDefs": [
            {"field": "office", "pinned": "left"},
            {
                "headerName": f"Joiners in {year}",
                "children": [{"field": department, "maxWidth": 160} for department in DEPARTMENTS],
            },
            {"field": "total", "headerName": "Total", "sort": "desc"},
        ],
    }


def team_members(team: str) -> list[dict] | None:
    if team not in TEAMS:
        return None
    return [
        {"name": p["name"], "title": p["title"], "office": p["office"], "since": p["startDate"], "current": p["active"]}
        for p in PEOPLE
        if p["team"] == team
    ]


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: object = None) -> None:
        body = b"" if payload is None else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _route(self, path: str, query: dict[str, list[str]]) -> object | None:
        if path == "/widgets.json":
            return WIDGETS
        if path == "/people":
            return directory(query)
        if path == "/headcount":
            return headcount(query)
        if path == "/teams":
            return [{"label": label, "value": key} for key, (label, _) in TEAMS.items()]
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "teams" and parts[2] == "members":  # noqa: PLR2004
            return team_members(parts[1])
        return None

    def do_OPTIONS(self):
        # Any team's path is a route, the placeholder's included: Workspace checks the endpoint
        path = urlsplit(self.path).path
        parts = path.strip("/").split("/")
        team_path = len(parts) == 3 and parts[0] == "teams" and parts[2] == "members"  # noqa: PLR2004
        self._send(204 if team_path or self._route(path, {}) is not None else 404)

    def do_GET(self):
        # The grid sorts, filters and groups in its frame; the params pick the rows here
        url = urlsplit(self.path)
        payload = self._route(url.path, parse_qs(url.query))
        if payload is None:
            self._send(404, {"detail": "not found"})
        else:
            self._send(200, payload)

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    print(f"serving HR widgets on http://localhost:{PORT} for {ORIGIN}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
