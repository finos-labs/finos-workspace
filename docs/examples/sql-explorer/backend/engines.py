import json
import logging
import os
import re
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

import duckdb
import psycopg
from psycopg import sql as pgsql

from values import cell

MAX_ROWS = 1_000
MAX_RESULT_BYTES = 4 * 1024 * 1024
STATEMENT_SECONDS = 15
CONNECT_SECONDS = 5
MAX_SCHEMA_COLUMNS = 5_000
DATA = Path(os.environ.get("SQL_EXPLORER_DATA", "/data"))
READERS = {".parquet": "read_parquet", ".csv": "read_csv", ".json": "read_json", ".jsonl": "read_json"}
ONE_SELECT = "The explorer runs one SELECT statement."

log = logging.getLogger("sql_explorer")


class QueryError(Exception):
    ...


def collect(columns: list[dict], fetch: Callable[[int], list]) -> dict:
    batch = fetch(MAX_ROWS + 1)
    truncated = len(batch) > MAX_ROWS
    rows: list[list] = []
    size = 0
    for raw in batch[:MAX_ROWS]:
        row = [cell(value) for value in raw]
        size += len(json.dumps(row, ensure_ascii=False))
        if size > MAX_RESULT_BYTES:
            truncated = True
            break
        rows.append(row)
    return {"columns": columns, "rows": rows, "truncated": truncated}


@contextmanager
def deadline(seconds: float, cancel: Callable[[], object]) -> Iterator[None]:
    timer = threading.Timer(seconds, cancel)
    timer.daemon = True
    timer.start()
    try:
        yield
    finally:
        timer.cancel()


def _tables(rows: list[tuple]) -> list[dict]:
    tables: dict[tuple, dict] = {}
    for schema, table, column, kind in rows:
        entry = tables.setdefault((schema, table), {"schema": schema, "name": table, "columns": []})
        entry["columns"].append({"name": column, "type": kind})
    return list(tables.values())


POSTGRES_COLUMNS = """
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg\\_toast%%'
ORDER BY table_schema, table_name, ordinal_position
LIMIT %s
"""


def _application_name(caller: str | None) -> str:
    return f"workspace-sql-explorer:{caller[:16]}" if caller else "workspace-sql-explorer"


@contextmanager
def postgres_connection(url: str, caller: str | None) -> Iterator[psycopg.Connection]:
    try:
        connection = psycopg.connect(url, connect_timeout=CONNECT_SECONDS, application_name=_application_name(caller))
    except psycopg.Error as error:
        log.warning("postgres: could not connect: %s", str(error).splitlines()[0] if str(error) else type(error).__name__)
        raise QueryError(
            "Could not connect to the database. An administrator can check the plugin's postgres_url secret "
            "and the network the deployment gives its backend."
        ) from error
    try:
        connection.read_only = True
        yield connection
    finally:
        connection.close()


def postgres_message(error: psycopg.Error) -> str:
    diag = error.diag
    message = diag.message_primary or str(error).splitlines()[0]
    if diag.message_detail:
        message += f"\n{diag.message_detail}"
    if diag.message_hint:
        message += f"\nHint: {diag.message_hint}"
    if isinstance(error, psycopg.errors.QueryCanceled):
        message = f"The query ran longer than {STATEMENT_SECONDS} seconds and was stopped."
    elif isinstance(error, psycopg.errors.SyntaxError | psycopg.errors.FeatureNotSupported):
        message += f"\n{ONE_SELECT}"
    return message


def postgres_query(url: str, text: str, caller: str | None) -> dict:
    with postgres_connection(url, caller) as connection:
        try:
            with connection.transaction(), deadline(STATEMENT_SECONDS + 5, connection.cancel_safe):
                connection.execute(pgsql.SQL("SET LOCAL statement_timeout = {}").format(STATEMENT_SECONDS * 1000))
                with connection.cursor(name="explorer") as cursor:
                    cursor.execute(text)  # type: ignore[arg-type]
                    columns = [{"name": c.name, "type": c.type_display} for c in cursor.description or []]
                    result = collect(columns, cursor.fetchmany)
        except psycopg.Error as error:
            raise QueryError(postgres_message(error)) from error
    return {"engine": "postgres", **result}


def postgres_schema(url: str, caller: str | None) -> dict:
    with postgres_connection(url, caller) as connection:
        try:
            with connection.transaction():
                version = connection.execute("SHOW server_version").fetchone()
                rows = connection.execute(POSTGRES_COLUMNS, (MAX_SCHEMA_COLUMNS,)).fetchall()
        except psycopg.Error as error:
            raise QueryError(postgres_message(error)) from error
    return {"engine": f"PostgreSQL {version[0] if version else ''}".strip(), "tables": _tables(rows)}


def _quoted(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def _view_name(path: Path, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9_]", "_", path.stem.lower()) or "file"
    if base[0].isdigit():
        base = f"t_{base}"
    name, n = base, 1
    while name in taken:
        n += 1
        name = f"{base}_{n}"
    return name


@contextmanager
def _files() -> Iterator[tuple[duckdb.DuckDBPyConnection, dict[str, str], list[str]]]:
    connection = duckdb.connect(
        ":memory:",
        config={
            "threads": 2,
            "memory_limit": "256MB",
            "autoinstall_known_extensions": False,
            "autoload_known_extensions": False,
        },
    )
    try:
        connection.execute("SET temp_directory = ''")
        views: dict[str, str] = {}
        skipped: list[str] = []
        files = sorted(p for p in DATA.iterdir() if p.is_file() and p.suffix.lower() in READERS) if DATA.is_dir() else []
        for path in files:
            name = _view_name(path, set(views))
            reader = READERS[path.suffix.lower()]
            try:
                connection.execute(f'CREATE VIEW "{name}" AS SELECT * FROM {reader}({_quoted(str(path))})')
            except duckdb.Error as error:
                skipped.append(f"{path.name}: {str(error).splitlines()[0]}")
                continue
            views[name] = path.name
        connection.execute(f"SET allowed_directories = [{_quoted(str(DATA))}]")
        connection.execute("SET enable_external_access = false")
        connection.execute("SET lock_configuration = true")
        yield connection, views, skipped
    finally:
        connection.close()


def files_query(text: str) -> dict:
    try:
        statements = duckdb.extract_statements(text)
    except duckdb.Error as error:
        raise QueryError(str(error)) from error
    if len(statements) != 1 or statements[0].type != duckdb.StatementType.SELECT:
        raise QueryError(ONE_SELECT)
    with _files() as (connection, _views, _skipped):
        try:
            with deadline(STATEMENT_SECONDS, connection.interrupt):
                answer = connection.execute(text)
                columns = [{"name": name, "type": str(kind)} for name, kind, *_ in answer.description or []]
                result = collect(columns, answer.fetchmany)
        except duckdb.InterruptException as error:
            raise QueryError(f"The query ran longer than {STATEMENT_SECONDS} seconds and was stopped.") from error
        except duckdb.Error as error:
            raise QueryError(str(error)) from error
    return {"engine": "files", **result}


def files_schema() -> dict:
    with _files() as (connection, views, skipped):
        tables = []
        for name, filename in views.items():
            columns = connection.execute(f'DESCRIBE "{name}"').fetchall()
            tables.append(
                {
                    "schema": None,
                    "name": name,
                    "file": filename,
                    "columns": [{"name": c[0], "type": c[1]} for c in columns],
                }
            )
    return {"engine": f"DuckDB {duckdb.__version__}", "tables": tables, "skipped": skipped}
