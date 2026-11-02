import json
import os
import secrets
from pathlib import Path

import engines
import psycopg
import pytest
import ssrm
from psycopg import sql


def _admin_url() -> str | None:
    if os.environ.get("SQL_EXPLORER_TEST_POSTGRES"):
        return os.environ["SQL_EXPLORER_TEST_POSTGRES"]
    path = os.environ.get("SQL_EXPLORER_TEST_POSTGRES_FILE")
    return Path(path).read_text(encoding="utf-8").strip() if path else None


ADMIN = _admin_url()
TABLE = "ssrm_test.trades"
REGIONS = ["emea", "apac", "americas"]
DESKS = ["rates", "credit"]


@pytest.fixture(scope="module")
def reader() -> str:
    if not ADMIN:
        pytest.skip("no Postgres to test against")
    password = secrets.token_urlsafe(24)
    with psycopg.connect(ADMIN, autocommit=True) as admin:
        admin.execute("DROP SCHEMA IF EXISTS ssrm_test CASCADE")
        admin.execute("DROP ROLE IF EXISTS ssrm_test_reader")
        admin.execute("CREATE SCHEMA ssrm_test")
        admin.execute(
            "CREATE TABLE ssrm_test.trades (id int, region text, desk text, qty int, price numeric(10, 2), traded date)"
        )
        admin.execute(
            "INSERT INTO ssrm_test.trades SELECT i, (ARRAY['emea','apac','americas'])[1 + i % 3],"
            " (ARRAY['rates','credit'])[1 + i % 2], i, i * 1.5, date '2026-01-01' + i FROM generate_series(1, 60) AS i"
        )
        admin.execute("CREATE VIEW ssrm_test.view_of_trades AS SELECT * FROM ssrm_test.trades")
        admin.execute(sql.SQL("CREATE ROLE ssrm_test_reader LOGIN PASSWORD {}").format(password))
        admin.execute("GRANT USAGE ON SCHEMA ssrm_test TO ssrm_test_reader")
        admin.execute("GRANT SELECT ON ALL TABLES IN SCHEMA ssrm_test TO ssrm_test_reader")
        where = f"{admin.info.host}:{admin.info.port}/{admin.info.dbname}"
    yield f"postgresql://ssrm_test_reader:{password}@{where}"
    with psycopg.connect(ADMIN, autocommit=True) as admin:
        admin.execute("DROP SCHEMA ssrm_test CASCADE")
        admin.execute("DROP OWNED BY ssrm_test_reader")
        admin.execute("DROP ROLE ssrm_test_reader")


def ask(url: str, **request) -> dict:
    full = {"startRow": 0, "endRow": 100, **request}
    return ssrm.rows(url, {"table": TABLE, "request": json.dumps(full)}, None)


def group(*fields: str) -> list[dict]:
    return [{"id": f, "field": f} for f in fields]


def values(**aggregates: str) -> list[dict]:
    return [{"id": f, "field": f, "aggFunc": func} for f, func in aggregates.items()]


def test_the_columns_come_with_their_kinds(reader):
    answer = ssrm.columns(reader, {"table": TABLE}, None)
    assert {c["name"]: c["kind"] for c in answer["columns"]} == {
        "id": "number",
        "region": "text",
        "desk": "text",
        "qty": "number",
        "price": "number",
        "traded": "date",
    }


def test_a_page_is_sorted_and_counted_on_the_server(reader):
    answer = ask(reader, startRow=5, endRow=10, sortModel=[{"colId": "qty", "sort": "desc"}])
    assert [r["qty"] for r in answer["rows"]] == [55, 54, 53, 52, 51]
    assert answer["rowCount"] == 60
    assert answer["rows"][0]["price"] == 82.5


def test_filters_run_in_the_database(reader):
    text = ask(reader, filterModel={"region": {"filterType": "text", "type": "startsWith", "filter": "AM"}})
    assert text["rowCount"] == 20
    assert {r["region"] for r in text["rows"]} == {"americas"}
    number = ask(reader, filterModel={"qty": {"filterType": "number", "type": "inRange", "filter": 10, "filterTo": 12}})
    assert sorted(r["qty"] for r in number["rows"]) == [10, 11, 12]
    both = ask(
        reader,
        filterModel={
            "qty": {
                "filterType": "number",
                "operator": "OR",
                "conditions": [
                    {"filterType": "number", "type": "lessThan", "filter": 3},
                    {"filterType": "number", "type": "greaterThan", "filter": 58},
                ],
            }
        },
    )
    assert sorted(r["qty"] for r in both["rows"]) == [1, 2, 59, 60]
    date = ask(reader, filterModel={"traded": {"filterType": "date", "type": "equals", "dateFrom": "2026-01-05 00:00:00"}})
    assert [r["id"] for r in date["rows"]] == [4]
    chosen = ask(reader, filterModel={"desk": {"filterType": "set", "values": ["credit"]}})
    assert chosen["rowCount"] == 30


def test_a_filter_cannot_carry_sql(reader):
    attack = "x' OR 1=1; DROP TABLE ssrm_test.trades; --"
    answer = ask(reader, filterModel={"region": {"filterType": "text", "type": "equals", "filter": attack}})
    assert answer["rowCount"] == 0
    assert ask(reader)["rowCount"] == 60


def test_row_groups_aggregate_level_by_level(reader):
    top = ask(reader, rowGroupCols=group("region", "desk"), valueCols=values(qty="sum"), sortModel=[{"colId": "qty", "sort": "desc"}])
    assert top["rowCount"] == 3
    assert [r["region"] for r in top["rows"]] == ["emea", "americas", "apac"]
    assert sum(r["qty"] for r in top["rows"]) == sum(range(1, 61))
    second = ask(reader, rowGroupCols=group("region", "desk"), valueCols=values(qty="sum"), groupKeys=["emea"])
    assert {r["desk"] for r in second["rows"]} == set(DESKS)
    leaves = ask(reader, rowGroupCols=group("region", "desk"), groupKeys=["emea", "rates"])
    assert leaves["rowCount"] == 10
    assert {(r["region"], r["desk"]) for r in leaves["rows"]} == {("emea", "rates")}


def test_group_levels_page_and_sort_by_the_group(reader):
    answer = ask(reader, startRow=1, endRow=2, rowGroupCols=group("region"), sortModel=[{"colId": "ag-Grid-AutoColumn", "sort": "desc"}])
    assert [r["region"] for r in answer["rows"]] == ["apac"]
    assert answer["rowCount"] == 3


def test_a_pivot_gives_its_columns_and_their_values(reader):
    answer = ask(
        reader,
        pivotMode=True,
        rowGroupCols=group("region"),
        pivotCols=group("desk"),
        valueCols=values(qty="sum"),
    )
    assert answer["pivotResultFields"] == ["credit|qty", "rates|qty"]
    emea = next(r for r in answer["rows"] if r["region"] == "emea")
    with psycopg.connect(ADMIN) as admin:
        want = admin.execute(
            "SELECT sum(qty) FILTER (WHERE desk = 'credit'), sum(qty) FILTER (WHERE desk = 'rates')"
            " FROM ssrm_test.trades WHERE region = 'emea'"
        ).fetchone()
    assert (emea["credit|qty"], emea["rates|qty"]) == tuple(float(v) for v in want)


def test_a_pivot_without_row_groups_is_one_row(reader):
    answer = ask(reader, pivotMode=True, pivotCols=group("region", "desk"), valueCols=values(qty="max", price="avg"))
    assert answer["rowCount"] == 1
    assert len(answer["pivotResultFields"]) == 12
    assert answer["rows"][0]["emea|credit|qty"] > 0


def test_requests_that_make_no_sense_are_refused_with_a_message(reader):
    for request in (
        {"sortModel": [], "filterModel": {"nope": {"filterType": "text", "type": "equals", "filter": "x"}}},
        {"rowGroupCols": group("nope")},
        {"rowGroupCols": group("region"), "valueCols": values(region="sum")},
        {"rowGroupCols": group("region"), "valueCols": values(qty="median")},
        {"startRow": 0, "endRow": 5000},
        {"filterModel": {"qty": {"filterType": "number", "type": "contains", "filter": 1}}},
    ):
        with pytest.raises(engines.QueryError):
            ask(reader, **request)
    for table in ("ssrm_test.view_of_trades", "ssrm_test.missing", "ssrm_test.trades; DROP TABLE x", "pg_catalog.pg_user", None):
        with pytest.raises(engines.QueryError):
            ssrm.columns(reader, {"table": table}, None)
    with pytest.raises(engines.QueryError):
        ssrm.rows(reader, {"table": TABLE, "request": "not json"}, None)


def test_the_role_stays_read_only(reader):
    with pytest.raises(engines.QueryError):
        ask(reader, rowGroupCols=group("region; DELETE FROM ssrm_test.trades"))
    assert ask(reader)["rowCount"] == 60
