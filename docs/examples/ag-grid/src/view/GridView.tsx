import {
  type ColDef,
  type ColGroupDef,
  colorSchemeDark,
  colorSchemeLight,
  type GetRowIdParams,
  type GridApi,
  type GridState,
  type RowClassParams,
  themeQuartz,
  type ValueFormatterParams,
  type ValueGetterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { buildGroupTree, collectGroupKeys, type DisplayRow, flattenTree } from "../grouping";
import {
  type ColumnDefSpec,
  type ColumnSpec,
  type GridOptionsSpec,
  groupingOf,
  headerOf,
  leafColumns,
  type Parsed,
  type Row,
} from "../spec";
import {
  formatterOf,
  GRID_STATE_KEYS,
  measuresOf,
  quickMatch,
  type SavedState,
  type ViewState,
} from "../view-state";
import { GroupCell, type GroupCellContext } from "./GroupCell";
import { StatusMessage } from "./StatusMessage";
import { Toolbar } from "./Toolbar";

/** The host's `theme` trait. */
export interface ThemeTrait {
  mode?: "dark" | "light";
  tokens?: Record<string, string>;
  locale?: string;
  decimals?: number;
}

const SEARCH_DEBOUNCE_MS = 300;

const isColor = (value: string | undefined): value is string =>
  !!value && (typeof CSS === "undefined" || CSS.supports("color", value));

/** AG Grid's Quartz theme in the site's mode, with the site's colors and font where it has them. */
function gridTheme(theme: ThemeTrait | null) {
  const tokens = theme?.tokens ?? {};
  const params: Record<string, string> = {};
  if (isColor(tokens.card)) params.backgroundColor = tokens.card;
  if (isColor(tokens["card-foreground"] ?? tokens.foreground))
    params.foregroundColor = tokens["card-foreground"] ?? tokens.foreground;
  if (isColor(tokens.border)) params.borderColor = tokens.border;
  if (isColor(tokens["brand-main"])) params.accentColor = tokens["brand-main"];
  if (tokens["font-family"]) params.fontFamily = tokens["font-family"];
  return themeQuartz.withPart(theme?.mode === "light" ? colorSchemeLight : colorSchemeDark).withParams(params);
}

/** The wrapper's colors, from the same tokens. */
function wrapperStyle(theme: ThemeTrait | null): CSSProperties {
  const tokens = theme?.tokens ?? {};
  const style: Record<string, string> = {};
  if (isColor(tokens.card)) style["--agw-bg"] = tokens.card;
  if (isColor(tokens["card-foreground"] ?? tokens.foreground))
    style["--agw-text"] = tokens["card-foreground"] ?? tokens.foreground;
  if (isColor(tokens.border)) style["--agw-border"] = tokens.border;
  if (isColor(tokens["brand-main"])) style["--agw-accent"] = tokens["brand-main"];
  if (tokens["font-family"]) style.fontFamily = tokens["font-family"];
  return style as CSSProperties;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** How numbers show: the user's locale, and the site's decimals for those that have them. */
interface Formats {
  locale: string;
  decimals: number;
}

/** The formatter a column's type and `valueFormat` call for, if any. */
function formatterFor(column: ColumnSpec, { locale, decimals }: Formats) {
  if (column.valueFormat) {
    const format = formatterOf(column.valueFormat, locale);
    return (params: ValueFormatterParams) => format(params.value);
  }
  if (column.cellDataType === "number") {
    // An integer shows as it is (a year, an id); a fraction, an average say, is rounded
    const rounded = new Intl.NumberFormat(locale, { maximumFractionDigits: decimals, useGrouping: false });
    return (params: ValueFormatterParams) =>
      typeof params.value === "number" && !Number.isInteger(params.value)
        ? rounded.format(params.value)
        : params.value === null || params.value === undefined
          ? ""
          : String(params.value);
  }
  if (column.cellDataType === "object")
    return (params: ValueFormatterParams) =>
      params.value === null || params.value === undefined ? "" : JSON.stringify(params.value);
  return undefined;
}

/** Keys this plugin reads itself: AG Grid Community has no grouping, and no `valueFormat`. */
const PLUGIN_KEYS = new Set(["enableRowGroup", "rowGroup", "rowGroupIndex", "aggFunc", "valueFormat"]);

/** The AG Grid column of a declared one: AG Grid's own keys, and a formatter for `valueFormat`. */
function flatColumn(column: ColumnSpec, formats: Formats): ColDef<Row> {
  const own = Object.fromEntries(Object.entries(column).filter(([key]) => !PLUGIN_KEYS.has(key))) as ColDef<Row>;
  const valueFormatter = formatterFor(column, formats);
  return {
    ...own,
    colId: column.field,
    headerName: headerOf(column),
    ...(column.cellDataType === "number" ? { type: "rightAligned" } : {}),
    ...(valueFormatter ? { valueFormatter } : {}),
  };
}

function flatColumns(columnDefs: readonly ColumnDefSpec[], formats: Formats): (ColDef<Row> | ColGroupDef<Row>)[] {
  return columnDefs.map((column) =>
    "children" in column
      ? {
          headerName: column.headerName,
          marryChildren: column.marryChildren,
          children: column.children.map((child) => flatColumn(child, formats)),
        }
      : flatColumn(column, formats),
  );
}

/** A column of the grouped grid: the leaf's value, or the group's aggregate for a measure. */
function groupedColumn(column: ColumnSpec, measured: boolean, formats: Formats): ColDef<DisplayRow> {
  const base = flatColumn(column, formats);
  return {
    colId: column.field,
    headerName: base.headerName,
    headerTooltip: base.headerTooltip,
    width: base.width,
    minWidth: base.minWidth,
    maxWidth: base.maxWidth,
    flex: base.flex,
    hide: base.hide,
    pinned: base.pinned,
    wrapText: base.wrapText,
    autoHeight: base.autoHeight,
    wrapHeaderText: base.wrapHeaderText,
    cellDataType: column.cellDataType === "number" ? "number" : false,
    type: column.cellDataType === "number" ? "rightAligned" : undefined,
    valueGetter: (params: ValueGetterParams<DisplayRow>) => {
      const row = params.data;
      if (!row) return null;
      if (row.kind === "leaf") return row.row[column.field];
      return measured ? row.aggregates[column.field] : null;
    },
    valueFormatter: base.valueFormatter as ColDef<DisplayRow>["valueFormatter"],
  };
}

const pageSizes = (options: GridOptionsSpec) =>
  [...new Set([options.paginationPageSize ?? 100, 20, 50, 100])].sort((a, b) => a - b);

interface GridViewProps {
  /** The host's data, read; null until the host has pushed any. */
  data: Parsed | null;
  theme: ThemeTrait | null;
  /** The state saved with the dashboard, read once when the widget starts. */
  saved: SavedState;
  /** Told whenever the user changes the grouping, the function or the search. */
  onViewChange: (view: ViewState) => void;
  /** Told AG Grid's state of the ungrouped grid when it changes: columns, sort, filters. */
  onGridState: (state: Record<string, unknown>) => void;
  /** The grid's API while a grid is shown, for the exports. */
  onApi: (api: GridApi | null) => void;
}

export function GridView({ data, theme, saved, onViewChange, onGridState, onApi }: GridViewProps) {
  const locale = theme?.locale || "en-US";
  const decimals = theme?.decimals ?? 2;
  const formats = useMemo<Formats>(() => ({ locale, decimals }), [locale, decimals]);
  const spec = data?.ok ? data.spec : null;
  const grouping = useMemo(() => (spec ? groupingOf(spec) : null), [spec]);
  const leaves = useMemo(() => (spec ? leafColumns(spec.columnDefs) : []), [spec]);

  const [groupBy, setGroupBy] = useState<string[]>(saved.groupBy ?? []);
  const [aggFunc, setAggFunc] = useState(saved.aggFunc ?? null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState(saved.search ?? "");
  const [shown, setShown] = useState<number | null>(null);
  const [gridState, setGridState] = useState<GridState | undefined>(saved.grid as GridState | undefined);
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  // A new response may not have the columns the grouping names: keep the ones it has. With
  // nothing saved, the grid starts with the columns marked rowGroup.
  const [started, setStarted] = useState(saved.groupBy !== undefined);
  useEffect(() => {
    if (!grouping) return;
    const known = new Set(grouping.groupable.map((column) => column.field));
    if (!started) {
      setStarted(true);
      setGroupBy(grouping.initial.filter((field) => known.has(field)));
    } else setGroupBy((current) => current.filter((field) => known.has(field)));
  }, [grouping, started]);

  const declared = !!spec && !spec.inferred;
  useEffect(() => {
    if (!declared && aggFunc === null && grouping?.measures.length) setAggFunc("sum");
  }, [declared, aggFunc, grouping]);

  useEffect(() => {
    onViewChange({ groupBy, aggFunc, search: debouncedSearch });
  }, [onViewChange, groupBy, aggFunc, debouncedSearch]);

  const grouped = groupBy.length > 0;
  const fields = useMemo(() => leaves.map((column) => column.field), [leaves]);
  const measures = useMemo(() => measuresOf(grouping?.measures ?? [], aggFunc), [grouping, aggFunc]);

  // Grouped, the grid holds the tree, so the search runs here over the rows; ungrouped, it is
  // AG Grid's quick filter
  const matching = useMemo(
    () => (spec && grouped ? quickMatch(spec.rowData, fields, debouncedSearch) : null),
    [spec, grouped, fields, debouncedSearch],
  );
  const tree = useMemo(
    () => (matching ? buildGroupTree(matching, groupBy, measures) : []),
    [matching, groupBy, measures],
  );
  const displayRows = useMemo(() => flattenTree(tree, expanded), [tree, expanded]);
  const groupCount = useMemo(() => collectGroupKeys(tree).length, [tree]);

  const toggle = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const options = spec?.gridOptions ?? {};
  const labelField = useMemo(() => {
    const declaredLabel = options.autoGroupColumnDef?.field;
    if (declaredLabel && fields.includes(declaredLabel)) return declaredLabel;
    return leaves.find((c) => !c.hide && (c.cellDataType ?? "text") === "text" && !groupBy.includes(c.field))?.field ?? null;
  }, [options, fields, leaves, groupBy]);

  const headers = useMemo(() => new Map(leaves.map((column) => [column.field, headerOf(column)])), [leaves]);
  const groupContext = useMemo<GroupCellContext>(
    () => ({
      toggle,
      isExpanded: (key) => expanded.has(key),
      headerOf: (field) => headers.get(field) ?? field,
      labelField,
    }),
    [toggle, expanded, headers, labelField],
  );

  const theming = useMemo(() => gridTheme(theme), [theme]);

  const flatDefs = useMemo(() => (spec ? flatColumns(spec.columnDefs, formats) : []), [spec, formats]);
  const flatDefault = useMemo<ColDef<Row>>(
    () => ({ sortable: true, filter: true, resizable: true, flex: 1, minWidth: 100, ...options.defaultColDef }),
    [options],
  );

  const groupedDefs = useMemo<ColDef<DisplayRow>[]>(() => {
    const measured = new Set(measures.map((measure) => measure.field));
    const auto = options.autoGroupColumnDef;
    return [
      {
        colId: "ag-grid-group",
        headerName: auto?.headerName ?? (labelField ? `Group / ${headers.get(labelField)}` : "Group"),
        minWidth: auto?.minWidth ?? 280,
        flex: 2,
        cellRenderer: GroupCell,
        valueGetter: (params: ValueGetterParams<DisplayRow>) => {
          const row = params.data;
          if (!row) return "";
          if (row.kind === "leaf") return labelField ? row.row[labelField] : "";
          return `${headers.get(row.field) ?? row.field}: ${row.value} (${row.count})`;
        },
      },
      ...leaves
        .filter((column) => !groupBy.includes(column.field) && column.field !== labelField)
        .map((column) => groupedColumn(column, measured.has(column.field), formats)),
    ];
  }, [measures, options, labelField, headers, leaves, groupBy, formats]);

  const getRowId = useCallback((params: GetRowIdParams<DisplayRow>) => params.data.key, []);
  const getRowClass = useCallback(
    (params: RowClassParams<DisplayRow>) =>
      params.data?.kind === "group" ? `agw-row-group agw-row-level-${params.data.level}` : undefined,
    [],
  );

  const handleGroupByChange = useCallback((next: string[]) => {
    setGroupBy(next);
    setExpanded(new Set());
  }, []);

  const onStateUpdated = useCallback(
    ({ state }: { state: GridState }) => {
      const kept = Object.fromEntries(
        GRID_STATE_KEYS.filter((key) => state[key] !== undefined).map((key) => [key, state[key]]),
      );
      setGridState(kept as GridState);
      onGridState(kept);
    },
    [onGridState],
  );

  useEffect(() => () => onApi(null), [onApi]);

  const grid = {
    theme: theming,
    animateRows: options.animateRows,
    rowHeight: options.rowHeight,
    headerHeight: options.headerHeight,
    enableCellTextSelection: options.enableCellTextSelection,
    suppressMovableColumns: options.suppressMovableColumns,
    suppressFieldDotNotation: options.suppressFieldDotNotation ?? true,
  };

  let body: ReactNode;
  if (data === null) {
    body = <StatusMessage tone="neutral" title="Loading data…" />;
  } else if (!data.ok) {
    body = (
      <StatusMessage tone="error" title="Could not show the data">
        {data.message}
      </StatusMessage>
    );
  } else if (!data.spec.rowData.length) {
    body = (
      <StatusMessage tone="neutral" title="No rows">
        The endpoint returned no rows.
      </StatusMessage>
    );
  } else if (grouped && !matching?.length) {
    body = (
      <StatusMessage tone="neutral" title="No rows match the search">
        Try a different search.
      </StatusMessage>
    );
  } else if (grouped) {
    body = (
      <div className="agw-grid">
        <AgGridReact<DisplayRow>
          key="grouped"
          {...grid}
          rowData={displayRows}
          columnDefs={groupedDefs}
          // Sorting or filtering the flattened tree would break it: grouped, the grid only shows it
          defaultColDef={{ sortable: false, filter: false, resizable: true, flex: 1, minWidth: 100 }}
          context={groupContext}
          getRowId={getRowId}
          getRowClass={getRowClass}
          onGridReady={(event) => onApi(event.api as unknown as GridApi)}
          suppressCellFocus
        />
      </div>
    );
  } else {
    body = (
      <div className="agw-grid">
        <AgGridReact<Row>
          key="flat"
          {...grid}
          rowData={data.spec.rowData}
          columnDefs={flatDefs}
          defaultColDef={flatDefault}
          quickFilterText={debouncedSearch}
          pagination={options.pagination}
          paginationPageSize={options.paginationPageSize ?? 100}
          paginationAutoPageSize={options.paginationAutoPageSize}
          paginationPageSizeSelector={pageSizes(options)}
          initialState={gridState}
          onStateUpdated={onStateUpdated}
          onGridReady={(event) => onApi(event.api as unknown as GridApi)}
          onModelUpdated={(event) => setShown(event.api.getDisplayedRowCount())}
        />
      </div>
    );
  }

  const total = spec?.rowData.length ?? 0;
  const format = (value: number) => value.toLocaleString(locale);
  const meta = !spec
    ? null
    : grouped
      ? `${format(matching?.length ?? 0)} of ${format(total)} rows in ${format(groupCount)} groups`
      : shown !== null && shown !== total
        ? `${format(shown)} of ${format(total)} rows`
        : `${format(total)} rows`;

  return (
    <section
      className={`agw agw--${theme?.mode === "light" ? "light" : "dark"}`}
      style={wrapperStyle(theme)}
      aria-label="AG Grid"
    >
      {spec && (
        <header className="agw-header">
          <p className="agw-header__meta" aria-live="polite">
            {meta}
          </p>
          {data?.ok && data.warnings.length > 0 && (
            <details className="agw-warnings">
              <summary>
                {data.warnings.length} {data.warnings.length === 1 ? "option" : "options"} not applied
              </summary>
              <ul>
                {data.warnings.slice(0, 50).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
        </header>
      )}
      {spec && (
        <Toolbar
          groupable={(grouping?.groupable ?? []).map((column) => ({ field: column.field, header: headerOf(column) }))}
          groupBy={groupBy}
          onGroupByChange={handleGroupByChange}
          hasMeasures={(grouping?.measures.length ?? 0) > 0}
          declared={declared}
          aggFunc={aggFunc}
          onAggFuncChange={setAggFunc}
          search={search}
          onSearchChange={setSearch}
          onExpandAll={() => setExpanded(new Set(collectGroupKeys(tree)))}
          onCollapseAll={() => setExpanded(new Set())}
        />
      )}
      {body}
    </section>
  );
}
