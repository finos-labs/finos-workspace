import time

import engines
from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route
from server import app as plugin

import charts
import grids
from data import monthly_rows
from widgets import WIDGETS

ORIGINS = ["http://localhost:3000", "http://localhost:1420"]
STREAM_SECONDS = 5
STREAM_ROWS = 30


def figure(body) -> Response:
    return Response(body.to_json(), media_type="application/json")


def chart(name: str):
    async def handler(request: Request) -> Response:
        if name == "sales" and request.query_params.get("raw") == "true":
            return JSONResponse(monthly_rows())
        return figure(charts.FIGURES[name](request.query_params.get("theme", "")))

    return handler


def grid(build):
    async def handler(_request: Request) -> JSONResponse:
        return JSONResponse(build())

    return handler


async def stream(_request: Request) -> JSONResponse:
    return JSONResponse(grids.stream(int(time.time() // STREAM_SECONDS) % STREAM_ROWS))


async def query_rows(request: Request) -> list[dict] | JSONResponse:
    text = request.query_params.get("sql", "")
    try:
        result = await run_in_threadpool(engines.files_query, text)
    except engines.QueryError as error:
        return JSONResponse({"detail": str(error)}, status_code=400)
    names = [column["name"] for column in result["columns"]]
    return [dict(zip(names, row, strict=True)) for row in result["rows"]]


async def sql_chart(request: Request) -> Response:
    rows = await query_rows(request)
    return rows if isinstance(rows, JSONResponse) else figure(charts.query(rows, request.query_params.get("theme", "")))


async def widgets(_request: Request) -> JSONResponse:
    return JSONResponse(WIDGETS)


GRIDS = {
    "explicit": grids.explicit,
    "records": grids.records,
    "columns": grids.columns,
    "split": grids.split,
    "dates": grids.dates,
    "grouped": grids.grouped,
    "multicolumn": grids.multicolumn,
}

app = Starlette(
    routes=[
        Route("/widgets.json", widgets, methods=["GET"]),
        *[Route(f"/plotly/{name}", chart(name), methods=["GET"]) for name in charts.FIGURES],
        *[Route(f"/ag-grid/{name}", grid(build), methods=["GET"]) for name, build in GRIDS.items()],
        Route("/ag-grid/stream", stream, methods=["GET"]),
        Route("/sql/chart", sql_chart, methods=["GET"]),
        Mount("/", app=plugin),
    ],
    middleware=[Middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "OPTIONS"], allow_headers=["*"])],
)
