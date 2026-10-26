import platform
from contextlib import asynccontextmanager
from time import time

import prometheus_client
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi_pagination import add_pagination
from fastmcp.utilities.lifespan import combine_lifespans
from loguru import logger
from prometheus_fastapi_instrumentator import Instrumentator, metrics
from slowapi import _rate_limit_exceeded_handler  # noqa: PLC2701
from slowapi.errors import RateLimitExceeded
from starlette.middleware.cors import CORSMiddleware

from api import auth_helpers, helpers
from api.events.role_permission_events import init_audit_listeners
from api.rate_limit import limiter
from api.worker_tasks import start_background_tasks
from routers import (
    admin,
    auth,
    entity,
    plugins,
)
from routers.app import (
    dash,
    data_connectors,
    file_storage,
    index,
    mcp_oauth,
    user_apps,
    workspace_mcp,
    workspace_tools,
)
from routers.app.workspace_mcp.asgi import create_workspace_mcp_asgi_app
from utilities import config
from utilities.runtime_metrics import start_runtime_metrics

config.settings.setup_logging()
logger.info("START")
logger.info(f"Python: {platform.python_version()}")
logger.info(f"OS: {platform.system()}")

FASTAPI_KWARGS = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    await start_background_tasks()
    await init_audit_listeners()
    if config.settings.PROMETHEUS:
        start_runtime_metrics()
    yield
    await auth_helpers.close_app_redis()


workspace_mcp_asgi_app = create_workspace_mcp_asgi_app()

app = FastAPI(
    redoc_url=None,
    docs_url=None,
    openapi_url=None,
    lifespan=combine_lifespans(lifespan, workspace_mcp_asgi_app.lifespan),
    generate_unique_id_function=lambda route: route.name,
)

# Only the web app, by its exact origins, may read answers and send the session cookie. Its
# client header (auth_helpers.CLIENT_HEADER) needs this preflight, so no other origin can
# make a request that rides the session cookie.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.settings.BACKEND_CORS_ORIGINS,
    allow_origin_regex=config.settings.BACKEND_CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", auth_helpers.CLIENT_HEADER],
)


ns = {"metric_namespace": "payment_backend", "metric_subsystem": "fastapi"}

if config.settings.PROMETHEUS:
    instrumentator = Instrumentator(should_group_status_codes=False)
    instrumentator.add(metrics.requests(**ns))  # type: ignore
    instrumentator.add(metrics.response_size(**ns))  # type: ignore
    instrumentator.add(metrics.latency(buckets=(1, 2, 3, 4), **ns))  # type: ignore
    instrumentator.instrument(app)


app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore

routers = [
    auth.router,
    index.router,
    mcp_oauth.router,
    data_connectors.router,
    file_storage.router,
    file_storage.signed_router,
    dash.router,
    user_apps.router,
    workspace_mcp.router,
    workspace_tools.router,
    entity.router,
    admin.router,
    plugins.router,
]


@app.exception_handler(Exception)
async def api_exception_handler(request: Request, exc: Exception):
    helpers.add_log(request.url.path, str(exc), 500, request.method)
    extras = dict(
        method=request.method,
        path=request.url.path,
        status_code=499,
    )
    logger.bind(**extras).exception(exc)
    return JSONResponse(
        status_code=499, content={"detail": "unexpected error", "status": 499}
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    helpers.add_log(request.url.path, exc.detail, exc.status_code, request.method)
    extras = dict(
        method=request.method,
        path=request.url.path,
        status_code=exc.status_code,
    )
    logger.bind(**extras).exception(exc)
    # The exception's headers go out with it: WWW-Authenticate on a 401, the cookie a
    # refused sign-in clears
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "status": exc.status_code},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    # Where and why the request failed, never what it sent: inputs carry passwords,
    # tokens and keys
    logger.bind(method=request.method, path=request.url.path, status_code=422).warning(
        "Request validation failed: "
        + "; ".join(f"{error['loc']}: {error['type']}" for error in errors)
    )
    detail = (
        errors[0]["msg"].replace("Value error, ", "")
        if errors
        else "Error extracting validation details"
    )
    return JSONResponse(status_code=422, content={"detail": detail, "status": 422})


@app.middleware("http")
async def log_requests(request: Request, call_next):
    # The scheme of a request behind a proxy comes from X-Forwarded-Proto only when the
    # proxy is one of TRUSTED_PROXIES (uvicorn's proxy headers, run.py)
    start_time = time()

    try:
        response: Response = await call_next(request)
    except Exception as exc:
        process_time = (time() - start_time) * 1000
        logger.bind(
            method=request.method,
            path=request.url.path,
            status_code=500,
            response_time=process_time,
        ).exception(exc)
        return JSONResponse(
            status_code=400,
            content={"detail": "unexpected error", "status": 400},
        )

    process_time = (time() - start_time) * 1000
    response.headers["X-Process-Time"] = str(process_time)
    extras = dict(
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
        response_time=process_time,
    )
    if request.method != "OPTIONS":
        logger.info(
            f'"{request.method} path={request.url.path} completed_in={process_time:.2f}ms" {response.status_code}',  # noqa: E501
            **extras,
        )

    return response


@app.get("/health")
@app.get("/healthz")
@app.get("/")
def nginx():
    "This endpoint only exists to test NGINX"
    return JSONResponse(content={"success": True}, status_code=200)


def include_routers():
    active_routers = []
    for router in routers:
        # Supress routers
        if not any(
            tag in config.settings.SUPPRESSED_API_ROUTERS for tag in router.tags
        ):
            active_routers.extend(router.tags)
            app.include_router(router)

    # Include router
    logger.info(f"Included routers: {active_routers}", exclude=True)

    # Supress routes
    routes_to_remove = [
        route
        for route in app.routes
        if hasattr(route, "path")
        and route.path in config.settings.SUPPRESSED_API_ROUTES
    ]
    for route in routes_to_remove:
        app.routes.remove(route)


def start_prometheus(fork_id: int):
    "Start prometheus server"
    if fork_id == 1:
        logger.info("Starting prometheus server")
        prometheus_client.start_http_server(6970)


include_routers()
if config.settings.PROMETHEUS:
    # Register /metrics before the catch-all MCP mount below, otherwise the mount
    # (matched first) shadows it and returns the MCP credential error.
    instrumentator.expose(app, endpoint="/metrics", should_gzip=True)
app.mount("", workspace_mcp_asgi_app, name="Workspace MCP App")
add_pagination(app)


app.add_middleware(GZipMiddleware)

# No cache keeps an answer to a request that carried a credential
app.add_middleware(auth_helpers.NoStoreMiddleware)

# Added last so it is the outermost middleware: a request or websocket that does not name
# an allowed origin reaches nothing else
app.add_middleware(auth_helpers.AllowedOriginMiddleware)
