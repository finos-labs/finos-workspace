"""The FINOS Workspace reference backend, in Python.

Every widget of FINOS Workspace's built-in types, with invented data. The
TypeScript version in ../typescript answers every request the same way.

    pip install -r requirements.txt
    uvicorn main:app --port 5050
"""

import base64
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import Body, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    PlainTextResponse,
)

ROOT = Path(__file__).resolve().parent.parent
APP_ORIGIN = os.environ.get("APP_ORIGIN", "http://localhost:3000")

WIDGETS = json.loads((ROOT / "widgets.json").read_text())
APPS = json.loads((ROOT / "apps.json").read_text())
DATA = json.loads((ROOT / "data.json").read_text())
ASSETS = {"sample-report.pdf": "application/pdf", "revenue-chart.svg": "image/svg+xml"}
COMPANIES = {company["id"]: company for company in DATA["companies"]}
REGIONS = {region["value"]: region["label"] for region in DATA["regions"]}

PALETTES = {
    "dark": {
        "background": "#0b2432",
        "card": "#12313f",
        "text": "#e7f2f8",
        "muted": "#9db4c0",
        "border": "#355867",
    },
    "light": {
        "background": "#ffffff",
        "card": "#f2f6f8",
        "text": "#1a3248",
        "muted": "#5a7282",
        "border": "#b7cdd8",
    },
}

clients: list[dict] = []

app = FastAPI(title="FINOS Workspace reference backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[APP_ORIGIN],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Desk"],
)


def markdown(text: str) -> PlainTextResponse:
    return PlainTextResponse(text, media_type="text/markdown")


def page(theme: str, body: str) -> HTMLResponse:
    colors = PALETTES.get(theme, PALETTES["dark"])
    return HTMLResponse(f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ margin: 0; padding: 16px; background: {colors["background"]}; color: {colors["text"]}; font: 14px/1.4 system-ui, sans-serif; }}
  .grid {{ display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }}
  .card {{ background: {colors["card"]}; border-radius: 8px; padding: 12px; }}
  .muted {{ color: {colors["muted"]}; font-size: 12px; }}
  .value {{ font-size: 22px; font-weight: 600; }}
  .up {{ color: #2e9e6a; }}
  .down {{ color: #d0504f; }}
  table {{ border-collapse: collapse; width: 100%; }}
  th, td {{ border-bottom: 1px solid {colors["border"]}; padding: 6px 8px; text-align: left; }}
</style>
</head>
<body>{body}</body>
</html>""")


def table(columns: list[str], rows: list[list]) -> str:
    head = "".join(f"<th>{column}</th>" for column in columns)
    body = "".join(
        "<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>" for row in rows
    )
    return f"<table><tr>{head}</tr>{body}</table>"


def company_or_404(company: str) -> dict:
    if company not in COMPANIES:
        raise HTTPException(status_code=404, detail=f"Unknown company: {company}")
    return COMPANIES[company]


def holdings_list(count: int) -> str:
    return "\n".join(
        f"- {holding['company']}: {holding['weight']}"
        for holding in DATA["holdings"][:count]
    )


def fetched_at() -> str:
    return datetime.now(UTC).strftime("%H:%M:%S")


@app.get("/")
def root() -> dict:
    return {"name": "FINOS Workspace reference backend", "widgets": len(WIDGETS)}


@app.get("/widgets.json")
def widgets() -> dict:
    return WIDGETS


@app.get("/apps.json")
def apps() -> list:
    return APPS


@app.get("/assets/{name}")
def asset(name: str) -> FileResponse:
    if name not in ASSETS:
        raise HTTPException(status_code=404, detail="Not Found")
    return FileResponse(ROOT / "assets" / name, media_type=ASSETS[name])


# Widget types


@app.get("/markdown_widget")
def markdown_widget() -> PlainTextResponse:
    return markdown(
        "# Reference backend\n\n"
        "This widget is Markdown that the backend returns as text. "
        "Every name and number in this backend is invented.\n\n"
        "- **Bold**, *italic* and `code`\n"
        "- Lists and tables\n\n"
        "| Company | Sector |\n|---|---|\n"
        + "\n".join(
            f"| {company['name']} | {company['sector']} |"
            for company in DATA["companies"]
        )
    )


@app.get("/markdown_widget_with_image")
def markdown_widget_with_image() -> PlainTextResponse:
    svg = base64.b64encode(
        (ROOT / "assets" / "revenue-chart.svg").read_bytes()
    ).decode()
    return markdown(
        f"## Revenue by company\n\n![Revenue by company](data:image/svg+xml;base64,{svg})"
    )


@app.get("/markdown_widget_with_error")
def markdown_widget_with_error() -> None:
    raise HTTPException(
        status_code=500,
        detail="This widget fails on purpose, to show how an error looks.",
    )


@app.get("/html_widget", response_model=None)
def html_widget(theme: str = "dark", raw: bool = False) -> HTMLResponse | list:
    if raw:
        return DATA["portfolio"]
    cards = "".join(
        f'<div class="card"><div class="muted">{row["metric"]}</div>'
        f'<div class="value">{row["value"]}</div>'
        f'<div class="{"down" if row["change"].startswith("-") else "up"}">{row["change"]}</div></div>'
        for row in DATA["portfolio"]
    )
    return page(theme, f'<div class="grid">{cards}</div>')


@app.get("/html_table_widget", response_model=None)
def html_table_widget(theme: str = "dark", raw: bool = False) -> HTMLResponse | list:
    if raw:
        return DATA["holdings"]
    rows = [
        [h["company"], h["sector"], h["quantity"], h["price"], h["weight"]]
        for h in DATA["holdings"]
    ]
    return page(
        theme, table(["Company", "Sector", "Quantity", "Price", "Weight"], rows)
    )


@app.get("/newsfeed_widget")
def newsfeed_widget(category: str = "all") -> list:
    fields = ("title", "date", "author", "excerpt", "body")
    return [
        {field: article[field] for field in fields}
        for article in DATA["articles"]
        if category == "all" or article["category"] == category
    ]


@app.get("/pdf_widget")
def pdf_widget() -> FileResponse:
    return FileResponse(
        ROOT / "assets" / "sample-report.pdf", media_type="application/pdf"
    )


@app.get("/pdf_widget_base64")
def pdf_widget_base64() -> dict:
    content = base64.b64encode(
        (ROOT / "assets" / "sample-report.pdf").read_bytes()
    ).decode()
    return {
        "data_format": {"data_type": "pdf", "filename": "sample-report.pdf"},
        "content": content,
    }


@app.get("/pdf_widget_url")
def pdf_widget_url(request: Request) -> dict:
    url = f"{str(request.base_url).rstrip('/')}/assets/sample-report.pdf"
    return {
        "data_format": {"data_type": "pdf", "filename": "sample-report.pdf"},
        "url": url,
    }


@app.get("/iframe_page")
def iframe_page(theme: str = "dark") -> HTMLResponse:
    return page(
        theme,
        "<h2>A page in a frame</h2><p>The iframe widget opens this page, which the backend serves.</p>",
    )


# Parameters


@app.get("/param_text")
def param_text(name: str = "") -> PlainTextResponse:
    return markdown(f"Hello, **{name or 'nobody'}**.")


@app.get("/param_number")
def param_number(count: int = 3) -> PlainTextResponse:
    return markdown(f"The {count} largest holdings:\n\n{holdings_list(count)}")


@app.get("/param_boolean")
def param_boolean(include_details: bool = False) -> PlainTextResponse:
    lines = [
        f"- **{c['name']}**"
        + (f": {c['sector']}, {c['headquarters']}" if include_details else "")
        for c in DATA["companies"]
    ]
    return markdown("\n".join(lines))


@app.get("/param_date")
def param_date(as_of: str = "") -> PlainTextResponse:
    return markdown(f"Report as of **{as_of or 'today'}**.")


@app.get("/param_dropdown")
def param_dropdown(region: str = "europe") -> PlainTextResponse:
    return markdown(DATA["regionSummaries"].get(region, f"No data for {region}."))


@app.get("/param_multi_select")
def param_multi_select(regions: str = "") -> PlainTextResponse:
    chosen = [region for region in regions.split(",") if region]
    return markdown(
        "\n".join(
            f"- {DATA['regionSummaries'].get(region, region)}" for region in chosen
        )
        or "No region chosen."
    )


@app.get("/param_multiple_text")
def param_multiple_text(tags: str = "") -> PlainTextResponse:
    chosen = [tag for tag in tags.split(",") if tag]
    return markdown(f"{len(chosen)} tags: " + ", ".join(f"`{tag}`" for tag in chosen))


@app.get("/company_options")
def company_options() -> list:
    return [
        {"label": company["name"], "value": company["id"]}
        for company in DATA["companies"]
    ]


@app.get("/param_endpoint_dropdown")
def param_endpoint_dropdown(company: str = "alder") -> PlainTextResponse:
    found = company_or_404(company)
    return markdown(f"## {found['name']}\n\n{found['summary']}")


@app.get("/city_options")
def city_options(country: str = "") -> list:
    return DATA["cities"].get(country, [])


@app.get("/param_dependent_dropdown")
def param_dependent_dropdown(country: str = "", city: str = "") -> PlainTextResponse:
    return markdown(f"Country: **{country or 'none'}**, city: **{city or 'none'}**.")


@app.get("/param_rows")
def param_rows(
    region: str = "americas", count: int = 2, note: str = ""
) -> PlainTextResponse:
    text = f"{DATA['regionSummaries'].get(region, region)}\n\n{holdings_list(count)}"
    return markdown(text + (f"\n\n> {note}" if note else ""))


@app.get("/param_header")
def param_header(
    x_desk: Annotated[str, Header(alias="X-Desk")] = "",
) -> PlainTextResponse:
    return markdown(f"The `X-Desk` header says **{x_desk or 'nothing'}**.")


@app.post("/param_body")
def param_body(body: Annotated[dict, Body()]) -> PlainTextResponse:
    region = body.get("region", "")
    limit = int(body.get("limit", 0))
    return markdown(
        f"POST body: region **{region}**, limit **{limit}**.\n\n{holdings_list(limit)}"
    )


@app.get("/regions/{region}/summary")
def region_summary(region: str) -> PlainTextResponse:
    if region not in REGIONS:
        raise HTTPException(status_code=404, detail=f"Unknown region: {region}")
    return markdown(f"Path parameter: `{region}`\n\n{DATA['regionSummaries'][region]}")


# Widget settings


def settings_widget(name: str) -> PlainTextResponse:
    return markdown(f"**{name}**\n\nFetched at {fetched_at()} UTC.")


@app.get("/setting_stale_time")
def setting_stale_time() -> PlainTextResponse:
    return settings_widget("Stale time: one minute")


@app.get("/setting_refetch_interval")
def setting_refetch_interval() -> PlainTextResponse:
    return settings_widget("Refetch interval: 15 seconds")


@app.get("/setting_cron_refetch")
def setting_cron_refetch() -> PlainTextResponse:
    return settings_widget("Refetch schedule: every five minutes")


@app.get("/setting_data_update_display")
def setting_data_update_display() -> PlainTextResponse:
    return settings_widget("Data changes at 9:00 on weekdays")


@app.get("/setting_run_button")
def setting_run_button() -> PlainTextResponse:
    return settings_widget("Fetched when you select Run")


# Linked widgets


@app.get("/company_profile")
def company_profile(company: str = "alder") -> PlainTextResponse:
    found = company_or_404(company)
    return markdown(
        f"## {found['name']}\n\n{found['summary']}\n\n"
        f"- Sector: {found['sector']}\n- Founded: {found['founded']}\n- Headquarters: {found['headquarters']}"
    )


@app.get("/company_performance", response_model=None)
def company_performance(
    company: str = "alder", theme: str = "dark", raw: bool = False
) -> HTMLResponse | list:
    found = company_or_404(company)
    if raw:
        return found["performance"]
    rows = [
        [row["year"], row["revenue"], row["growth"]] for row in found["performance"]
    ]
    return page(
        theme,
        f"<h3>{found['name']}</h3>" + table(["Year", "Revenue ($M)", "Growth"], rows),
    )


# Forms


@app.post("/client_form")
def client_form(body: Annotated[dict, Body()]) -> JSONResponse:
    if not body.get("first_name") or not body.get("last_name"):
        return JSONResponse(
            status_code=400,
            content={"detail": "First name and last name are required."},
        )
    types = body.get("investment_types") or []
    clients.append(
        {
            "first_name": body["first_name"],
            "last_name": body["last_name"],
            "investment_types": ", ".join(types)
            if isinstance(types, list)
            else str(types),
            "risk_profile": body.get("risk_profile", ""),
        }
    )
    return JSONResponse(content={"success": True})


@app.get("/client_entries")
def client_entries() -> PlainTextResponse:
    if not clients:
        return markdown("No clients yet. Fill in the form and select **Add client**.")
    rows = "\n".join(
        f"| {c['first_name']} {c['last_name']} | {c['investment_types']} | {c['risk_profile']} |"
        for c in clients
    )
    return markdown(
        f"| Client | Investment types | Risk profile |\n|---|---|---|\n{rows}"
    )
