"""Prepares the example deployment in examples/compose.yaml, and prints only paths.

    .venv/bin/python examples/setup.py

- secrets/: generated passwords for the Postgres administrator and for `explorer`, the
  role the plugin reads with, and the plugin's postgres_url secret. Kept when they exist,
  since the database was created with them; delete the directory and the compose volume to
  start over. Mount secrets/workspace as Workspace's WIDGET_PLUGIN_SECRETS_DIR, or enter
  secrets/workspace/sql-explorer/postgres_url on the plugin's Deployment page.
- data/: the files DuckDB reads, rewritten on every run: readings.parquet and stations.csv.
"""

import os
import secrets
from pathlib import Path

import duckdb

HERE = Path(__file__).resolve().parent
SECRETS = HERE / "secrets"
DATA = HERE / "data"


def secret(path: Path, make) -> str:
    """The value at ``path``, written first when missing. Readable inside its 0700 directory:
    the Postgres container reads it as its own user."""
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(make(), encoding="utf-8")
        os.chmod(path, 0o644)
    return path.read_text(encoding="utf-8").strip()


def main() -> None:
    SECRETS.mkdir(mode=0o700, exist_ok=True)
    os.chmod(SECRETS, 0o700)
    secret(SECRETS / "postgres_password", lambda: secrets.token_urlsafe(32))
    password = secret(SECRETS / "explorer_password", lambda: secrets.token_urlsafe(32))
    url = SECRETS / "workspace" / "sql-explorer" / "postgres_url"
    secret(url, lambda: f"postgresql://explorer:{password}@postgres:5432/explorer")

    DATA.mkdir(exist_ok=True)
    readings = (DATA / "readings.parquet").as_posix().replace("'", "''")
    stations = (DATA / "stations.csv").as_posix().replace("'", "''")
    duckdb.sql(
        "COPY (SELECT timestamp '2026-09-01' + i * interval '15 minutes' AS taken_at,"
        " 'sensor-' || (i % 6) AS sensor,"
        " round(20 + 5 * sin(i / 40.0) + (i % 6) * 0.8 + ((i * 7919) % 100) / 100.0, 2) AS celsius"
        f" FROM range(5760) t(i)) TO '{readings}' (FORMAT parquet)"
    )
    duckdb.sql(
        "COPY (SELECT 'sensor-' || i AS sensor, ['north', 'south', 'east'][1 + i % 3] AS site,"
        " date '2025-01-01' + (i * 30)::INTEGER AS installed FROM range(6) t(i))"
        f" TO '{stations}' (HEADER, DELIMITER ',')"
    )

    print(f"secrets in {SECRETS}")
    print(f"the plugin's postgres_url secret: {url}")
    print(f"data files in {DATA}")


if __name__ == "__main__":
    main()
