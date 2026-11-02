# Answering data questions with AgGrid SQL

When the user asks about the deployment's data (the Postgres `demo` schema or the mounted files), do exactly this:

1. Call `load_tools` with the group `components`.
2. Call `show_plugin_artifact` with `component` `ag-grid/sql`, a short `name`, and `data` set to `{"source": "postgres" or "files", "sql": "<one SELECT>"}`.
3. Answer in one sentence: what the query computes. The card runs the query and shows the rows.

Do not use `execute_sql`, `get_widget_data` or `search_widgets` for this: they cannot reach the deployment's data. Do not pass the query as the call's own `sql`; it goes inside `data`. You do not see the result, so state no numbers.

```json
{ "source": "files", "sql": "SELECT region, sum(units) AS units FROM sales GROUP BY region ORDER BY region" }
```

## The two sources

| `source` | Engine | Names |
|---|---|---|
| `postgres` | The deployment's database, as a role that may only read | Schema-qualified tables, such as `demo.trades`. |
| `files` | DuckDB over the Parquet, CSV and JSON files the deployment mounts | Each file is a view named after it, such as `sales`, with no schema. |

## What a query may be

- One `SELECT` (or `VALUES`), nothing else: no `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `COPY`, no `SELECT INTO`, no second statement after a semicolon, no `ATTACH`, no reading a path outside the mounted files. The backend refuses anything else, and the card shows its message.
- At most 8,000 characters here, and 15 seconds, 1,000 rows and 4 MiB of result. Aggregate in SQL and use `LIMIT`; do not select a whole table to summarize it. `demo.trades` has 200,000 rows.
- Postgres dialect for `postgres` (`date_trunc('month', traded)`, `to_char`, `::numeric`); DuckDB dialect for `files` (`strftime`, `date_trunc`, `round`, list and struct types).
- Quote an identifier that is not lowercase letters, digits and underscores with double quotes.

## The example deployment

Postgres, schema `demo`:

- `demo.regions(region, name)`: `emea`, `apac`, `americas`.
- `demo.monthly_sales(month, region, units, revenue)`: one row per month and region, January 2025 to September 2026.
- `demo.sales_by_region(region, units, revenue)`: a view of the totals, with the region's long name.
- `demo.trades(id, traded, region, desk, trader, product, currency, quantity, price, notional)`: 200,000 trades. Regions `EMEA`, `APAC`, `Americas`; desks Rates, Credit, Equities, Commodities, FX; currencies USD, EUR, GBP, JPY.

Files:

- `sales(month, region, units)`: January to December 2026, regions `emea`, `apac`, `americas`.
- `deals(id, region, sales, date, status, rep)`: regions `EMEA`, `APAC`, `AMER`; status `active`, `pending` or `closed`.
- `readings(taken_at, sensor, celsius)`: a reading every 15 minutes from `sensor-0` to `sensor-5`, from 2026-09-01.
- `stations(sensor, site, installed)`: the six sensors, with a site (`north`, `south`, `east`).

Another deployment has other tables: ask the user, or read the table list in the widget's left panel, before you write a query against names you have not seen. A query that names a table that is not there fails, and the card says so.

## Rules

- Pick the source from the table: a name with a schema (`demo.trades`) is Postgres, a bare file name is Files.
- Ask for what the question needs: the columns, the filter, the order, a `LIMIT`.
- When the user gives you rows and wants them in a table, use the table component of the AgGrid plugin, not a query.
