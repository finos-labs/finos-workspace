# syntax=docker/dockerfile:1.6
#
# Lite image.
#
# Bundles the FastAPI backend (Cython-compiled lite build), the workspace
# SPA (Vite runtime build), Redis, nginx, and supervisord into a single image.
# Defaults to SQLite at /data/workspace.db so a `docker run -d -p 3000:3000 -p 8000:8000` works
# without any -e flags. Override via standard backend env vars (DATABASE_TYPE,
# DB_HOST, ...).
#
# Build context: this directory, with backend/ (from backend-api/backend) and
# frontend/ assembled alongside the Dockerfile. See README.md / build-local.sh.
#   docker build -f Dockerfile -t <image> .
#
###############################################
# Frontend — build the Workspace SPA in runtime mode
###############################################
FROM node:22 AS frontend-build

ENV NODE_OPTIONS="--max-old-space-size=8192"

RUN npm install -g bun node-gyp

WORKDIR /app
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile

COPY frontend/ ./
# The nginx of this image serves the API on port 8000, an origin of its own: the browser
# names the web app's origin in every call, as the API requires
ENV VITE_BACKEND_URL=http://localhost:8000
RUN bun run build:runtime


###############################################
# Backend base — python + poetry deps
###############################################
FROM python:3.13-slim AS python-base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONIOENCODING=utf-8 \
    PIP_NO_CACHE_DIR=off \
    PIP_DISABLE_PIP_VERSION_CHECK=on \
    PIP_DEFAULT_TIMEOUT=100 \
    POETRY_VERSION=2.3.2 \
    POETRY_HOME="/opt/poetry" \
    POETRY_VIRTUALENVS_IN_PROJECT=true \
    POETRY_NO_INTERACTION=1 \
    PYSETUP_PATH="/opt" \
    VENV_PATH="/opt/.venv" \
    TZ="America/New_York"

ENV PATH="$POETRY_HOME/bin:$VENV_PATH/bin:$PATH"

RUN python -m pip install --upgrade pip setuptools


FROM python-base AS backend-build

RUN apt-get update -y && apt-get upgrade -y \
    && apt-get install --no-install-recommends -y \
       curl build-essential git unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR $PYSETUP_PATH

RUN pip install --upgrade setuptools poetry

COPY backend/pyproject.toml backend/poetry.lock ./
# Regenerate the lock if it's out of sync with pyproject.toml (e.g. after
# moving deps into an optional group). --no-update keeps existing pins.
RUN poetry lock --no-update || poetry lock
RUN poetry install --only main

RUN $VENV_PATH/bin/pip install "cython>=3.0" "setuptools>=68"

RUN rm -rf $VENV_PATH/src/slowapi/poetry.lock $VENV_PATH/src/slowapi/docs/requirements.txt


###############################################
# Backend compile — produce .so for api / routers / utilities
###############################################
FROM backend-build AS backend-compile

WORKDIR $PYSETUP_PATH/code

COPY backend/setup_compile.py ./
COPY backend/api ./api
COPY backend/routers ./routers
COPY backend/utilities ./utilities

RUN . $VENV_PATH/bin/activate \
    && python setup_compile.py build_ext --inplace

RUN find api routers utilities -name "*.py" ! -name "__init__.py" | while read -r f; do \
        base="${f%.py}"; \
        if ls "${base}".cpython-*.so >/dev/null 2>&1; then rm "$f"; fi; \
    done \
    && find api routers utilities -name "*.c" -delete \
    && find . -type d -name "__pycache__" -prune -exec rm -rf {} + \
    && find api routers utilities -name "*.so" -exec strip --strip-unneeded {} +

# Trim the venv now that compilation is done. Cython was build-only. Bytecode
# (__pycache__/*.pyc) is recreated on first import as needed and adds up to
# ~30-50 MB across site-packages.
#
# DO NOT blindly delete dirs named "tests" / "docs" / "examples" here —
# several packages ship real importable submodules under those names
# (e.g. boto3.docs is a runtime module, not documentation).
RUN $VENV_PATH/bin/pip uninstall -y cython pip setuptools 2>/dev/null || true \
    && find $VENV_PATH -depth -type d -name __pycache__ -exec rm -rf {} + \
    && find $VENV_PATH -depth -name "*.pyc" -delete \
    && find $VENV_PATH -depth -name "*.pyo" -delete


###############################################
# Runtime — backend + frontend + redis + nginx + supervisor
###############################################
FROM python-base AS runtime

RUN apt-get update -y \
    && apt-get install --no-install-recommends -y \
       nginx redis-server gettext-base tini \
    && rm -rf /var/lib/apt/lists/* /var/log/nginx/* \
              /usr/share/doc /usr/share/man /usr/share/info /usr/share/locale \
    && mkdir -p /var/log/supervisor /run/nginx

# supervisor via pip, not apt: the apt package drags in Debian's system Python
# stack (/usr/lib/python3/dist-packages), incl. vulnerable jaraco.context (CVE-2026-23949)
RUN python -m pip install supervisor

COPY --from=backend-compile $VENV_PATH $VENV_PATH

RUN useradd -m -s /bin/bash appuser

WORKDIR $PYSETUP_PATH/code

# Compiled backend (.so + __init__.py only).
COPY --from=backend-compile --chown=appuser:appuser $PYSETUP_PATH/code/api ./api
COPY --from=backend-compile --chown=appuser:appuser $PYSETUP_PATH/code/routers ./routers
COPY --from=backend-compile --chown=appuser:appuser $PYSETUP_PATH/code/utilities ./utilities

# Plain-Python entry points + migrations.
COPY --chown=appuser:appuser backend/main.py ./
COPY --chown=appuser:appuser backend/init-db.py ./
COPY --chown=appuser:appuser backend/alembic.ini ./
COPY --chown=appuser:appuser backend/alembic ./alembic
COPY --chown=appuser:appuser backend/scripts ./scripts

# Workspace MCP package (imported by routers/app/workspace_mcp via main.py).
# Shipped as source — it carries markdown resources loaded with
# importlib.resources, and is not part of the Cython compile stage. For a
# production lite release it should be added to setup_compile.py and compiled
# like api/routers/utilities.
COPY --chown=appuser:appuser backend/workspace_mcp ./workspace_mcp

# Frontend bundle. The config.js that the build wrote, and the names of the variables that
# set each of its settings, move aside: render-frontend-config writes config.js again at every
# start, from these and from the environment.
COPY --from=frontend-build /app/dist /usr/share/nginx/html
RUN mkdir -p /usr/local/share/workspace \
    && mv /usr/share/nginx/html/config.js /usr/share/nginx/html/config.env.json /usr/local/share/workspace/

# Container config.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY supervisord.conf /etc/supervisor/supervisord.conf
COPY entrypoint.sh /entrypoint.sh
# The keys of the container and the file of the data volume that keeps the generated ones
COPY secrets.sh /usr/local/lib/workspace/secrets.sh
COPY render_frontend_config.py /usr/local/bin/render-frontend-config
# Sets the administrator's password: `docker exec -it workspace credentials`
COPY credentials.sh /usr/local/bin/credentials

# Account import helper: `docker exec -it workspace workspace-import /import/<file>.zip`
COPY import.sh /usr/local/bin/workspace-import
# The admin CLI: `docker exec workspace workspace-admin <resource> <action>`
COPY workspace-admin.sh /usr/local/bin/workspace-admin
RUN chmod +x /entrypoint.sh /usr/local/bin/render-frontend-config /usr/local/bin/credentials /usr/local/bin/workspace-import /usr/local/bin/workspace-admin

ENV PATH="$VENV_PATH/bin:$PATH" \
    LD_LIBRARY_PATH="$VENV_PATH/lib" \
    PORT=3000 \
    DATABASE_TYPE=sqlite \
    DB_PATH=/data/workspace.db \
    FOLDER_STORAGE_PATH=/data/storage \
    REDIS_HOST=127.0.0.1 \
    REDIS_PORT=6379 \
    REDIS_PASS="" \
    MODE=lite \
    BACKEND_CORS_ORIGINS='["http://localhost:3000"]' \
    STORAGE_PROVIDER=folder \
    PROMETHEUS=0 \
    WORKERS=1 \
    SUPPRESSED_API_ROUTERS='[]' \
    SUPPRESSED_API_ROUTES='[]' \
    SELFURL=http://localhost:8000 \
    FRONTENDURL=http://localhost:3000 \
    APPURL=http://localhost:3000

# /data holds SQLite, folder storage, and the redis dump. Created here with
# appuser ownership so the first-mount of a named volume inherits it.
# /opt/code's contents were already --chown'd by each COPY; only the WORKDIR
# itself needs its ownership updated (init_users writes user_create.json here),
# so we keep this chown non-recursive to avoid duplicating ~100 MB of files
# into a new layer.
RUN mkdir -p /data /data/storage /data/redis \
    && chown appuser:appuser /data /data/storage /data/redis $PYSETUP_PATH/code

EXPOSE 3000 8000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=4)"]

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
