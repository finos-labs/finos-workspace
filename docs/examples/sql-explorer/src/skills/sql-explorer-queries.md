# Writing SQL for the SQL explorer

The SQL explorer runs one read-only query at a time against one of two sources, from the user's own session. You cannot run a query yourself: give the query to the user, who runs it in the explorer, or show rows you already have with the SQL result component (`sql-explorer/grid`).

## The two sources

| Source | Engine | Names |
|---|---|---|
| Postgres | The deployment's database, as a role that may only read | Schema-qualified tables, such as `demo.monthly_sales`. |
| Files | DuckDB over the Parquet, CSV and JSON files the deployment mounts | Each file is a view named after it, such as `sales`, with no schema. |

## What a query may be

- One `SELECT` (or `VALUES`), nothing else: no `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `COPY`, no `SELECT INTO`, no second statement after a semicolon, no `ATTACH`, no reading a path outside the mounted files.
- At most 32,768 characters, 15 seconds, 1,000 rows and 4 MiB of result. Aggregate in SQL and use `LIMIT`; do not select a whole table to summarize it.
- Postgres dialect for the Postgres source (`date_trunc('month', month)`, `to_char`, `::numeric`); DuckDB dialect for the Files source (`strftime`, `date_trunc`, `round`, list and struct types).
- Quote an identifier that is not lowercase letters, digits and underscores with double quotes.

## The example deployment

Postgres, schema `demo`:

- `demo.regions(region, name)`: `emea`, `apac`, `americas`.
- `demo.monthly_sales(month, region, units, revenue)`: one row per month and region, January 2025 to September 2026.
- `demo.sales_by_region(region, units, revenue)`: a view of the totals, with the region's long name.

Files:

- `sales(month, region, units)`: January to December 2026, regions `emea`, `apac`, `americas`.
- `deals(id, region, sales, date, status, rep)`: regions `EMEA`, `APAC`, `AMER`; status `active`, `pending` or `closed`.
- `readings(taken_at, sensor, celsius)`: a reading every 15 minutes from `sensor-0` to `sensor-5`, from 2026-09-01.
- `stations(sensor, site, installed)`: the six sensors, with a site (`north`, `south`, `east`).

Another deployment has other tables: ask the user, or read the table list in the explorer's left panel, before you write a query against names you have not seen.

## Giving the user a query

- Put the SQL in one code block, say which source it is for, and say what rows to expect. The user pastes it into the SQL explorer or the SQL grid and runs it with Ctrl+Enter or ⌘+Enter.
- The *SQL chart* widget reads the Files source with the same rules: its query's first column is the categories and the other columns are the bars.

## Showing rows you have

When the rows are in the conversation, show them with the SQL result component: `columns` (name and, when known, type) and `rows`, with `sql` set to the query that produced them if there is one. Fill `rows` from a loaded table with `sql` or `from_table_id` and `rows_key` set to `rows` rather than copying values. The card is a snapshot: it does not run anything. The user adds it to a dashboard as a widget, and opens the SQL explorer to run a query.
