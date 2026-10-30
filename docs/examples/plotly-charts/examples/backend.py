import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import numpy as np
import plotly.graph_objects as go

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 7798
ORIGIN = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3000"  # noqa: PLR2004

TEMPLATES = {"dark": "plotly_dark", "light": "plotly_white"}

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
REGIONS = {
    "emea": [round(100 + 30 * np.sin(i / 2)) for i in range(12)],
    "apac": [round(80 + 25 * np.cos(i / 3)) for i in range(12)],
    "americas": [120 + 10 * i for i in range(12)],
}

WIDGETS = {
    "plotly_sales": {
        "name": "Sales by region",
        "description": "Monthly sales of three regions, stacked",
        "category": "Plotly examples",
        "type": "plotly",
        "endpoint": "/sales",
        "gridData": {"w": 20, "h": 12},
        "raw": True,
    },
    "plotly_trend": {
        "name": "Sales trend",
        "description": "The same sales, as lines",
        "category": "Plotly examples",
        "type": "plotly",
        "endpoint": "/trend",
        "gridData": {"w": 20, "h": 12},
    },
    "plotly_signal": {
        "name": "Signal and noise",
        "description": "A sampled signal, from numpy arrays",
        "category": "Plotly examples",
        "type": "plotly",
        "endpoint": "/signal",
        "gridData": {"w": 20, "h": 12},
    },
    "plotly_correlation": {
        "name": "Correlation",
        "description": "A heatmap of five series' correlations",
        "category": "Plotly examples",
        "type": "plotly",
        "endpoint": "/correlation",
        "gridData": {"w": 20, "h": 12},
    },
}


def sales(template: str) -> go.Figure:
    figure = go.Figure([go.Bar(name=region, x=MONTHS, y=values) for region, values in REGIONS.items()])
    return figure.update_layout(template=template, title="Sales by region", barmode="stack", yaxis_title="Units")


def trend(template: str) -> go.Figure:
    figure = go.Figure(
        [go.Scatter(name=region, x=MONTHS, y=values, mode="lines+markers") for region, values in REGIONS.items()]
    )
    return figure.update_layout(template=template, title="Sales trend", yaxis_title="Units")


def signal(template: str) -> go.Figure:
    t = np.linspace(0, 20, 80)
    samples = t[::4]
    figure = go.Figure(
        [
            go.Scatter(name="signal", x=t, y=np.sin(t), mode="lines"),
            go.Scatter(name="samples", x=samples, y=np.sin(samples) + 0.2 * np.cos(7 * samples), mode="markers"),
        ]
    )
    return figure.update_layout(template=template, title="Signal and noise", xaxis_title="t", yaxis_title="value")


def correlation(template: str) -> go.Figure:
    names = ["alpha", "beta", "gamma", "delta", "epsilon"]
    series = np.random.default_rng(7).normal(size=(5, 200)).cumsum(axis=1)
    figure = go.Figure(go.Heatmap(z=np.corrcoef(series), x=names, y=names, zmin=-1, zmax=1, colorscale="RdBu"))
    return figure.update_layout(template=template, title="Correlation")


FIGURES = {"/sales": sales, "/trend": trend, "/signal": signal, "/correlation": correlation}

ROWS = {"/sales": [{"month": month, **{region: values[i] for region, values in REGIONS.items()}} for i, month in enumerate(MONTHS)]}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes = b"") -> None:
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        path = urlsplit(self.path).path
        self._send(204 if path == "/widgets.json" or path in FIGURES else 404)

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == "/widgets.json":
            self._send(200, json.dumps(WIDGETS).encode())
        elif url.path in ROWS and parse_qs(url.query).get("raw", [""])[0] == "true":
            self._send(200, json.dumps(ROWS[url.path]).encode())
        elif url.path in FIGURES:
            theme = parse_qs(url.query).get("theme", [""])[0]
            figure = FIGURES[url.path](TEMPLATES.get(theme, "plotly"))
            self._send(200, figure.to_json().encode())
        else:
            self._send(404, json.dumps({"detail": "not found"}).encode())

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    print(f"serving plotly widgets on http://localhost:{PORT} for {ORIGIN}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
