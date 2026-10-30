export const SOURCES = {
  postgres: {
    label: "Postgres",
    schemaRoute: "postgres_schema",
    queryRoute: "postgres_query",
    sql: "SELECT table_schema, table_name\nFROM information_schema.tables\nWHERE table_schema NOT IN ('pg_catalog', 'information_schema')\nORDER BY 1, 2",
  },
  files: {
    label: "Files",
    schemaRoute: "files_schema",
    queryRoute: "files_query",
    sql: "SHOW TABLES",
  },
};

const MAX_SQL = 32_768;
const CALL_TIMEOUT = 35_000;

const REFUSALS = {
  unavailable: (label) =>
    `${label} is not available. An administrator may not have set it up yet: the plugin's backend, the network it may use, and for Postgres the postgres_url secret.`,
  rate_limited: () => "Too many queries at once. Wait a moment and run it again.",
  timeout: () => "No answer in time.",
  too_large: () => "The result was too large to send.",
  invalid_args: () => `The query is too long: at most ${MAX_SQL.toLocaleString("en")} characters.`,
  not_granted: () => "This widget may no longer run queries.",
  out_of_scope: () => "This widget may not run queries here.",
};

export function identifier(name) {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}

export function csvOf(result) {
  const quote = (value) => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [result.columns.map((c) => c.name), ...result.rows]
    .map((row) => row.map(quote).join(","))
    .join("\n");
}

export function contextOf(run) {
  if (!run) return null;
  const base = { source: SOURCES[run.source]?.label ?? "Given result", sql: run.sql.slice(0, 4000) };
  if (run.error) return { ...base, error: run.error };
  return {
    ...base,
    columns: run.result.columns,
    rows: run.result.rows.length,
    truncated: run.result.truncated,
  };
}

export function givenOf(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.rows)) return null;
  const columns =
    Array.isArray(data.columns) && data.columns.length
      ? data.columns.map((column) => ({ name: String(column.name), type: column.type }))
      : Object.keys(data.rows[0] ?? {}).map((name) => ({ name }));
  const rows = data.rows.map((row) => (Array.isArray(row) ? row : columns.map((column) => row?.[column.name] ?? null)));
  return { sql: typeof data.sql === "string" ? data.sql : "", result: { columns, rows, truncated: false } };
}

export function stateOf(saved) {
  const state = saved && typeof saved === "object" ? saved : {};
  const source = state.source in SOURCES ? state.source : "postgres";
  const sql = Object.fromEntries(
    Object.entries(SOURCES).map(([id, s]) => [
      id,
      typeof state.sql?.[id] === "string" ? state.sql[id].slice(0, MAX_SQL) : s.sql,
    ]),
  );
  return { source, sql };
}

let lastRun = null;
let loadingGrid = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const NUMERIC_TYPE =
  /^(numeric|decimal|integer|int\d?|bigint|smallint|tinyint|hugeint|ubigint|uinteger|usmallint|utinyint|real|double|float\d?)\b/i;

export function isNumeric(column, value) {
  return typeof value === "number" || NUMERIC_TYPE.test(column?.type ?? "");
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

export function formatCell(params) {
  const { value } = params;
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? numberFormat.format(value) : String(value);
  return typeof value === "object" ? JSON.stringify(value) : value;
}

export function gridColumns(result) {
  const first = result.rows[0] ?? [];
  return result.columns.map((column, i) => ({
    field: String(i),
    headerName: column.name,
    headerTooltip: column.type,
    valueFormatter: formatCell,
    ...(isNumeric(column, first[i]) ? { type: "numericColumn" } : {}),
  }));
}

export function gridRows(result) {
  return result.rows.map((row) => Object.fromEntries(row.map((value, i) => [String(i), value])));
}

export function gridOptions(result) {
  return {
    columnDefs: gridColumns(result),
    rowData: gridRows(result),
    defaultColDef: { resizable: true, sortable: true, filter: true, flex: 1, minWidth: 80, suppressHeaderFilterButton: true },
    pagination: result.rows.length > 100,
    paginationAutoPageSize: true,
    paginationPageSizeSelector: false,
    enableCellTextSelection: true,
    tooltipShowDelay: 400,
  };
}

export default {
  initialize() {
    return {
      async exportOptions() {
        if (!lastRun?.result) return [];
        return [
          { id: "csv", label: "Result (CSV)", extension: "csv", mime: "text/csv" },
          { id: "json", label: "Result and query (JSON)", extension: "json", mime: "application/json" },
        ];
      },
      async exportData(id) {
        if (!lastRun?.result) return null;
        if (id === "csv") return csvOf(lastRun.result);
        if (id === "json")
          return JSON.stringify(
            { source: lastRun.source, engine: lastRun.engine, sql: lastRun.sql, ...lastRun.result },
            null,
            2,
          );
        return null;
      },
      async copilotContext() {
        return contextOf(lastRun);
      },
    };
  },

  async render({ model, el, signal, experimental }) {
    let state = stateOf(model.get("state"));
    let running = 0;
    const withGrid = model.get("meta")?.widgetId === "grid";
    let gridApi = null;
    let gridHost = null;

    const given = withGrid ? givenOf(model.get("result")) : null;
    if (given) {
      lastRun = { source: "given", sql: given.sql, result: given.result };
      const shown = element("div", "sx sx-given");
      const output = element("div", "sx-output");
      const query = element("pre", "sx-given-sql", given.sql);
      query.hidden = !given.sql;
      shown.append(query, output);
      el.replaceChildren(shown);
      const theme = () => (model.get("theme")?.mode === "light" ? "ag-theme-quartz" : "ag-theme-quartz-dark");
      const paint = () => {
        shown.dataset.mode = model.get("theme")?.mode === "light" ? "light" : "dark";
        if (gridHost) gridHost.className = `sx-grid ${theme()}`;
      };
      loadingGrid ??= import("ag-grid-community");
      const { createGrid } = await loadingGrid;
      if (signal.aborted) return;
      gridHost = element("div", `sx-grid ${theme()}`);
      output.replaceChildren(gridHost);
      gridApi = createGrid(gridHost, gridOptions(given.result));
      paint();
      model.on("change:theme", paint);
      signal.addEventListener("abort", () => {
        model.off("change:theme", paint);
        gridApi?.destroy();
      });
      return;
    }

    const root = element("div", "sx");
    const bar = element("div", "sx-bar");
    const tabs = element("div", "sx-tabs");
    tabs.setAttribute("role", "tablist");
    const engine = element("span", "sx-engine");
    const assist = element("span", "sx-assist");
    const status = element("span", "sx-status");
    status.setAttribute("aria-live", "polite");
    const run = element("button", "sx-run", "Run");
    run.type = "button";
    run.title = "Run (Ctrl+Enter or ⌘+Enter)";
    bar.append(tabs, engine, assist, status, run);

    const body = element("div", "sx-body");
    const tables = element("nav", "sx-tables");
    tables.setAttribute("aria-label", "Tables");
    const main = element("div", "sx-main");
    const editor = element("textarea", "sx-editor");
    editor.spellcheck = false;
    editor.maxLength = MAX_SQL;
    editor.setAttribute("aria-label", "SQL");
    editor.setAttribute("aria-autocomplete", "list");
    const popup = element("ul", "sx-complete");
    popup.id = "sx-complete";
    popup.setAttribute("role", "listbox");
    popup.hidden = true;
    editor.setAttribute("aria-controls", popup.id);
    const output = element("div", "sx-output");
    main.append(editor, output, popup);
    body.append(tables, main);
    root.append(bar, body);
    el.replaceChildren(root);

    const tabButtons = Object.entries(SOURCES).map(([id, source]) => {
      const button = element("button", "sx-tab", source.label);
      button.type = "button";
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => choose(id));
      tabs.append(button);
      return [id, button];
    });

    const gridTheme = () => (model.get("theme")?.mode === "light" ? "ag-theme-quartz" : "ag-theme-quartz-dark");

    const applyTheme = () => {
      root.dataset.mode = model.get("theme")?.mode === "light" ? "light" : "dark";
      if (gridHost) gridHost.className = `sx-grid ${gridTheme()}`;
    };

    const clearGrid = () => {
      gridApi?.destroy();
      gridApi = null;
      gridHost = null;
    };

    const showGrid = async (result) => {
      loadingGrid ??= import("ag-grid-community");
      const { createGrid } = await loadingGrid;
      if (signal.aborted) return;
      clearGrid();
      gridHost = element("div", `sx-grid ${gridTheme()}`);
      output.replaceChildren(gridHost);
      gridApi = createGrid(gridHost, gridOptions(result));
    };

    let saveTimer;
    const save = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        model.set("state", state);
        model.save_changes();
      }, 600);
    };

    const show = () => {
      for (const [id, button] of tabButtons) {
        button.setAttribute("aria-selected", String(id === state.source));
      }
      if (editor.value !== state.sql[state.source]) editor.value = state.sql[state.source];
    };

    const insert = (text) => {
      const start = editor.selectionStart ?? editor.value.length;
      const end = editor.selectionEnd ?? start;
      editor.setRangeText(text, start, end, "end");
      editor.focus();
      editor.dispatchEvent(new Event("input"));
    };

    const showTables = (answer) => {
      engine.textContent = answer.engine ?? "";
      const list = element("ul", "sx-tree");
      for (const table of answer.tables ?? []) {
        const qualified = table.schema && table.schema !== "public"
          ? `${identifier(table.schema)}.${identifier(table.name)}`
          : identifier(table.name);
        const item = element("li");
        const details = element("details");
        const summary = element("summary");
        const name = element("button", "sx-name", table.schema && table.schema !== "public" ? `${table.schema}.${table.name}` : table.name);
        name.type = "button";
        name.title = table.file ? `${table.file}: insert ${qualified}` : `Insert ${qualified}`;
        name.addEventListener("click", (event) => {
          event.preventDefault();
          insert(qualified);
        });
        summary.append(name);
        const columns = element("ul");
        for (const column of table.columns) {
          const columnItem = element("li");
          const columnButton = element("button", "sx-column", column.name);
          columnButton.type = "button";
          columnButton.title = `${column.type}: insert ${identifier(column.name)}`;
          columnButton.addEventListener("click", () => insert(identifier(column.name)));
          columnItem.append(columnButton, element("span", "sx-type", column.type));
          columns.append(columnItem);
        }
        details.append(summary, columns);
        item.append(details);
        list.append(item);
      }
      const notes = (answer.skipped ?? []).map((text) => element("p", "sx-note", `Not read: ${text}`));
      if (!answer.tables?.length) notes.unshift(element("p", "sx-note", "No tables."));
      tables.replaceChildren(list, ...notes);
    };

    const loadTables = async () => {
      const source = state.source;
      tables.replaceChildren(element("p", "sx-note", "Loading…"));
      engine.textContent = "";
      try {
        const [answer] = await experimental.invoke(
          "core:backend:call",
          { route: SOURCES[source].schemaRoute, args: {} },
          { timeout: CALL_TIMEOUT, signal },
        );
        if (source !== state.source) return;
        if (answer.error) tables.replaceChildren(element("p", "sx-note", answer.error.message));
        else {
          known[source] = answer.tables ?? [];
          showTables(answer);
          mirror();
        }
      } catch (error) {
        if (signal.aborted || source !== state.source) return;
        tables.replaceChildren(element("p", "sx-note", (REFUSALS[error.name] ?? REFUSALS.unavailable)(SOURCES[source].label)));
      }
    };

    const known = {};
    let completer = null;
    let starting = null;
    let items = [];
    let active = 0;
    let suggestTimer;

    const mirror = () => {
      if (completer && known[state.source]) completer.mirror(known[state.source]);
    };

    const readAsset = async (path) => {
      const [, [bytes]] = await experimental.invoke("core:asset:read", { path }, { timeout: 60_000, signal });
      return bytes;
    };

    const startCompletion = () => {
      starting ??= (async () => {
        assist.textContent = "Completion starting…";
        try {
          const { startCompleter } = await import("./duckdb.js");
          completer = await startCompleter(readAsset);
          mirror();
          assist.textContent = "";
        } catch (error) {
          assist.textContent = "No completion";
          assist.title = error instanceof Error ? error.message : String(error);
        }
      })();
      return starting;
    };

    const closePopup = () => {
      asking += 1;
      items = [];
      popup.hidden = true;
      popup.replaceChildren();
      editor.removeAttribute("aria-activedescendant");
    };

    const highlight = (index) => {
      active = index;
      [...popup.children].forEach((child, i) => child.setAttribute("aria-selected", String(i === index)));
      popup.children[index]?.scrollIntoView({ block: "nearest" });
      editor.setAttribute("aria-activedescendant", `sx-option-${index}`);
    };

    const accept = (index) => {
      const suggestion = items[index];
      closePopup();
      if (!suggestion) return;
      editor.setRangeText(suggestion.text, suggestion.start, editor.selectionStart, "end");
      editor.dispatchEvent(new Event("input"));
    };

    const caretPoint = () => {
      const style = getComputedStyle(editor);
      const copy = document.createElement("div");
      for (const property of ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "tabSize"])
        copy.style[property] = style[property];
      Object.assign(copy.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", top: "0", left: "0" });
      copy.textContent = editor.value.slice(0, editor.selectionStart);
      const marker = document.createElement("span");
      marker.textContent = "​";
      copy.append(marker);
      document.body.append(copy);
      const point = {
        left: marker.offsetLeft - editor.scrollLeft,
        top: marker.offsetTop - editor.scrollTop,
        height: Number.parseFloat(style.lineHeight) || 18,
      };
      copy.remove();
      return point;
    };

    let asking = 0;
    const suggest = async (asked) => {
      if (!completer) return closePopup();
      const cursor = editor.selectionStart;
      const before = editor.value.slice(0, cursor);
      if (cursor !== editor.selectionEnd || (!asked && !/[A-Za-z0-9_."]$/.test(before))) return closePopup();
      const ticket = ++asking;
      let found;
      try {
        found = await completer.suggest(before);
      } catch {
        return closePopup();
      }
      if (ticket !== asking || editor.selectionStart !== cursor || document.activeElement !== editor) return;
      if (!found.length) return closePopup();
      items = found;
      popup.replaceChildren(
        ...found.map((suggestion, i) => {
          const option = element("li", `sx-option sx-${suggestion.kind}`);
          option.id = `sx-option-${i}`;
          option.setAttribute("role", "option");
          option.append(element("span", "sx-suggestion", suggestion.text.trimEnd()), element("span", "sx-kind", suggestion.kind));
          option.addEventListener("mousedown", (event) => event.preventDefault());
          option.addEventListener("click", () => accept(i));
          return option;
        }),
      );
      popup.hidden = false;
      const point = caretPoint();
      const left = editor.offsetLeft + point.left;
      popup.style.left = `${Math.max(0, Math.min(left, main.clientWidth - popup.offsetWidth - 4))}px`;
      popup.style.top = `${editor.offsetTop + point.top + point.height}px`;
      highlight(0);
    };

    const showResult = (result, elapsed) => {
      const count = result.rows.length.toLocaleString("en");
      status.textContent = `${count} ${result.rows.length === 1 ? "row" : "rows"}${result.truncated ? " (the first; there are more)" : ""} · ${elapsed} ms`;
      clearGrid();
      if (withGrid) {
        showGrid(result);
        return;
      }
      const table = element("table", "sx-table");
      const head = element("thead");
      const headRow = element("tr");
      for (const column of result.columns) {
        const th = element("th", "", column.name);
        th.title = column.type;
        headRow.append(th);
      }
      head.append(headRow);
      const rows = element("tbody");
      for (const row of result.rows) {
        const tr = element("tr");
        row.forEach((value, i) => {
          const column = result.columns[i];
          const td = element("td", isNumeric(column, value) ? "sx-number" : "");
          if (value === null) {
            td.textContent = "NULL";
            td.classList.add("sx-null");
          } else {
            td.textContent = typeof value === "object" ? JSON.stringify(value) : String(value);
          }
          tr.append(td);
        });
        rows.append(tr);
      }
      table.append(head, rows);
      output.replaceChildren(table);
    };

    const showMessage = (text, kind) => {
      clearGrid();
      output.replaceChildren(element("pre", `sx-message sx-${kind}`, text));
    };

    const execute = async () => {
      const source = state.source;
      const sql = state.sql[source];
      if (!sql.trim()) return;
      const ticket = ++running;
      run.disabled = true;
      status.textContent = "Running…";
      try {
        const [answer] = await experimental.invoke(
          "core:backend:call",
          { route: SOURCES[source].queryRoute, args: { sql } },
          { timeout: CALL_TIMEOUT, signal },
        );
        if (ticket !== running) return;
        if (answer.error) {
          lastRun = { source, sql, error: answer.error.message };
          status.textContent = "Failed";
          showMessage(answer.error.message, "error");
        } else {
          const result = { columns: answer.columns, rows: answer.rows, truncated: answer.truncated };
          lastRun = { source, sql, engine: engine.textContent, result };
          showResult(result, answer.elapsedMs);
          if (source === "files") {
            model.set("params", { sql });
            model.save_changes();
          }
        }
      } catch (error) {
        if (signal.aborted || ticket !== running) return;
        const text = (REFUSALS[error.name] ?? REFUSALS.unavailable)(SOURCES[source].label);
        lastRun = { source, sql, error: text };
        status.textContent = "Not run";
        showMessage(text, "refused");
      } finally {
        if (ticket === running) run.disabled = false;
      }
    };

    function choose(id) {
      if (id === state.source) return;
      state = { ...state, source: id };
      save();
      show();
      closePopup();
      clearGrid();
      output.replaceChildren();
      status.textContent = "";
      loadTables();
      execute();
    }

    editor.addEventListener("focus", () => startCompletion(), { once: true });
    editor.addEventListener("input", (event) => {
      state = { ...state, sql: { ...state.sql, [state.source]: editor.value } };
      save();
      if (event.inputType === "insertText" || (event.inputType === "deleteContentBackward" && !popup.hidden)) {
        clearTimeout(suggestTimer);
        suggestTimer = setTimeout(() => suggest(false), 30);
      } else if (event.isTrusted) closePopup();
    });
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        closePopup();
        execute();
        return;
      }
      if (event.key === " " && event.ctrlKey) {
        event.preventDefault();
        startCompletion().then(() => suggest(true));
        return;
      }
      if (popup.hidden) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        highlight((active + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        accept(active);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closePopup();
      } else if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
        closePopup();
      }
    });
    for (const name of ["blur", "click", "scroll"]) editor.addEventListener(name, closePopup);
    run.addEventListener("click", execute);

    const onState = () => {
      if (document.activeElement === editor) return;
      state = stateOf(model.get("state"));
      show();
    };
    const onEvent = (message) => {
      if (message?.kind === "workspace-event" && message.name === "refresh") {
        loadTables();
        execute();
      }
    };
    model.on("change:state", onState);
    model.on("change:theme", applyTheme);
    model.on("msg:custom", onEvent);
    signal.addEventListener("abort", () => {
      clearTimeout(saveTimer);
      clearGrid();
      model.off("change:state", onState);
      model.off("change:theme", applyTheme);
      model.off("msg:custom", onEvent);
    });

    applyTheme();
    show();
    loadTables();
    execute();
  },
};
