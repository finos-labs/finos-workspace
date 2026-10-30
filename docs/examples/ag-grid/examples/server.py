"""A backend for the table chart widgets of the `ag-grid` plugin, on its own.

    uvicorn server:app --port 7800

Then add http://localhost:7800 under Connections in FINOS Workspace.
"""

import time

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

import ag_table_chart

ORIGINS = ["http://localhost:3000", "http://localhost:1420"]
LIVE_SECONDS = 5

TABLES = {
    "assets": ag_table_chart.assets,
    "projects": ag_table_chart.projects,
    "time-series": ag_table_chart.time_series,
    "regions": ag_table_chart.regions,
    "sparklines": ag_table_chart.sparklines,
    "profit-loss": ag_table_chart.profit_loss,
    "companies": ag_table_chart.companies,
}


def table(build):
    async def handler(_request: Request) -> JSONResponse:
        return JSONResponse(build())

    return handler


async def widgets(_request: Request) -> JSONResponse:
    return JSONResponse(ag_table_chart.WIDGETS)


async def company(request: Request) -> JSONResponse:
    return JSONResponse(ag_table_chart.company(request.query_params.get("symbol", "")))


async def live(_request: Request) -> JSONResponse:
    return JSONResponse(ag_table_chart.live(int(time.time() // LIVE_SECONDS)))


app = Starlette(
    routes=[
        Route("/widgets.json", widgets, methods=["GET"]),
        *[Route(f"/ag-table-chart/{name}", table(build), methods=["GET"]) for name, build in TABLES.items()],
        Route("/ag-table-chart/company", company, methods=["GET"]),
        Route("/ag-table-chart/live", live, methods=["GET"]),
    ],
    middleware=[Middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "OPTIONS"], allow_headers=["*"])],
)
