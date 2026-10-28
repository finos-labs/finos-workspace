/*
 * BQ Advanced Grouping for Workspace: an Anywidget front-end module (AFM 0.11) that renders
 * a backend widget of type `bq-advanced-grouping` with React and AG Grid Community.
 *
 * The widget's endpoint returns company rows, `{ "rows": [...], "total": n }`. Workspace
 * fetches it with the user's credentials and pushes the response into the `data` trait;
 * the frame has no network, so the search runs over the rows it has. The user groups by
 * any of sector, industry, state and size, and aggregates revenue and employees by sum,
 * average, minimum or maximum. Workspace's Export menu and its Copilot get the rows, the
 * groups and a summary through the exports `initialize` returns.
 *
 * The build bundles React and AG Grid into this one module, because a plugin frame
 * receives one module and its styles, nothing else.
 */
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { StrictMode, useCallback, useMemo, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { groupsCsv, rowsCsv, rowsOf, searchRows, summary, type ViewState } from "./rows";
import { CONFIG } from "./types";
import { AdvancedGroupingView, type ColorScheme } from "./view/AdvancedGroupingView";
import "./view/styles.css";

// Community modules only. This plugin must never depend on ag-grid-enterprise.
ModuleRegistry.registerModules([AllCommunityModule]);

/** The part of the AFM model this module uses. */
interface Model {
  get(name: string): unknown;
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
// it will help copilot and exportdata to check details. It is outside of react.
let view: ViewState = {
  groupBy: CONFIG.defaults.groupBy,
  aggregation: CONFIG.defaults.aggregation,
  search: "",
};

function parsed(model: Model) {
  const data = model.get("data");
  return data === undefined || data === null ? null : rowsOf(data);
}

function App({ data, theme }: { data: TraitStore; theme: TraitStore }) {
  const response = useSyncExternalStore(data.subscribe, data.get);
  const mode = useSyncExternalStore(theme.subscribe, theme.get) as { mode?: string } | null;
  const colorScheme: ColorScheme = mode?.mode === "dark" ? "dark" : "light";
  const rows = useMemo(
    () => (response === undefined || response === null ? null : rowsOf(response)),
    [response],
  );
  const onViewChange = useCallback((next: ViewState) => {
    view = next;
  }, []);
  return (
    <AdvancedGroupingView
      config={CONFIG}
      data={rows}
      colorScheme={colorScheme}
      onViewChange={onViewChange}
    />
  );
}

export default {
  initialize({ model }: { model: Model }) {
    return {
      async exportOptions() {
        const data = parsed(model);
        if (!data?.ok) return [];
        const options = [
          { id: "companies", label: "Companies (CSV)", extension: "csv", mime: "text/csv" },
          { id: "json", label: "Response (JSON)", extension: "json", mime: "application/json" },
        ];
        if (view.groupBy.length) {
          options.unshift({ id: "groups", label: "Groups (CSV)", extension: "csv", mime: "text/csv" });
        }
        return options;
      },
      async exportData(id: string) {
        const data = parsed(model);
        if (!data?.ok) return null;
        const rows = searchRows(data.rows, view.search);
        if (id === "groups") return groupsCsv(rows, view);
        if (id === "companies") return rowsCsv(rows);
        // The response as the backend returned it
        if (id === "json") return JSON.stringify(model.get("data"), null, 2);
        return null;
      },
      async copilotContext() {
        const data = parsed(model);
        return data?.ok ? summary(data.rows, view) : null;
      },
    };
  },

  render({ model, el, signal }: { model: Model; el: HTMLElement; signal: AbortSignal }) {
    const data = traitStore(model, "data");
    const theme = traitStore(model, "theme");
    const root = createRoot(el);
    root.render(
      <StrictMode>
        <App data={data} theme={theme} />
      </StrictMode>,
    );
    signal.addEventListener("abort", () => {
      root.unmount();
      data.dispose();
      theme.dispose();
    });
  },
};
