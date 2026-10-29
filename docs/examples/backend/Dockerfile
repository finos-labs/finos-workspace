FROM python:3.14.8-slim

ARG VERSION

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    SQL_EXPLORER_PACKAGE=/opt/plugin \
    SQL_EXPLORER_DATA=/data \
    PYTHONPATH=/opt/plugin/backend

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-compile -r /tmp/requirements.txt && rm /tmp/requirements.txt

COPY sql-explorer/dist/sql-explorer/${VERSION} /opt/plugin
COPY backend /opt/examples
RUN python -c "import sys; sys.path.insert(0, '/opt/examples'); import data; data.write_files('/data')"

USER 65534:65534
WORKDIR /opt/examples
EXPOSE 8080
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--no-server-header", "--no-access-log"]
