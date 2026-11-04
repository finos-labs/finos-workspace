import {
  clientExports,
  createGrid,
  createTracker,
  gridOptionsFor,
  hasIds,
  licenseKeyOf,
  loadEnterprise,
  normalizeData,
  setTheme,
  themeClass,
} from "./grid.js";

export const FLUSH_MS = 150;

let api = null;
let licensePromise = null;

export function applyMessage(byId, message) {
  const touched = new Set();
  const removed = new Set();
  let replaced = false;
  const keep = (row) => {
    if (!row || typeof row !== "object" || row.id === undefined) return;
    const id = String(row.id);
    byId.set(id, row);
    touched.add(id);
    removed.delete(id);
  };
  if (message?.op === "snapshot" && Array.isArray(message.rows)) {
    byId.clear();
    replaced = true;
    message.rows.forEach(keep);
  } else if (message?.op === "upsert" && Array.isArray(message.rows)) {
    message.rows.forEach(keep);
  } else if (message?.op === "remove" && Array.isArray(message.ids)) {
    for (const raw of message.ids) {
      const id = String(raw);
      byId.delete(id);
      touched.delete(id);
      removed.add(id);
    }
  }
  return { touched, removed, replaced };
}

export function statusText(event) {
  if (event.state === "live") return "Live";
  if (event.state === "retrying") return `Disconnected, retrying in ${event.retryIn} s`;
  if (event.state === "closed") return "Closed";
  return "Connecting…";
}

export default {
  initialize({ model }) {
    licensePromise = loadEnterprise(licenseKeyOf(model));
    return clientExports(() => api);
  },

  async render({ model, el, signal }) {
    await licensePromise;

    el.replaceChildren();

    const modeOf = () => model.get("theme")?.mode ?? "light";
    const tracker = createTracker(model);

    const root = document.createElement("div");
    root.className = `ag-stack ${themeClass(modeOf())}`;
    const status = document.createElement("div");
    status.className = "ag-strip";
    status.setAttribute("aria-live", "polite");
    const gridEl = document.createElement("div");
    gridEl.className = "ag-fill";
    root.append(status, gridEl);
    el.appendChild(root);

    const initial = normalizeData(model.get("data") || {});
    if (!hasIds(initial.rowData)) throw new Error("A live grid needs an id in every row.");
    const byId = new Map(initial.rowData.map((row) => [String(row.id), row]));
    api = createGrid(gridEl, gridOptionsFor({ mode: modeOf(), rowData: initial.rowData, columnDefs: initial.columnDefs, gridOptions: { enableCellChangeFlash: true, cellFlashDuration: 600, cellFadeDuration: 1800, ...initial.gridOptions }, keyed: true }));
    const detach = tracker.attach(api);

    let touched = new Set();
    let removed = new Set();
    let replaced = false;
    const flush = () => {
      if (!api) return;
      if (replaced) {
        api.setGridOption("rowData", [...byId.values()]);
      } else {
        const add = [];
        const update = [];
        for (const id of touched) (api.getRowNode(id) ? update : add).push(byId.get(id));
        const remove = [...removed].map((id) => api.getRowNode(id)?.data).filter(Boolean);
        if (add.length > 0 || update.length > 0 || remove.length > 0) api.applyTransaction({ add, update, remove });
      }
      touched = new Set();
      removed = new Set();
      replaced = false;
    };

    const flusher = setInterval(() => {
      if (replaced || touched.size > 0 || removed.size > 0) flush();
    }, FLUSH_MS);

    const say = (text, live = false) => {
      status.textContent = text;
      status.dataset.live = String(live);
    };
    say("Connecting…");

    const onEvent = (event) => {
      if (event?.kind !== "workspace-event") return;
      if (event.name === "stream-status") {
        say(statusText(event), event.state === "live");
      } else if (event.name === "stream" && Array.isArray(event.messages)) {
        for (const message of event.messages) {
          const change = applyMessage(byId, message);
          change.touched.forEach((id) => {
            touched.add(id);
            removed.delete(id);
          });
          change.removed.forEach((id) => {
            removed.add(id);
            touched.delete(id);
          });
          if (change.replaced) replaced = true;
        }
      }
    };

    const onThemeChange = () => {
      setTheme(root, api, modeOf());
      api.sizeColumnsToFit();
    };

    model.on("change:theme", onThemeChange);
    model.on("msg:custom", onEvent);
    const resizeObserver = new ResizeObserver(() => { if (api) api.sizeColumnsToFit(); });
    resizeObserver.observe(el);

    signal.addEventListener("abort", () => {
      clearInterval(flusher);
      model.off("change:theme", onThemeChange);
      model.off("msg:custom", onEvent);
      detach();
      resizeObserver.disconnect();
      api.destroy();
      api = null;
    });
  },
};
