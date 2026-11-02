import livegrid from "./livegrid.js";
import sql from "./sql.js";
import ssrm from "./ssrm.js";
import table from "./table.js";

const WIDGETS = { table, livegrid, ssrm, sql };

let widget = null;

export default {
  initialize(args) {
    widget = WIDGETS[args.model.get("meta")?.widgetId];
    if (!widget) throw new Error("This plugin has no widget by that id.");
    return widget.initialize(args);
  },
  render(args) {
    return widget.render(args);
  },
};
