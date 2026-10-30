# Tables with the AgGrid component

Use the AgGrid component (`ag-grid/grid`) to show rows the user will want to work with: sort, filter, group, select, copy or export. Use a plain table in your answer for a handful of values. The user can add the card to a dashboard as a widget, so give it a clear name.

## The data

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
