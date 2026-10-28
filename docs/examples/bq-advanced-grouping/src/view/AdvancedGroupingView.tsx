import {
  type ColDef,
  colorSchemeDark,
  colorSchemeLight,
  type GetRowIdParams,
  type RowClassParams,
  themeQuartz,
  type ValueFormatterParams,
  type ValueGetterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  buildGroupTree,
  collectGroupKeys,
  type DisplayRow,
  flattenTree,
} from "../grouping";
import { type Parsed, searchRows, type ViewState } from "../rows";
import {
  type AdvancedGroupingConfig,
  type Aggregation,
  type CompanyRow,
  FIELD_LABELS,
  type GroupField,
  MEASURES,
  type Measure,
} from "../types";
import { GroupCell, type GroupCellContext } from "./GroupCell";
import { GroupingToolbar } from "./GroupingToolbar";
import { StatusMessage } from "./StatusMessage";

export type ColorScheme = "light" | "dark";

const SEARCH_DEBOUNCE_MS = 300;

const THEMES: Record<ColorScheme, ReturnType<typeof themeQuartz.withPart>> = {
  light: themeQuartz.withPart(colorSchemeLight),
  dark: themeQuartz.withPart(colorSchemeDark),
};

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Text columns show the leaf value; group rows leave them blank. */
function leafColumn(field: keyof CompanyRow & string): ColDef<DisplayRow> {
  return {
    colId: field,
    headerName: FIELD_LABELS[field as keyof typeof FIELD_LABELS] ?? field,
    valueGetter: (params: ValueGetterParams<DisplayRow>) =>
      params.data?.kind === "leaf" ? params.data.row[field] : null,
  };
}

/** Measure columns show the leaf value, or the aggregate on group rows. */
function measureColumn(measure: Measure): ColDef<DisplayRow> {
  return {
    colId: measure,
    headerName: FIELD_LABELS[measure],
    type: "rightAligned",
    valueGetter: (params: ValueGetterParams<DisplayRow>) => {
      const row = params.data;
      if (!row) return null;
      return row.kind === "leaf" ? row.row[measure] : row.aggregates[measure];
    },
    valueFormatter: (params: ValueFormatterParams<DisplayRow, number | null>) =>
      params.value === null || params.value === undefined
        ? ""
        : numberFormat.format(params.value),
  };
}

interface AdvancedGroupingViewProps {
  config: AdvancedGroupingConfig;
  /** The host's data, parsed; null until the host has pushed any. */
  data: Parsed | null;
  colorScheme: ColorScheme;
  /** Told whenever the user changes the grouping, the aggregation or the search. */
  onViewChange: (view: ViewState) => void;
}

export function AdvancedGroupingView({
  config,
  data,
  colorScheme,
  onViewChange,
}: AdvancedGroupingViewProps) {
  const { features } = config;
  const [groupBy, setGroupBy] = useState<GroupField[]>(
    features.grouping ? config.defaults.groupBy : [],
  );
  const [aggregation, setAggregation] = useState<Aggregation>(
    config.defaults.aggregation,
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    onViewChange({ groupBy, aggregation, search: debouncedSearch });
  }, [onViewChange, groupBy, aggregation, debouncedSearch]);

  // The search runs here: the frame has no network to ask the endpoint again
  const rows = useMemo(
    () => (data?.ok ? searchRows(data.rows, debouncedSearch) : null),
    [data, debouncedSearch],
  );

  const tree = useMemo(
    () => (rows ? buildGroupTree(rows, groupBy, MEASURES, aggregation) : []),
    [rows, groupBy, aggregation],
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

  const gridContext = useMemo<GroupCellContext>(
    () => ({ toggle, isExpanded: (key) => expanded.has(key) }),
    [toggle, expanded],
  );

  const grouped = groupBy.length > 0;
  const columnDefs = useMemo<ColDef<DisplayRow>[]>(() => {
    const groupColumn: ColDef<DisplayRow> = {
      colId: "group",
      headerName: grouped ? "Group" : FIELD_LABELS.company,
      minWidth: 280,
      flex: 2,
      cellRenderer: GroupCell,
      valueGetter: (params: ValueGetterParams<DisplayRow>) => {
        const row = params.data;
        if (!row) return "";
        return row.kind === "leaf"
          ? row.row.company
          : `${FIELD_LABELS[row.field]}: ${row.value} (${row.count})`;
      },
    };
    return [
      groupColumn,
      ...(["sector", "industry", "state", "size"] as const)
        .filter((field) => !groupBy.includes(field))
        .map(leafColumn),
      ...MEASURES.map(measureColumn),
      leafColumn("foundedYear"),
    ];
  }, [grouped, groupBy]);

  const defaultColDef = useMemo<ColDef<DisplayRow>>(
    // Sorting a grouped, flattened list would break the hierarchy, so headers
    // only sort when no grouping is applied.
    () => ({ flex: 1, minWidth: 110, resizable: true, sortable: !grouped }),
    [grouped],
  );

  const getRowId = useCallback(
    (params: GetRowIdParams<DisplayRow>) => params.data.key,
    [],
  );
  const getRowClass = useCallback(
    (params: RowClassParams<DisplayRow>) =>
      params.data?.kind === "group"
        ? `bqag-row-group bqag-row-level-${params.data.level}`
        : undefined,
    [],
  );

  const handleGroupByChange = useCallback((next: GroupField[]) => {
    setGroupBy(next);
    setExpanded(new Set());
  }, []);

  let body: ReactNode;
  if (data === null) {
    body = <StatusMessage tone="neutral" title="Loading data…" />;
  } else if (!data.ok) {
    body = (
      <StatusMessage tone="error" title="Could not show the data">
        {data.message}
      </StatusMessage>
    );
  } else if (!rows?.length) {
    body = (
      <StatusMessage tone="neutral" title="No companies found">
        {debouncedSearch ? "Try a different search." : "The endpoint returned no rows."}
      </StatusMessage>
    );
  } else {
    body = (
      <div className="bqag-grid">
        <AgGridReact<DisplayRow>
          theme={THEMES[colorScheme]}
          rowData={displayRows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          context={gridContext}
          getRowId={getRowId}
          getRowClass={getRowClass}
          suppressCellFocus
        />
      </div>
    );
  }

  return (
    <section className={`bqag bqag--${colorScheme}`} aria-label={config.name}>
      {rows && (
        <header className="bqag-header">
          <p className="bqag-header__meta" aria-live="polite">
            {numberFormat.format(rows.length)} companies
            {grouped ? ` in ${numberFormat.format(groupCount)} groups` : ""}
          </p>
        </header>
      )}
      <GroupingToolbar
        features={features}
        groupBy={groupBy}
        onGroupByChange={handleGroupByChange}
        aggregation={aggregation}
        onAggregationChange={setAggregation}
        search={search}
        onSearchChange={setSearch}
        onExpandAll={() => setExpanded(new Set(collectGroupKeys(tree)))}
        onCollapseAll={() => setExpanded(new Set())}
        onExport={() => {}}
        exportDisabled
      />
      {body}
    </section>
  );
}
