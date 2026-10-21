###############################################
# Backend: the API
###############################################
# The builder has Debian's Python 3.13 with the compiler, headers, git and
# Poetry that installing the dependencies needs. The image is distroless:
# Debian's Python 3.13 and the libraries it runs on, the virtual environment
# and the code. It has no shell, no package manager, no pip or setuptools and
# no compiler.

ARG PLATFORM=linux/amd64

###############################################
# Builder Image
###############################################
# Debian 13's Python is the one the distroless image runs, so the virtual
# environment's /usr/bin/python3.13 is there too.
FROM --platform=$PLATFORM debian:13.7-slim AS builder-base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=off \
    PIP_DISABLE_PIP_VERSION_CHECK=on \
    PIP_DEFAULT_TIMEOUT=100 \
    POETRY_VERSION=2.3.2 \
    POETRY_VIRTUALENVS_IN_PROJECT=true \
    POETRY_VIRTUALENVS_OPTIONS_NO_PIP=true \
    POETRY_NO_INTERACTION=1 \
    PYSETUP_PATH="/opt" \
    VENV_PATH="/opt/.venv"

RUN apt-get update -y && apt-get upgrade -y \
    && apt-get install --no-install-recommends -y \
      python3.13 python3.13-venv python3.13-dev build-essential git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Poetry runs from an environment of its own, which stays in this stage.
RUN python3.13 -m venv /opt/poetry && /opt/poetry/bin/pip install "poetry==$POETRY_VERSION"

WORKDIR $PYSETUP_PATH
COPY ./pyproject.toml ./poetry.lock ./

# The runtime dependencies, supervisor among them, into $VENV_PATH, without pip.
RUN /opt/poetry/bin/poetry install --only main

# remove slowapi poetry.lock/requirements.txt
RUN rm -rf $VENV_PATH/src/slowapi/poetry.lock $VENV_PATH/src/slowapi/docs/requirements.txt

# The image's users, and what its user, appuser, writes: supervisord's log and
# pid file, the code directory and the uploaded files.
RUN mkdir -p /rootfs/etc /writable/home/appuser /writable/var/log/supervisor /writable/var/run \
      /writable/opt/code/local_storage \
    && printf '%s\n' \
      'root:x:0:0:root:/root:/sbin/nologin' \
      'nobody:x:65534:65534:nobody:/nonexistent:/sbin/nologin' \
      'nonroot:x:65532:65532:nonroot:/home/nonroot:/sbin/nologin' \
      'appuser:x:1000:1000:appuser:/home/appuser:/sbin/nologin' > /rootfs/etc/passwd \
    && printf '%s\n' 'root:x:0:' 'nobody:x:65534:' 'nonroot:x:65532:' 'appuser:x:1000:' > /rootfs/etc/group \
    && touch /writable/var/log/supervisor/supervisord.log /writable/var/run/supervisord.pid

###############################################
# Production Image
###############################################
FROM --platform=$PLATFORM gcr.io/distroless/python3-debian13 AS production-stage

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONIOENCODING=utf-8 \
    VENV_PATH="/opt/.venv" \
    TZ="America/New_York" \
    PATH="/opt/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    LD_LIBRARY_PATH="/opt/.venv/lib"

COPY --from=builder-base /rootfs/ /
COPY --from=builder-base --chown=1000:1000 /writable/ /
COPY --from=builder-base $VENV_PATH $VENV_PATH

WORKDIR /opt/code
# Uploaded files live in local_storage (a volume in docker-compose.yml)
COPY --chown=1000:1000 ./ ./

USER 1000:1000

# The commands are whole: the base image's python3 entrypoint would come first.
ENTRYPOINT []
CMD ["python", "api_entrypoint.py"]
