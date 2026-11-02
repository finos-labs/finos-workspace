import {
  createGrid,
  createTracker,
  fieldsOf,
  formatNumber,
  gridOptionsFor,
  groupingOf,
  licenseKeyOf,
  loadEnterprise,
  setTheme,
  sortModelOf,
  themeClass,
} from "./grid.js";

export const PIVOT_SEPARATOR = "|";
export const DEFAULT_PAGE_SIZE = 100;
const CALL_TIMEOUT = 35_000;

const REFUSALS = {
  unavailable: "The data is not available. An administrator may not have set up the plugin's backend, the network it may use or the postgres_url secret.",
  rate_limited: "Too many requests at once. Wait a moment.",
  timeout: "No answer in time.",
  too_large: "The answer was too large to send.",
  invalid_args: "The request was refused.",
  not_granted: "This widget may no longer call its backend.",
  out_of_scope: "This widget may not call this route.",
};

export function columnDefsOf(columns) {
  return columns.map((column) => {
    const numeric = column.kind === "number";
    return {
      field: column.name,
      headerName: column.name,
      headerTooltip: column.type,
      filter: numeric ? "agNumberColumnFilter" : column.kind === "date" ? "agDateColumnFilter" : "agTextColumnFilter",
      enableValue: numeric,
      ...(numeric ? { type: "numericColumn", valueFormatter: formatNumber } : {}),
    };
  });
}

export function optionsFor({ definition, columns, datasource, mode }) {
  const pageSize = definition.pageSize ?? DEFAULT_PAGE_SIZE;
  const options = gridOptionsFor({
    mode,
    rowData: [],
    columnDefs: columnDefsOf(columns),
    gridOptions: {
      rowData: undefined,
      rowModelType: "serverSide",
      serverSideDatasource: datasource,
      serverSidePivotResultFieldSeparator: PIVOT_SEPARATOR,
      pagination: true,
      paginationAutoPageSize: false,
      paginationPageSize: pageSize,
      cacheBlockSize: pageSize,
      maxBlocksInCache: 4,
    },
  });
  delete options.groupDefaultExpanded;
  options.statusBar = { statusPanels: [{ statusPanel: "agAggregationComponent", align: "right" }] };
  return options;
}

let api = null;
let licensePromise = null;

export default {
  initialize({ model }) {
    licensePromise = loadEnterprise(licenseKeyOf(model));
    return {
      exportOptions: () => [],
      exportData: () => null,
      copilotContext: () => {
        if (!api) return null;
        return {
          table: model.get("definition")?.table,
          columns: fieldsOf(api),
          rowsAtThisLevel: api.getDisplayedRowCount(),
          filterModel: api.getFilterModel(),
          sortModel: sortModelOf(api),
          grouping: groupingOf(api),
        };
      },
    };
  },

  async render({ model, el, signal, experimental }) {
    await licensePromise;

    el.replaceChildren();

    const modeOf = () => model.get("theme")?.mode ?? "light";
    const definition = model.get("definition") || {};
    if (typeof definition.table !== "string" || !definition.table) throw new Error("The widget's definition names no table.");
    const table = definition.table;

    const root = document.createElement("div");
    root.className = `ag-stack ${themeClass(modeOf())}`;
    const strip = document.createElement("div");
    strip.className = "ag-strip";
    strip.setAttribute("aria-live", "polite");
    const gridEl = document.createElement("div");
    gridEl.className = "ag-fill";
    root.append(strip, gridEl);
    el.appendChild(root);

    const call = async (route, args) => {
      const [answer] = await experimental.invoke("core:backend:call", { route, args }, { timeout: CALL_TIMEOUT, signal });
      if (answer.error) throw new Error(answer.error.message);
      return answer;
    };
    const say = (error) => {
      strip.textContent = error.name in REFUSALS ? REFUSALS[error.name] : error.message;
    };

    let columns;
    try {
      columns = (await call("ssrm_columns", { table })).columns;
    } catch (error) {
      if (!signal.aborted) say(error);
      return;
    }
    if (signal.aborted) return;

    const datasource = {
      getRows(params) {
        call("ssrm_rows", { table, request: JSON.stringify(params.request) })
          .then((answer) => {
            strip.textContent = "";
            params.success({ rowData: answer.rows, rowCount: answer.rowCount, pivotResultFields: answer.pivotResultFields });
          })
          .catch((error) => {
            if (!signal.aborted) say(error);
            params.fail();
          });
      },
    };

    api = createGrid(gridEl, optionsFor({ definition, columns, datasource, mode: modeOf() }));
    const tracker = createTracker(model);
    const detach = tracker.attach(api);

    const onThemeChange = () => {
      setTheme(root, api, modeOf());
      api.sizeColumnsToFit();
    };
    const onEvent = (message) => {
      if (message?.kind === "workspace-event" && message.name === "refresh") api.refreshServerSide({ purge: true });
    };
    model.on("change:theme", onThemeChange);
    model.on("msg:custom", onEvent);
    const resizeObserver = new ResizeObserver(() => { if (api) api.sizeColumnsToFit(); });
    resizeObserver.observe(el);

    signal.addEventListener("abort", () => {
      model.off("change:theme", onThemeChange);
      model.off("msg:custom", onEvent);
      detach();
      resizeObserver.disconnect();
      api.destroy();
      api = null;
    });
  },
};
