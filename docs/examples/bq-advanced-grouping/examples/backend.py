import json
import random
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

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

WIDGETS = {
    "bq_advanced_grouping": {
        "name": "BQ Advanced Grouping",
        "description": "Group and aggregate company data across any combination of columns",
        "category": "Data Grid",
        "source": "BrightQuery",
        "type": "bq-advanced-grouping",
        "endpoint": "/companies",
        "gridData": {"w": 20, "h": 12},
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


ROWS = companies()
RESPONSES = {
    "/widgets.json": json.dumps(WIDGETS).encode(),
    "/companies": json.dumps({"rows": ROWS, "total": len(ROWS)}).encode(),
}


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
        # The plugin groups and searches in its frame, so the rows ignore the query (theme=)
        body = RESPONSES.get(urlsplit(self.path).path)
        if body is None:
            self._send(404, json.dumps({"detail": "not found"}).encode())
        else:
            self._send(200, body)

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    print(f"serving company rows on http://localhost:{PORT} for {ORIGIN}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
