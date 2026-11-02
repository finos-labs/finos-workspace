import json
import re
from decimal import Decimal

import engines
import psycopg
from psycopg import sql
from values import cell

MAX_PAGE = 1_000
MAX_PIVOT_VALUES = 100
MAX_COLUMNS = 500
SEPARATOR = "|"
AUTO_GROUP = "ag-Grid-AutoColumn"
AGGREGATES = {"sum", "avg", "min", "max", "count"}
NUMBER_TYPES = {"smallint", "integer", "bigint", "numeric", "decimal", "real", "double precision"}
TABLE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$")
COMPARISONS = {
    "equals": "=",
    "notEqual": "<>",
    "lessThan": "<",
    "lessThanOrEqual": "<=",
    "greaterThan": ">",
    "greaterThanOrEqual": ">=",
}
EMPTY = sql.SQL("")


def kind_of(data_type: str) -> str:
    if data_type in NUMBER_TYPES:
        return "number"
    if data_type == "date" or data_type.startswith("timestamp"):
        return "date"
    if data_type == "boolean":
        return "boolean"
    return "text"


class Query:
    def __init__(self) -> None:
        self.params: dict[str, object] = {}

    def value(self, value: object) -> sql.Placeholder:
        name = f"p{len(self.params)}"
        self.params[name] = value
        return sql.Placeholder(name)


def describe(connection: psycopg.Connection, name: object) -> tuple[sql.Identifier, list[tuple[str, str]]]:
    if not isinstance(name, str) or not TABLE.match(name):
        raise engines.QueryError("The table must be named as table or schema.table.")
    schema, _, table = name.rpartition(".")
    found = connection.execute(
        "SELECT t.table_type, c.column_name, c.data_type FROM information_schema.tables t"
        " JOIN information_schema.columns c USING (table_schema, table_name)"
        " WHERE t.table_schema = %s AND t.table_name = %s ORDER BY c.ordinal_position LIMIT %s",
        (schema or "public", table, MAX_COLUMNS),
    ).fetchall()
    if not found or found[0][0] != "BASE TABLE":
        raise engines.QueryError(f"There is no table {name} to read.")
    return sql.Identifier(schema or "public", table), [(column, data_type) for _, column, data_type in found]


def columns(url: str, args: dict, caller: str | None) -> dict:
    with engines.postgres_connection(url, caller) as connection:
        try:
            with connection.transaction():
                _, found = describe(connection, args.get("table"))
        except psycopg.Error as error:
            raise engines.QueryError(engines.postgres_message(error)) from error
    return {
        "engine": "postgres",
        "table": args["table"],
        "columns": [{"name": name, "type": data_type, "kind": kind_of(data_type)} for name, data_type in found],
    }


def _like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _text(q: Query, ident: sql.Identifier, op: object, value: object) -> sql.Composable:
    col = sql.SQL("CAST({} AS text)").format(ident)
    if op == "blank":
        return sql.SQL("({0} IS NULL OR {0} = '')").format(col)
    if op == "notBlank":
        return sql.SQL("({0} IS NOT NULL AND {0} <> '')").format(col)
    if not isinstance(value, str):
        raise engines.QueryError("A text filter needs a value.")
    shapes = {
        "equals": ("lower({}) = lower({})", value),
        "notEqual": ("lower({}) <> lower({})", value),
        "contains": ("{} ILIKE {}", f"%{_like(value)}%"),
        "notContains": ("{} NOT ILIKE {}", f"%{_like(value)}%"),
        "startsWith": ("{} ILIKE {}", f"{_like(value)}%"),
        "endsWith": ("{} ILIKE {}", f"%{_like(value)}"),
    }
    if op not in shapes:
        raise engines.QueryError(f"The text filter {op} is not supported.")
    shape, operand = shapes[op]
    return sql.SQL(shape).format(col, q.value(operand))


def _ordered(q: Query, left: sql.Composable, wrap, op: object, low: object, high: object) -> sql.Composable:
    if op == "blank":
        return sql.SQL("{} IS NULL").format(left)
    if op == "notBlank":
        return sql.SQL("{} IS NOT NULL").format(left)
    if low is None:
        raise engines.QueryError("The filter needs a value.")
    if op in COMPARISONS:
        return sql.SQL("{} {} {}").format(left, sql.SQL(COMPARISONS[op]), wrap(q.value(low)))
    if op == "inRange":
        if high is None:
            raise engines.QueryError("A range filter needs two values.")
        return sql.SQL("({} >= {} AND {} <= {})").format(left, wrap(q.value(low)), left, wrap(q.value(high)))
    raise engines.QueryError(f"The filter {op} is not supported.")


def _as(kind: str):
    return lambda value: sql.SQL("CAST({} AS " + kind + ")").format(value)


def _condition(q: Query, ident: sql.Identifier, model: object) -> sql.Composable:
    if not isinstance(model, dict):
        raise engines.QueryError("The filter is not an object.")
    kind = model.get("filterType")
    op = model.get("type")
    if kind == "text":
        return _text(q, ident, op, model.get("filter"))
    if kind == "number":
        return _ordered(q, ident, _as("numeric"), op, model.get("filter"), model.get("filterTo"))
    if kind == "date":
        return _ordered(q, _as("date")(ident), _as("date"), op, model.get("dateFrom"), model.get("dateTo"))
    if kind == "set" and isinstance(model.get("values"), list):
        wanted = [str(v) for v in model["values"] if v is not None]
        parts = [sql.SQL("CAST({} AS text) = ANY({})").format(ident, q.value(wanted))]
        if any(v is None for v in model["values"]):
            parts.append(sql.SQL("{} IS NULL").format(ident))
        return sql.SQL("({})").format(sql.SQL(" OR ").join(parts))
    raise engines.QueryError("The filter is not one the grid sends for this table.")


def _filter(q: Query, ident: sql.Identifier, model: dict) -> sql.Composable:
    if isinstance(model.get("conditions"), list):
        parts = [_condition(q, ident, m) for m in model["conditions"][:8]]
    elif "condition1" in model:
        parts = [_condition(q, ident, model["condition1"])]
        if "condition2" in model:
            parts.append(_condition(q, ident, model["condition2"]))
    else:
        return _condition(q, ident, model)
    return sql.SQL("({})").format(sql.SQL(" OR " if model.get("operator") == "OR" else " AND ").join(parts))


def _field(known: dict[str, str], name: object) -> str:
    if not isinstance(name, str) or name not in known:
        raise engines.QueryError(f"There is no column {name!r}.")
    return name


def _where(q: Query, request: dict, known: dict[str, str], levels: list[str]) -> sql.Composable:
    clauses: list[sql.Composable] = []
    for key, field in zip(request["groupKeys"], levels, strict=False):
        ident = sql.Identifier(field)
        if key is None or key == "":
            clauses.append(sql.SQL("{} IS NULL").format(ident))
        else:
            clauses.append(sql.SQL("CAST({} AS text) = {}").format(ident, q.value(str(key))))
    for field, one in request["filterModel"].items():
        clauses.append(_filter(q, sql.Identifier(_field(known, field)), one))
    return sql.SQL(" WHERE ") + sql.SQL(" AND ").join(clauses) if clauses else EMPTY


def _clean(request: object) -> dict:
    if not isinstance(request, dict):
        raise engines.QueryError("The request is not an object.")
    start, end = request.get("startRow", 0), request.get("endRow", 0)
    if not (isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= start + MAX_PAGE):
        raise engines.QueryError(f"A request covers 1 to {MAX_PAGE} rows.")
    cleaned: dict = {"startRow": start, "endRow": end, "pivotMode": request.get("pivotMode") is True}
    for name in ("rowGroupCols", "valueCols", "pivotCols", "groupKeys", "sortModel"):
        value = request.get(name) or []
        if not isinstance(value, list) or len(value) > 32:
            raise engines.QueryError(f"{name} is not a short list.")
        cleaned[name] = value
    cleaned["filterModel"] = request.get("filterModel") or {}
    if not isinstance(cleaned["filterModel"], dict):
        raise engines.QueryError("filterModel is not an object.")
    return cleaned


def _json(value: object) -> object:
    return float(value) if isinstance(value, Decimal) else cell(value)


def _order(sort_model: list, positions: dict[str, int]) -> list[sql.Composable]:
    parts: list[sql.Composable] = []
    for item in sort_model:
        position = positions.get(item.get("colId")) if isinstance(item, dict) else None
        if position:
            parts.append(sql.SQL(f"{position} {'DESC' if item.get('sort') == 'desc' else 'ASC'}"))
    return parts


def _paged(body: sql.Composable, order: list[sql.Composable], q: Query, request: dict) -> sql.Composable:
    return sql.SQL("{} ORDER BY {} LIMIT {} OFFSET {}").format(
        body,
        sql.SQL(", ").join(order),
        q.value(request["endRow"] - request["startRow"]),
        q.value(request["startRow"]),
    )


def _leaf(connection: psycopg.Connection, table: sql.Identifier, known: dict[str, str], request: dict) -> dict:
    levels = request["levels"]
    names = list(known)
    q = Query()
    where = _where(q, request, known, levels)
    body = sql.SQL("SELECT {} FROM {}{}").format(sql.SQL(", ").join(map(sql.Identifier, names)), table, where)
    order = [*_order(request["sortModel"], {n: i + 1 for i, n in enumerate(names)}), sql.SQL("ctid")]
    rows = connection.execute(_paged(body, order, q, request), q.params).fetchall()
    counter = Query()
    total = connection.execute(
        sql.SQL("SELECT count(*) FROM {}{}").format(table, _where(counter, request, known, levels)), counter.params
    ).fetchone()[0]
    return {"rows": [dict(zip(names, map(_json, row), strict=True)) for row in rows], "rowCount": total}


def _aggregates(request: dict, known: dict[str, str]) -> list[tuple[str, str]]:
    chosen = []
    for item in request["valueCols"]:
        if not isinstance(item, dict):
            raise engines.QueryError("A value column is not an object.")
        field = _field(known, item.get("field"))
        func = item.get("aggFunc")
        if func not in AGGREGATES:
            raise engines.QueryError(f"The aggregation {func!r} is not supported.")
        if func != "count" and known[field] != "number":
            raise engines.QueryError(f"{field} is not a number and cannot be aggregated with {func}.")
        chosen.append((field, func))
    return chosen


def _pivot_values(connection: psycopg.Connection, table: sql.Identifier, known: dict[str, str], request: dict, pivots: list[str], levels: list[str]) -> list[tuple]:
    q = Query()
    query = sql.SQL("SELECT DISTINCT {} FROM {}{} ORDER BY {} LIMIT {}").format(
        sql.SQL(", ").join(sql.SQL("CAST({} AS text)").format(sql.Identifier(p)) for p in pivots),
        table,
        _where(q, request, known, levels),
        sql.SQL(", ").join(sql.SQL(str(i + 1)) for i in range(len(pivots))),
        q.value(MAX_PIVOT_VALUES + 1),
    )
    found = connection.execute(query, q.params).fetchall()
    if len(found) > MAX_PIVOT_VALUES:
        raise engines.QueryError(f"Pivoting on {', '.join(pivots)} would make more than {MAX_PIVOT_VALUES} columns.")
    return [tuple(row) for row in found]


def _grouped(connection: psycopg.Connection, table: sql.Identifier, known: dict[str, str], request: dict) -> dict:
    levels = request["levels"]
    here = levels[len(request["groupKeys"])] if len(request["groupKeys"]) < len(levels) else None
    aggregates = _aggregates(request, known)
    pivots = [_field(known, p.get("field")) for p in request["pivotCols"]] if request["pivotMode"] else []
    q = Query()
    select: list[sql.Composable] = []
    names: list[str] = []
    positions: dict[str, int] = {}
    if here:
        select.append(sql.SQL("CAST({} AS text)").format(sql.Identifier(here)))
        names.append(here)
        positions[here] = positions[AUTO_GROUP] = 1
    pivot_fields: list[str] | None = None
    if pivots and aggregates:
        pivot_fields = []
        for combo in _pivot_values(connection, table, known, request, pivots, levels):
            matches = sql.SQL(" AND ").join(
                sql.SQL("CAST({} AS text) IS NOT DISTINCT FROM {}").format(sql.Identifier(p), q.value(v))
                for p, v in zip(pivots, combo, strict=True)
            )
            for field, func in aggregates:
                select.append(sql.SQL("{}({}) FILTER (WHERE {})").format(sql.SQL(func), sql.Identifier(field), matches))
                key = SEPARATOR.join([*("" if v is None else str(v).replace(SEPARATOR, " ") for v in combo), field])
                names.append(key)
                pivot_fields.append(key)
    else:
        for field, func in aggregates:
            select.append(sql.SQL("{}({})").format(sql.SQL(func), sql.Identifier(field)))
            names.append(field)
            positions[field] = len(select)
    if not select:
        select.append(sql.SQL("count(*)"))
        names.append("count")
    group_by = sql.SQL(" GROUP BY {}").format(sql.Identifier(here)) if here else EMPTY
    body = sql.SQL("SELECT {} FROM {}{}{}").format(sql.SQL(", ").join(select), table, _where(q, request, known, levels), group_by)
    order = _order(request["sortModel"], positions)
    if here:
        order.append(sql.SQL("1"))
    if order:
        rows = connection.execute(_paged(body, order, q, request), q.params).fetchall()
    else:
        rows = connection.execute(sql.SQL("{} LIMIT {} OFFSET {}").format(body, q.value(request["endRow"] - request["startRow"]), q.value(request["startRow"])), q.params).fetchall()
    total = len(rows)
    if here:
        counter = Query()
        total = connection.execute(
            sql.SQL("SELECT count(*) FROM (SELECT 1 FROM {}{} GROUP BY {}) g").format(
                table, _where(counter, request, known, levels), sql.Identifier(here)
            ),
            counter.params,
        ).fetchone()[0]
    answer = {"rows": [dict(zip(names, map(_json, row), strict=True)) for row in rows], "rowCount": total}
    if pivot_fields is not None:
        answer["pivotResultFields"] = pivot_fields
    return answer


def rows(url: str, args: dict, caller: str | None) -> dict:
    try:
        request = _clean(json.loads(args.get("request") or "null"))
    except ValueError as error:
        raise engines.QueryError("The request is not JSON.") from error
    with engines.postgres_connection(url, caller) as connection:
        try:
            with connection.transaction(), engines.deadline(engines.STATEMENT_SECONDS + 5, connection.cancel_safe):
                connection.execute(
                    sql.SQL("SET LOCAL statement_timeout = {}").format(sql.Literal(engines.STATEMENT_SECONDS * 1000))
                )
                table, found = describe(connection, args.get("table"))
                known = {name: kind_of(data_type) for name, data_type in found}
                request["levels"] = [_field(known, g.get("field") if isinstance(g, dict) else None) for g in request["rowGroupCols"]]
                grouping = len(request["groupKeys"]) < len(request["rowGroupCols"])
                pivoting = request["pivotMode"] and bool(request["valueCols"])
                answer = (_grouped if grouping or pivoting else _leaf)(connection, table, known, request)
        except psycopg.Error as error:
            raise engines.QueryError(engines.postgres_message(error)) from error
    return {"engine": "postgres", **answer}
