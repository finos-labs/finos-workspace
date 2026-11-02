# The AgGrid widgets

The AgGrid plugin has four widgets. Show the table and the SQL widgets in the chat; add the live grid and the server-side table to a dashboard for the user.

| Widget | Shows | When it fits |
|---|---|---|
| `ag-grid/table` | Rows a backend returns, or rows you give | Any list of records the user will want to sort, filter, group, select, copy or export. This is the one you show in the chat. |
| `ag-grid/livegrid` | Rows kept current by a WebSocket that FINOS Workspace opens | A feed that changes while the user watches, such as prices. It needs a backend that streams; you cannot make one from the chat. |
| `ag-grid/ssrm` | A large Postgres table, paged, sorted, filtered, grouped and pivoted on the server | Tables too big to send (hundreds of thousands of rows). It needs the plugin's backend and a table name. |
| `ag-grid/sql` | A read-only SQL query that the widget runs, with the result in AgGrid | A question about the deployment's data. Write the query and show it with this component; see the skill `ag-grid-sql`. |

## The table component

Use `ag-grid/table` to show rows in the conversation. The user can add the card to a dashboard as a widget that keeps its rows, so give it a clear name. For a handful of values, a table in your answer is enough.

```json
{
  "columnDefs": [
    { "field": "region", "headerName": "Region" },
    { "field": "sales", "headerName": "Sales", "type": "numericColumn" }
  ],
  "rowData": [
    { "region": "EMEA", "sales": 124500 },
    { "region": "APAC", "sales": 98700 }
  ]
}
```

- `rowData` is the rows: objects of strings, numbers, booleans or nulls. At most 1,000 rows, and a value at most 500 characters.
- `columnDefs` is optional. Leave it out and the columns are the keys of the rows, with numbers right-aligned and formatted. Give it when you want other headers (`headerName`), an order, a `width`, or `type: "numericColumn"` for a number that arrives as text.
- A `field` is the key of the row's value. Keys that are not in `columnDefs` are not shown.

## Rules

- Rows you loaded in the conversation: do not copy them into the call. Fill `rowData` from the loaded table with `sql` (SELECT only, up to 1,000 rows) or `from_table_id`, with `rows_key` set to `rowData`.
- Dates as ISO 8601 strings (`2026-01-31`).
- Name columns for the reader (`headerName`), not for the database.
- Sort the rows the way the question reads (the newest, the largest) before you send them; the user can re-sort.
- The grid follows the workspace's light or dark mode. Do not describe colours.
- Say what the rows show; do not repeat them in your answer.
