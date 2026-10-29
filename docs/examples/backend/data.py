import csv
import math
from pathlib import Path

import duckdb

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
REGIONS = {
    "emea": [round(100 + 30 * math.sin(i / 2)) for i in range(12)],
    "apac": [round(80 + 25 * math.cos(i / 3)) for i in range(12)],
    "americas": [120 + 10 * i for i in range(12)],
}

DEALS = [
    {"id": 1, "region": "EMEA", "sales": 124500, "date": "2026-01-10", "status": "active", "rep": "Alice"},
    {"id": 2, "region": "APAC", "sales": 98700, "date": "2026-01-12", "status": "active", "rep": "Bob"},
    {"id": 3, "region": "AMER", "sales": 156200, "date": "2026-01-15", "status": "pending", "rep": "Carol"},
    {"id": 4, "region": "EMEA", "sales": 87300, "date": "2026-01-18", "status": "active", "rep": "Dave"},
    {"id": 5, "region": "APAC", "sales": 112400, "date": "2026-01-20", "status": "closed", "rep": "Eve"},
    {"id": 6, "region": "AMER", "sales": 143100, "date": "2026-01-22", "status": "active", "rep": "Frank"},
]


def monthly_rows() -> list[dict]:
    return [{"month": month, **{region: values[i] for region, values in REGIONS.items()}} for i, month in enumerate(MONTHS)]


def write_files(directory: str) -> None:
    target = Path(directory)
    target.mkdir(parents=True, exist_ok=True)
    with (target / "sales.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["month", "region", "units"])
        for i, month in enumerate(MONTHS):
            for region, values in REGIONS.items():
                writer.writerow([f"2026-{i + 1:02d}-01", region, values[i]])
    with (target / "deals.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(DEALS[0]))
        writer.writeheader()
        writer.writerows(DEALS)
    readings = (target / "readings.parquet").as_posix().replace("'", "''")
    stations = (target / "stations.csv").as_posix().replace("'", "''")
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
