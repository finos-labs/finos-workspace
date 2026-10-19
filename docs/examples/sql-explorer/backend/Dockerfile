# The SQL explorer's backend, built from the package Workspace approved, so its identity
# matches the version's digest:
#
#   docker build -f backend/Dockerfile -t sql-explorer-backend:<version> <the package's version directory>
#
# Python 3.14: the newest Python DuckDB 1.5.6 publishes wheels for. The image holds no
# credential; the Postgres URL arrives with each call.
FROM python:3.14.8-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    SQL_EXPLORER_PACKAGE=/opt/plugin \
    SQL_EXPLORER_DATA=/data

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-compile -r /tmp/requirements.txt && rm /tmp/requirements.txt

# The whole package: the backend computes the version digest from these files at start
COPY . /opt/plugin

USER 65534:65534
WORKDIR /opt/plugin/backend
EXPOSE 8080
CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--no-server-header", "--no-access-log"]
