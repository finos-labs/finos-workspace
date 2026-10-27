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
    widget_plugins,
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
from utilities.request_metrics import instrument
from utilities.runtime_metrics import start_runtime_metrics

config.settings.setup_logging()
logger.info("START")
logger.info(f"Python: {platform.python_version()}")
logger.info(f"OS: {platform.system()}")


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
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.settings.BACKEND_CORS_ORIGINS,
    allow_origin_regex=config.settings.BACKEND_CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", auth_helpers.CLIENT_HEADER],
)


if config.settings.PROMETHEUS:
    instrumentator = instrument(app)


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
    *widget_plugins.routers,
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
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "status": exc.status_code},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
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
    return JSONResponse(content={"success": True}, status_code=200)


def include_routers():
    active_routers = []
    for router in routers:
        if not any(
            tag in config.settings.SUPPRESSED_API_ROUTERS for tag in router.tags
        ):
            active_routers.extend(router.tags)
            app.include_router(router)

    logger.info(f"Included routers: {active_routers}", exclude=True)

    routes_to_remove = [
        route
        for route in app.routes
        if hasattr(route, "path")
        and route.path in config.settings.SUPPRESSED_API_ROUTES
    ]
    for route in routes_to_remove:
        app.routes.remove(route)


def start_prometheus(fork_id: int):
    if fork_id == 1:
        logger.info("Starting prometheus server")
        prometheus_client.start_http_server(config.PROMETHEUS_LISTENER_PORT)


include_routers()
if config.settings.PROMETHEUS:
    instrumentator.expose(app, endpoint="/metrics", should_gzip=True)
app.mount("", workspace_mcp_asgi_app, name="Workspace MCP App")
add_pagination(app)


app.add_middleware(GZipMiddleware)

app.add_middleware(auth_helpers.NoStoreMiddleware)

app.add_middleware(auth_helpers.AllowedOriginMiddleware)
