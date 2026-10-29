/**
 * The grid a backend asks for, from two places: the widget's `data["bq-ag-grid"]` in its
 * `widgets.json` (the `definition` trait, checked by Workspace against the manifest's
 * schema) and the endpoint's response (the `data` trait). The response is either the rows,
 * or `{ rowData, columnDefs?, gridOptions? }` in AG Grid's own names.
 *
 * Only JSON-safe options are kept: a response cannot carry functions, and the frame blocks
 * `eval`, so a formatter is `valueFormat`, a declaration, never code. Unknown keys and
 * values of the wrong type are dropped, and reported, rather than passed to the grid.
 * Pure functions, tested without a browser.
 */

export type Row = Record<string, unknown>;

export const CELL_DATA_TYPES = ["text", "number", "boolean", "date", "dateString", "object"] as const;
export type CellDataType = (typeof CELL_DATA_TYPES)[number];

export const AGG_FUNCS = ["sum", "avg", "min", "max", "count"] as const;
export type AggFunc = (typeof AGG_FUNCS)[number];

/** `filter` values: `true` picks the filter of the column's data type. */
const FILTERS = [true, false, "agTextColumnFilter", "agNumberColumnFilter", "agDateColumnFilter"] as const;

export interface ValueFormat {
  style: "decimal" | "percent" | "currency" | "date";
  currency?: string;
  decimals?: number;
  notation?: "standard" | "compact";
  dateStyle?: "short" | "medium" | "long";
}

export interface ColumnSpec {
  field: string;
  headerName?: string;
  headerTooltip?: string;
  cellDataType?: CellDataType;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  flex?: number;
  hide?: boolean;
  pinned?: "left" | "right";
  sort?: "asc" | "desc";
  sortable?: boolean;
  filter?: (typeof FILTERS)[number];
  floatingFilter?: boolean;
  resizable?: boolean;
  wrapText?: boolean;
  autoHeight?: boolean;
  wrapHeaderText?: boolean;
  /** AG Grid's grouping names; this plugin does the grouping, AG Grid Community has none. */
  enableRowGroup?: boolean;
  rowGroup?: boolean;
  rowGroupIndex?: number;
  aggFunc?: AggFunc;
  /** AG Grid's pivot names; this plugin pivots, AG Grid Community does not. */
  enablePivot?: boolean;
  pivot?: boolean;
  pivotIndex?: number;
  valueFormat?: ValueFormat;
}

export interface ColumnGroupSpec {
  headerName: string;
  children: ColumnSpec[];
  marryChildren?: boolean;
}

export type ColumnDefSpec = ColumnSpec | ColumnGroupSpec;

export interface DefaultColumnSpec {
  sortable?: boolean;
  filter?: (typeof FILTERS)[number];
  floatingFilter?: boolean;
  resizable?: boolean;
  flex?: number;
  minWidth?: number;
  wrapHeaderText?: boolean;
}

export interface GridOptionsSpec {
  pagination?: boolean;
  paginationPageSize?: number;
  paginationAutoPageSize?: boolean;
  rowHeight?: number;
  headerHeight?: number;
  animateRows?: boolean;
  enableCellTextSelection?: boolean;
  suppressMovableColumns?: boolean;
  suppressFieldDotNotation?: boolean;
  defaultColDef?: DefaultColumnSpec;
  autoGroupColumnDef?: { headerName?: string; field?: string; minWidth?: number };
  /** Start as a pivot table: rows by the rowGroup columns, columns by the pivot columns. */
  pivotMode?: boolean;
}

export interface GridSpec {
  rowData: Row[];
  columnDefs: ColumnDefSpec[];
  gridOptions: GridOptionsSpec;
  /** Whether the columns were inferred from the rows, rather than declared. */
  inferred: boolean;
}

export type Parsed = { ok: true; spec: GridSpec; warnings: string[] } | { ok: false; message: string };

// ---------------------------------------------------------------- reading values

type Check = (value: unknown) => boolean;

const isBoolean: Check = (value) => typeof value === "boolean";
const text =
  (max: number): Check =>
  (value) =>
    typeof value === "string" && value.length > 0 && value.length <= max;
const integer =
  (min: number, max: number): Check =>
  (value) =>
    Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const number =
  (min: number, max: number): Check =>
  (value) =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const oneOf =
  (values: readonly unknown[]): Check =>
  (value) =>
    values.includes(value);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Keeps the keys `checks` knows whose value passes, and says what it dropped. */
function pick<T>(
  value: unknown,
  checks: Record<string, Check>,
  where: string,
  warnings: string[],
): Partial<T> {
  const out: Record<string, unknown> = {};
  if (!isObject(value)) return out as Partial<T>;
  for (const [key, item] of Object.entries(value)) {
    const check = checks[key];
    if (!check) warnings.push(`${where}: ${key} is not supported`);
    else if (!check(item)) warnings.push(`${where}: ${key} has a value that is not supported`);
    else out[key] = item;
  }
  return out as Partial<T>;
}

const VALUE_FORMAT: Record<string, Check> = {
  style: oneOf(["decimal", "percent", "currency", "date"]),
  currency: (value) => typeof value === "string" && /^[A-Z]{3}$/.test(value),
  decimals: integer(0, 10),
  notation: oneOf(["standard", "compact"]),
  dateStyle: oneOf(["short", "medium", "long"]),
};

const FILTER = oneOf(FILTERS);
const SIZE = integer(20, 2000);

export const COLUMN_KEYS: Record<string, Check> = {
  field: text(128),
  headerName: text(128),
  headerTooltip: text(256),
  cellDataType: oneOf(CELL_DATA_TYPES),
  width: SIZE,
  minWidth: SIZE,
  maxWidth: SIZE,
  flex: number(0, 20),
  hide: isBoolean,
  pinned: oneOf(["left", "right"]),
  sort: oneOf(["asc", "desc"]),
  sortable: isBoolean,
  filter: FILTER,
  floatingFilter: isBoolean,
  resizable: isBoolean,
  wrapText: isBoolean,
  autoHeight: isBoolean,
  wrapHeaderText: isBoolean,
  enableRowGroup: isBoolean,
  rowGroup: isBoolean,
  rowGroupIndex: integer(0, 15),
  aggFunc: oneOf(AGG_FUNCS),
  enablePivot: isBoolean,
  pivot: isBoolean,
  pivotIndex: integer(0, 15),
  valueFormat: isObject,
};

export const COLUMN_GROUP_KEYS = ["headerName", "children", "marryChildren"] as const;

export const DEFAULT_COLUMN_KEYS: Record<string, Check> = {
  sortable: isBoolean,
  filter: FILTER,
  floatingFilter: isBoolean,
  resizable: isBoolean,
  flex: number(0, 20),
  minWidth: SIZE,
  wrapHeaderText: isBoolean,
};

const AUTO_GROUP_KEYS: Record<string, Check> = {
  headerName: text(128),
  field: text(128),
  minWidth: SIZE,
};

export const GRID_OPTION_KEYS: Record<string, Check> = {
  pagination: isBoolean,
  paginationPageSize: integer(1, 1000),
  paginationAutoPageSize: isBoolean,
  rowHeight: integer(16, 200),
  headerHeight: integer(16, 200),
  animateRows: isBoolean,
  enableCellTextSelection: isBoolean,
  suppressMovableColumns: isBoolean,
  suppressFieldDotNotation: isBoolean,
  defaultColDef: isObject,
  autoGroupColumnDef: isObject,
  pivotMode: isBoolean,
};

/** At most this many columns, counting the children of groups. */
const MAX_COLUMNS = 200;

function readColumn(value: unknown, where: string, warnings: string[]): ColumnSpec | null {
  const column = pick<ColumnSpec>(value, COLUMN_KEYS, where, warnings);
  if (!column.field) {
    warnings.push(`${where}: a column needs a field`);
    return null;
  }
  if (column.valueFormat) {
    const format = pick<ValueFormat>(column.valueFormat, VALUE_FORMAT, `${where}.valueFormat`, warnings);
    if (format.style) column.valueFormat = format as ValueFormat;
    else delete column.valueFormat;
  }
  return column as ColumnSpec;
}

function readColumnDefs(value: unknown, where: string, warnings: string[]): ColumnDefSpec[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    warnings.push(`${where}: columnDefs must be a list`);
    return undefined;
  }
  const out: ColumnDefSpec[] = [];
  let count = 0;
  value.forEach((item, index) => {
    const here = `${where}[${index}]`;
    if (count >= MAX_COLUMNS) return;
    if (isObject(item) && Array.isArray(item.children)) {
      const extra = Object.keys(item).filter((key) => !(COLUMN_GROUP_KEYS as readonly string[]).includes(key));
      for (const key of extra) warnings.push(`${here}: ${key} is not supported on a column group`);
      const children = item.children
        .map((child, i) => readColumn(child, `${here}.children[${i}]`, warnings))
        .filter((child): child is ColumnSpec => child !== null)
        .slice(0, MAX_COLUMNS - count);
      count += children.length;
      if (!text(128)(item.headerName)) warnings.push(`${here}: a column group needs a headerName`);
      else if (children.length)
        out.push({
          headerName: item.headerName as string,
          children,
          ...(isBoolean(item.marryChildren) ? { marryChildren: item.marryChildren as boolean } : {}),
        });
      return;
    }
    const column = readColumn(item, here, warnings);
    if (column) {
      out.push(column);
      count += 1;
    }
  });
  return out;
}

function readGridOptions(value: unknown, where: string, warnings: string[]): GridOptionsSpec {
  const options = pick<GridOptionsSpec>(value, GRID_OPTION_KEYS, where, warnings);
  if (options.defaultColDef)
    options.defaultColDef = pick(options.defaultColDef, DEFAULT_COLUMN_KEYS, `${where}.defaultColDef`, warnings);
  if (options.autoGroupColumnDef)
    options.autoGroupColumnDef = pick(
      options.autoGroupColumnDef,
      AUTO_GROUP_KEYS,
      `${where}.autoGroupColumnDef`,
      warnings,
    );
  return options;
}

// ---------------------------------------------------------------- columns from rows

/** Rows read to infer the columns and their types. */
const SAMPLE = 1000;
const DATE_STRING = /^\d{4}-\d{2}-\d{2}$/;

export function typeOf(values: readonly unknown[]): CellDataType {
  const present = values.filter((value) => value !== null && value !== undefined && value !== "");
  if (!present.length) return "text";
  if (present.every((value) => typeof value === "number" && Number.isFinite(value))) return "number";
  if (present.every((value) => typeof value === "boolean")) return "boolean";
  if (present.every((value) => typeof value === "string" && DATE_STRING.test(value))) return "dateString";
  if (present.every((value) => typeof value === "string")) return "text";
  if (present.every((value) => typeof value === "object")) return "object";
  return "text";
}

/** Every key of the first rows, in the order first seen, with the type of its values. */
export function inferColumns(rows: readonly Row[]): ColumnSpec[] {
  const sample = rows.slice(0, SAMPLE);
  const fields = [...new Set(sample.flatMap((row) => Object.keys(row)))].slice(0, MAX_COLUMNS);
  return fields.map((field) => ({ field, cellDataType: typeOf(sample.map((row) => row[field])) }));
}

/** The leaf columns, groups flattened. */
export function leafColumns(columnDefs: readonly ColumnDefSpec[]): ColumnSpec[] {
  return columnDefs.flatMap((column) => ("children" in column ? column.children : [column]));
}

// ---------------------------------------------------------------- the spec

const isRows = (value: unknown): value is Row[] => Array.isArray(value) && value.every(isObject);

/**
 * The grid of a response and a definition. The response's columns win over the
 * definition's, its grid options are laid over the definition's, and columns that neither
 * declares are inferred from the rows. A column without a `cellDataType` gets the type of
 * its values, so filters, sorting and grouping know what they hold.
 */
export function readSpec(response: unknown, definition: unknown): Parsed {
  const warnings: string[] = [];
  let rowData: Row[];
  let responseColumns: ColumnDefSpec[] | undefined;
  let responseOptions: GridOptionsSpec = {};

  if (isRows(response)) {
    rowData = response;
  } else if (isObject(response) && isRows(response.rowData)) {
    rowData = response.rowData;
    const extra = Object.keys(response).filter((key) => !["rowData", "columnDefs", "gridOptions"].includes(key));
    for (const key of extra) warnings.push(`response: ${key} is not supported`);
    responseColumns = readColumnDefs(response.columnDefs, "response.columnDefs", warnings);
    responseOptions = readGridOptions(response.gridOptions, "response.gridOptions", warnings);
  } else {
    return {
      ok: false,
      message: 'The endpoint returned neither rows (a list of objects) nor a grid ({ "rowData": [...] }).',
    };
  }

  const declared = isObject(definition) ? definition : {};
  const definitionColumns = readColumnDefs(declared.columnDefs, "definition.columnDefs", warnings);
  const definitionOptions = readGridOptions(declared.gridOptions, "definition.gridOptions", warnings);

  const columns = responseColumns?.length ? responseColumns : definitionColumns?.length ? definitionColumns : null;
  const sample = rowData.slice(0, SAMPLE);
  const columnDefs: ColumnDefSpec[] = columns
    ? columns.map((column) => {
        const typed = (leaf: ColumnSpec): ColumnSpec =>
          leaf.cellDataType ? leaf : { ...leaf, cellDataType: typeOf(sample.map((row) => row[leaf.field])) };
        return "children" in column ? { ...column, children: column.children.map(typed) } : typed(column);
      })
    : inferColumns(rowData);

  const gridOptions: GridOptionsSpec = { ...definitionOptions, ...responseOptions };
  if (definitionOptions.defaultColDef || responseOptions.defaultColDef)
    gridOptions.defaultColDef = { ...definitionOptions.defaultColDef, ...responseOptions.defaultColDef };

  return { ok: true, spec: { rowData, columnDefs, gridOptions, inferred: columns === null }, warnings };
}

// ---------------------------------------------------------------- grouping

export interface Grouping {
  /** The columns the user may group by. */
  groupable: ColumnSpec[];
  /** The columns that get an aggregate on group rows, with the function each declares. */
  measures: { field: string; aggFunc: AggFunc }[];
  /** The grouping the grid starts with: `rowGroup` columns, by `rowGroupIndex`. */
  initial: string[];
  /** The columns the user may pivot by. */
  pivotable: ColumnSpec[];
  /** The pivot the grid starts with: `pivot` columns, by `pivotIndex`. */
  initialPivot: string[];
}

/**
 * What the grouping can use. Declared columns are grouped when they say `enableRowGroup`
 * and aggregated when they name an `aggFunc`, as AG Grid's own grouping reads them.
 * Inferred columns: any column of text, booleans or dates groups, and numbers are summed.
 * Pivoting reads `enablePivot` and `pivot` the same way, and inferred columns pivot as they group.
 */
export function groupingOf(spec: GridSpec): Grouping {
  const leaves = leafColumns(spec.columnDefs);
  const groupable = spec.inferred
    ? leaves.filter((column) => ["text", "boolean", "dateString", "date"].includes(column.cellDataType ?? ""))
    : leaves.filter((column) => column.enableRowGroup || column.rowGroup);
  const measures = spec.inferred
    ? leaves
        .filter((column) => column.cellDataType === "number")
        .map((column) => ({ field: column.field, aggFunc: "sum" as AggFunc }))
    : leaves.flatMap((column) => (column.aggFunc ? [{ field: column.field, aggFunc: column.aggFunc }] : []));
  const ordered = (chosen: (column: ColumnSpec) => boolean, order: (column: ColumnSpec) => number | undefined) =>
    leaves
      .map((column, index) => ({ column, order: order(column) ?? MAX_COLUMNS + index }))
      .filter(({ column }) => chosen(column))
      .sort((a, b) => a.order - b.order)
      .map(({ column }) => column.field);
  const initial = ordered((column) => !!column.rowGroup, (column) => column.rowGroupIndex);
  const pivotable = spec.inferred ? groupable : leaves.filter((column) => column.enablePivot || column.pivot);
  const initialPivot = ordered((column) => !!column.pivot, (column) => column.pivotIndex);
  return { groupable, measures, initial, pivotable, initialPivot };
}

/** The header a column shows: its `headerName`, else its field in words, as AG Grid writes it. */
export function headerOf(column: Pick<ColumnSpec, "field" | "headerName">): string {
  if (column.headerName) return column.headerName;
  return column.field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}
