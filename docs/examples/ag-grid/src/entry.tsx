/*
 * AG Grid for Workspace: an Anywidget front-end module (AFM 0.11) that renders the `ag-grid`
 * widget type, any backend's rows, with AG Grid Community.
 *
 * The widget's endpoint returns rows, a list of objects, or a grid in AG Grid's own names,
 * `{ "rowData": [...], "columnDefs": [...], "gridOptions": {...} }`. Workspace fetches it
 * with the user's credentials and pushes the response into the `data` trait; the backend's
 * `data["ag-grid"]` in its `widgets.json` arrives as the `definition` trait. The grid sorts,
 * filters, searches, pins, resizes, moves and pages as AG Grid does, and keeps the user's
 * choices with the dashboard in the `state` trait. Row grouping and the pivot table, which
 * are AG Grid Enterprise's, are this plugin's own, read from AG Grid's column keys
 * (`enableRowGroup`, `rowGroup`, `aggFunc`, `enablePivot`, `pivot`) and `pivotMode`. Workspace's Export menu and its Copilot get the table through the
 * exports `initialize` returns.
 *
 * The build bundles React and AG Grid into this one module, because a plugin frame
 * receives one module and its styles, nothing else.
 */
import { AllCommunityModule, type GridApi, ModuleRegistry } from "ag-grid-community";
import { StrictMode, useCallback, useMemo, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { groupingOf, leafColumns, type Parsed, type Row, readSpec } from "./spec";
import { quickMatch, rowsCsv, type SavedState, stateOf, summary, type ViewState } from "./view-state";
import { GridView, type ThemeTrait } from "./view/GridView";
import "./view/styles.css";

// Community modules only. This plugin must never depend on ag-grid-enterprise.
ModuleRegistry.registerModules([AllCommunityModule]);

/** The part of the AFM model this module uses. */
interface Model {
  get(name: string): unknown;
  set(name: string, value: unknown): void;
  save_changes(): void;
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
}

/**
 * One trait as a store React can read. `model.get` returns a fresh copy on every call, and
 * `useSyncExternalStore` needs the same value until it changes, so the value is read once
 * per `change:` event.
 */
function traitStore(model: Model, name: string) {
  let value = model.get(name);
  const listeners = new Set<() => void>();
  const onChange = () => {
    value = model.get(name);
    for (const listener of listeners) listener();
  };
  model.on(`change:${name}`, onChange);
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => value,
    dispose: () => model.off(`change:${name}`, onChange),
  };
}

type TraitStore = ReturnType<typeof traitStore>;

// One frame is one widget instance, so module scope is this instance's
let view: ViewState = { groupBy: [], aggFunc: null, search: "", pivotMode: false, pivotBy: [] };
let gridApi: GridApi | null = null;
let gridState: Record<string, unknown> | undefined;

function read(response: unknown, definition: unknown): Parsed | null {
  return response === undefined || response === null ? null : readSpec(response, definition);
}

const parsed = (model: Model) => read(model.get("data"), model.get("definition"));

/** The rows the view keeps, in its order: AG Grid's, or the search's while grouped or pivoted. */
function shownRows(rows: Row[], fields: string[]): Row[] {
  if (view.groupBy.length || view.pivotMode || !gridApi || gridApi.isDestroyed()) return quickMatch(rows, fields, view.search);
  const shown: Row[] = [];
  gridApi.forEachNodeAfterFilterAndSort((node) => {
    if (node.data) shown.push(node.data as Row);
  });
  return shown;
}

/** The state trait holds at most 64 KiB; the grid's part is the one that can grow. */
const MAX_STATE = 60_000;
const SAVE_DELAY_MS = 600;

function saver(model: Model) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    save() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        let state: SavedState = { grid: gridState, ...view };
        if (JSON.stringify(state).length > MAX_STATE) state = { ...view };
        model.set("state", state);
        model.save_changes();
      }, SAVE_DELAY_MS);
    },
    cancel: () => clearTimeout(timer),
  };
}

function App({
  data,
  definition,
  theme,
  saved,
  save,
}: {
  data: TraitStore;
  definition: TraitStore;
  theme: TraitStore;
  saved: SavedState;
  save: () => void;
}) {
  const response = useSyncExternalStore(data.subscribe, data.get);
  const declared = useSyncExternalStore(definition.subscribe, definition.get);
  const themeTrait = useSyncExternalStore(theme.subscribe, theme.get) as ThemeTrait | null;
  const spec = useMemo(() => read(response, declared), [response, declared]);
  const onViewChange = useCallback(
    (next: ViewState) => {
      const changed = JSON.stringify(next) !== JSON.stringify(view);
      view = next;
      if (changed) save();
    },
    [save],
  );
  const onGridState = useCallback(
    (next: Record<string, unknown>) => {
      gridState = next;
      save();
    },
    [save],
  );
  const onApi = useCallback((api: GridApi | null) => {
    gridApi = api;
  }, []);
  return (
    <GridView
      data={spec}
      theme={themeTrait}
      saved={saved}
      onViewChange={onViewChange}
      onGridState={onGridState}
      onApi={onApi}
    />
  );
}

export default {
  initialize({ model }: { model: Model }) {
    return {
      async exportOptions() {
        const data = parsed(model);
        if (!data?.ok || !data.spec.rowData.length) return [];
        return [
          ...(gridApi ? [{ id: "view", label: "Table as shown (CSV)", extension: "csv", mime: "text/csv" }] : []),
          { id: "rows", label: "All rows (CSV)", extension: "csv", mime: "text/csv" },
          { id: "json", label: "Response (JSON)", extension: "json", mime: "application/json" },
        ];
      },
      async exportData(id: string) {
        const data = parsed(model);
        if (!data?.ok) return null;
        // What the grid shows: its columns, order, sort, filters and formats, every page
        if (id === "view") return gridApi && !gridApi.isDestroyed() ? (gridApi.getDataAsCsv() ?? null) : null;
        if (id === "rows") return rowsCsv(data.spec.rowData, leafColumns(data.spec.columnDefs));
        // The response as the backend returned it
        if (id === "json") return JSON.stringify(model.get("data"), null, 2);
        return null;
      },
      async copilotContext() {
        const data = parsed(model);
        if (!data?.ok) return null;
        const { spec } = data;
        const columns = leafColumns(spec.columnDefs);
        const grouped = view.groupBy.length > 0 || view.pivotMode;
        return summary({
          columns,
          measures: groupingOf(spec).measures,
          rows: spec.rowData,
          shown: shownRows(
            spec.rowData,
            columns.map((column) => column.field),
          ),
          view,
          sort: grouped ? undefined : gridState?.sort,
          filter: grouped ? undefined : gridState?.filter,
        });
      },
    };
  },

  render({ model, el, signal }: { model: Model; el: HTMLElement; signal: AbortSignal }) {
    const data = traitStore(model, "data");
    const definition = traitStore(model, "definition");
    const theme = traitStore(model, "theme");
    const saved = stateOf(model.get("state"));
    gridState = saved.grid;
    const { save, cancel } = saver(model);
    const root = createRoot(el);
    root.render(
      <StrictMode>
        <App data={data} definition={definition} theme={theme} saved={saved} save={save} />
      </StrictMode>,
    );
    signal.addEventListener("abort", () => {
      cancel();
      root.unmount();
      data.dispose();
      definition.dispose();
      theme.dispose();
    });
  },
};
