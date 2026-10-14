"""The SQL explorer's backend: the requests Workspace's API sends a plugin backend
(Workspace docs/widget-plugins/AUTHORING.md 8), and nothing else.

    GET  /.workspace/identity        the plugin, version and digest of this package
    GET  /.workspace/health
    POST /.workspace/routes/<route>  {"args": {...}, "widget": {...}, "caller": {...}}

postgres_schema and postgres_query read the Postgres whose connection URL the API sends
as the postgres_url secret with each call; files_schema and files_query read the files
under /data with DuckDB. A query that fails is an answer, {"error": {"message"}}, for the
user to read. A 4xx is a call that should not have been made.

Nothing here holds a credential: the URL arrives with the call and is gone after it. The
log names the route, the outcome, the row count, the time and the caller's pseudonym,
never the query or the URL.
"""

import logging
import time

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

import engines
from identity import identity

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("sql_explorer")

IDENTITY = identity()
POSTGRES_URL = "x-workspace-secret-postgres-url"


class BadCall(Exception):
    """A call the API should not have sent: an answer of 400."""


def _sql(args: dict) -> str:
    text = args.get("sql")
    if not isinstance(text, str) or not text.strip():
        raise BadCall("sql is required")
    return text


ROUTES = {
    "postgres_schema": lambda url, args, caller: engines.postgres_schema(url, caller),
    "postgres_query": lambda url, args, caller: engines.postgres_query(url, _sql(args), caller),
    "files_schema": lambda url, args, caller: engines.files_schema(),
    "files_query": lambda url, args, caller: engines.files_query(_sql(args)),
}


async def get_identity(_request: Request) -> JSONResponse:
    return JSONResponse(IDENTITY)


async def get_health(_request: Request) -> JSONResponse:
    return JSONResponse({"ok": True})


async def post_route(request: Request) -> JSONResponse:
    route = request.path_params["route"]
    handler = ROUTES.get(route)
    if handler is None:
        return JSONResponse({"detail": "no such route"}, status_code=404)
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse({"detail": "the body is not JSON"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"detail": "the body is not an object"}, status_code=400)
    args = body.get("args") if isinstance(body.get("args"), dict) else {}
    caller = (body.get("caller") or {}).get("id") if isinstance(body.get("caller"), dict) else None
    caller = caller if isinstance(caller, str) else None
    url = request.headers.get(POSTGRES_URL)
    if route.startswith("postgres_") and not url:
        return JSONResponse({"detail": "the postgres_url secret was not sent"}, status_code=400)

    started = time.monotonic()
    try:
        answer = await run_in_threadpool(handler, url, args, caller)
        outcome = "ok"
    except engines.QueryError as error:
        answer, outcome = {"error": {"message": str(error)}}, "query_error"
    except BadCall as error:
        return JSONResponse({"detail": str(error)}, status_code=400)
    answer["elapsedMs"] = round((time.monotonic() - started) * 1000)
    log.info(
        "route=%s outcome=%s rows=%s ms=%s caller=%s",
        route,
        outcome,
        len(answer.get("rows", [])),
        answer["elapsedMs"],
        caller[:8] if caller else "-",
    )
    return JSONResponse(answer)


app = Starlette(
    routes=[
        Route("/.workspace/identity", get_identity, methods=["GET"]),
        Route("/.workspace/health", get_health, methods=["GET"]),
        Route("/.workspace/routes/{route}", post_route, methods=["POST"]),
    ]
)
