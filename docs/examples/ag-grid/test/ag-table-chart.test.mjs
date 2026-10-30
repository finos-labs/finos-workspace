import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import { formatValue, headerFromField, titleCase, yearOf } from "../src/ag-table-chart/format.js";
import { compileFormatter } from "../src/ag-table-chart/expression.js";
import { columnColorStyle, contrastText, greenRedStyle, ruleMatches, withOpacity } from "../src/ag-table-chart/colors.js";
import { pointStyle, sparklineData, sparklineOptions } from "../src/ag-table-chart/sparkline.js";
import { fillTemplate, renderMarkdown } from "../src/ag-table-chart/markdown.js";
import { HoverCardTooltip, changeTrackedColumns, agTableChartColumnDefs, renderFnsOf, toColDef } from "../src/ag-table-chart/columns.js";
import { agChartType, chartColumns, navigatorOverrides } from "../src/ag-table-chart/chartView.js";

const en = { locale: "en-US" };

test("formatterFn values format like OpenBB", () => {
  assert.equal(formatValue(45000000000, { ...en, formatterFn: "int" }), "45,000,000,000");
  assert.equal(formatValue(2.5, { ...en, formatterFn: "percent" }), "2.50%");
  assert.equal(formatValue(0.5, { ...en, formatterFn: "normalized" }), "50.00");
  assert.equal(formatValue(0.5, { ...en, formatterFn: "normalizedPercent" }), "50.00%");
  assert.equal(formatValue("2024-06-06", { formatterFn: "dateToYear" }), "2024");
  assert.equal(formatValue(1234.5678, { formatterFn: "none" }), "1234.5678");
  assert.equal(formatValue(1234.5678, en), "1,234.57");
  assert.equal(formatValue(1234, en), "1,234");
});

test("decimalPlaces, prefix and suffix", () => {
  assert.equal(formatValue(1.23456, { ...en, decimalPlaces: 3 }), "1.235");
  assert.equal(formatValue(0.1234, { ...en, formatterFn: "normalizedPercent", decimalPlaces: 1 }), "12.3%");
  assert.equal(formatValue(350.5, { ...en, prefix: "$", suffix: " USD" }), "$350.50 USD");
  assert.equal(formatValue("AAPL", { prefix: "$" }), "$AAPL");
  assert.equal(formatValue(null, en), "");
  assert.equal(formatValue(3, { ...en, decimals: 4 }), "3");
  assert.equal(formatValue(3.1, { ...en, decimals: 4 }), "3.1000");
});

test("titleCase, headers and years", () => {
  assert.equal(titleCase("ethereum classic"), "Ethereum Classic");
  assert.equal(titleCase("BITCOIN"), "Bitcoin");
  assert.equal(headerFromField("change_1d"), "Change 1d");
  assert.equal(headerFromField("priceHistory"), "Price History");
  assert.equal(yearOf("2015-07-30"), "2015");
  assert.equal(yearOf(2020), "2020");
});

test("customFormatter strings from the OpenBB docs evaluate without eval", () => {
  const pnl = compileFormatter("(params) => ({ fill: params.yValue >= 0 ? '#22c55e' : '#ef4444', stroke: params.yValue >= 0 ? '#16a34a' : '#dc2626' })");
  assert.deepEqual(pnl({ yValue: 3 }), { fill: "#22c55e", stroke: "#16a34a" });
  assert.deepEqual(pnl({ yValue: -1 }), { fill: "#ef4444", stroke: "#dc2626" });
  const growth = compileFormatter("(params) => ({ fill: params.yValue > 10 ? '#22c55e' : params.yValue < 0 ? '#ef4444' : '#f59e0b', fillOpacity: 0.3, stroke: params.yValue > 10 ? '#16a34a' : params.yValue < 0 ? '#dc2626' : '#d97706' })");
  assert.deepEqual(growth({ yValue: 5 }), { fill: "#f59e0b", fillOpacity: 0.3, stroke: "#d97706" });
  assert.equal(growth({ yValue: 20 }).fill, "#22c55e");
});

test("customFormatter takes other function forms, Math and logic", () => {
  assert.deepEqual(compileFormatter("p => ({ size: Math.abs(p.yValue) * 2 })")({ yValue: -3 }), { size: 6 });
  assert.deepEqual(compileFormatter("function (params) { return { fill: params.max || params.min ? 'red' : 'gray' }; }")({ max: true }), { fill: "red" });
  assert.deepEqual(compileFormatter("(params) => { return { fill: params.first && params.yValue !== 0 ? 'a' : 'b' } }")({ first: true, yValue: 1 }), { fill: "a" });
  assert.deepEqual(compileFormatter("(params) => ({ fill: params.datum['x'] ?? 'none' })")({ datum: {} }), { fill: "none" });
});

test("customFormatter refuses code", () => {
  assert.throws(() => compileFormatter("(p) => fetch('https://evil')")({}), TypeError);
  assert.throws(() => compileFormatter("(p) => ({ a: 1 }); alert(1)"), SyntaxError);
  assert.throws(() => compileFormatter("(p) => `${p.x}`"), SyntaxError);
  assert.equal(compileFormatter("(p) => ({ a: p.constructor })")({}).a, undefined);
  assert.equal(compileFormatter("(p) => ({ a: p['__proto__'] })")({}).a, undefined);
  assert.equal(compileFormatter("(p) => ({ a: window })")({}).a, undefined);
});

test("color rules match every condition", () => {
  assert.equal(ruleMatches({ condition: "between", range: { min: 3e10, max: 4e10 } }, 3.5e10), true);
  assert.equal(ruleMatches({ condition: "lt", value: 1e10 }, 8e9), true);
  assert.equal(ruleMatches({ condition: "gt", value: 4e10 }, 4.5e10), true);
  assert.equal(ruleMatches({ condition: "gte", value: 5 }, 5), true);
  assert.equal(ruleMatches({ condition: "lte", value: 5 }, 6), false);
  assert.equal(ruleMatches({ condition: "eq", value: "5" }, 5), true);
  assert.equal(ruleMatches({ condition: "ne", value: "Active" }, "Closed"), true);
  assert.equal(ruleMatches({ condition: "contains", value: "Pend" }, "Pending"), true);
  assert.equal(ruleMatches({ condition: "notContains", value: "Pend" }, "Active"), true);
});

test("columnColor and greenRed styles", () => {
  const rules = [
    { condition: "lt", value: 50, color: "red", fill: true },
    { condition: "gt", value: 90, color: "#FFA500", fill: false },
  ];
  assert.deepEqual(columnColorStyle(rules, 10), { color: "#ffffff", backgroundColor: "#dc2626" });
  assert.deepEqual(columnColorStyle(rules, 95), { color: "#FFA500" });
  assert.equal(columnColorStyle(rules, 70), null);
  assert.deepEqual(greenRedStyle(2.5), { color: "#16a34a" });
  assert.deepEqual(greenRedStyle(-0.5), { color: "#dc2626" });
  assert.equal(greenRedStyle(0), null);
  assert.equal(contrastText("#ffff00"), "#111827");
  assert.equal(withOpacity("#22c55e", 0.3), "rgba(34, 197, 94, 0.3)");
});

test("sparklines map to AG Grid 32 options", () => {
  const line = sparklineOptions({
    type: "line",
    options: {
      stroke: "#2563eb", strokeWidth: 2, markers: { enabled: true, size: 3 },
      pointsOfInterest: { maximum: { fill: "#22c55e", size: 6 }, minimum: { fill: "#ef4444", size: 6 } },
    },
  });
  assert.equal(line.type, "line");
  assert.deepEqual(line.line, { stroke: "#2563eb", strokeWidth: 2 });
  assert.equal(line.marker.enabled, true);
  assert.deepEqual(line.marker.formatter({ yValue: 5, max: true }), { size: 6, fill: "#22c55e" });
  assert.deepEqual(line.marker.formatter({ yValue: 4 }), { size: 3 });

  const column = sparklineOptions({ type: "bar", options: { fill: "#6b7280", min: 0, max: 10 } });
  assert.equal(column.type, "column");
  assert.deepEqual(column.valueAxisDomain, [0, 10]);
  assert.equal(sparklineOptions({ type: "bar", options: { direction: "horizontal" } }).type, "bar");

  const pnl = sparklineOptions({ type: "bar", options: { customFormatter: "(p) => ({ fill: p.yValue >= 0 ? '#22c55e' : '#ef4444', fillOpacity: 0.5 })" } });
  assert.deepEqual(pnl.formatter({ yValue: -2 }), { fill: "rgba(239, 68, 68, 0.5)" });

  const area = sparklineOptions({ type: "area", options: { fill: "#2563eb", pointsOfInterest: { firstLast: { fill: "black" } } } });
  assert.equal(area.fill, "rgba(37, 99, 235, 0.3)");
  assert.equal(area.marker.formatter({ yValue: 1, last: true }).size, 5);
  assert.equal(area.marker.formatter({ yValue: 1 }).size, 0);
});

test("points of interest keep OpenBB's precedence", () => {
  const points = {
    positiveNegative: { positive: { fill: "g" }, negative: { fill: "r" } },
    firstLast: { fill: "fl" },
    maximum: { fill: "max" },
    highlighted: { fill: "hi" },
  };
  assert.equal(pointStyle(points, { yValue: -1 }).fill, "r");
  assert.equal(pointStyle(points, { yValue: 1, first: true }).fill, "fl");
  assert.equal(pointStyle(points, { yValue: 1, first: true, max: true }).fill, "max");
  assert.equal(pointStyle(points, { yValue: 1, max: true, highlighted: true }).fill, "hi");
  assert.deepEqual(sparklineData("[1,2]"), [1, 2]);
  assert.deepEqual(sparklineData({ values: [3] }), [3]);
});

test("templates fill from the cell object, then the row", () => {
  assert.equal(fillTemplate("### {value} (since {foundedDate})", { value: "Ethereum", foundedDate: "2015-07-30" }), "### Ethereum (since 2015-07-30)");
  assert.equal(fillTemplate("**{company}**: ${revenue}M, {missing}", { company: "TechCorp", revenue: 12 }), "**TechCorp**: $12M, {missing}");
});

test("markdown renders as nodes, not HTML", () => {
  const { document } = new JSDOM("").window;
  const node = renderMarkdown(document, "### Title\n**Description:** <img src=x onerror=alert(1)>\n- one\n- *two*");
  assert.equal(node.querySelector("h5").textContent, "Title");
  assert.equal(node.querySelector("strong").textContent, "Description:");
  assert.equal(node.querySelector("img"), null);
  assert.match(node.querySelector("p").textContent, /<img src=x/);
  assert.equal(node.querySelectorAll("li").length, 2);
  assert.equal(node.querySelector("li em").textContent, "two");
});

test("hover card tooltip shows title and markdown from the cell object", () => {
  const { document } = new JSDOM("").window;
  const card = new HoverCardTooltip();
  card.init({
    eGridCell: document.createElement("div"),
    colDef: { field: "name" },
    data: { name: { value: "Ethereum", description: "Smart contracts", foundedDate: "2015-07-30" } },
    hoverCard: { title: "Project Details", markdown: "### {value} (since {foundedDate})\n**Description:** {description}" },
  });
  const gui = card.getGui();
  assert.equal(gui.querySelector(".ag-table-chart-hover-card-title").textContent, "Project Details");
  assert.match(gui.textContent, /Ethereum \(since 2015-07-30\)/);
  assert.match(gui.textContent, /Smart contracts/);
});

test("columnsDefs map to colDefs with OpenBB's options", () => {
  const rows = [{ name: { value: "ethereum", description: "x" }, tvl: 45e9, change_1d: -0.5, history: [1, 2, 3] }];
  const [name, tvl, change, history] = agTableChartColumnDefs(rows, {
    columnsDefs: [
      { field: "name", headerName: "Asset", renderFn: "hoverCard", renderFnParams: { hoverCard: { cellField: "value" } }, width: 120, pinned: "left" },
      { field: "tvl", headerTooltip: "Total Value Locked", formatterFn: "int", renderFn: "columnColor", renderFnParams: { colorRules: [{ condition: "gt", value: 4e10, color: "green", fill: true }] } },
      { field: "change_1d", formatterFn: "percent", renderFn: ["greenRed", "showCellChange"], hide: true, align: "center" },
      { field: "history", sparkline: { type: "line" } },
    ],
  });
  assert.equal(name.valueGetter({ data: rows[0] }), "ethereum");
  assert.equal(name.flex, 0);
  assert.equal(name.width, 120);
  assert.equal(name.tooltipComponent, HoverCardTooltip);
  assert.equal(tvl.headerTooltip, "Total Value Locked");
  assert.deepEqual(tvl.cellStyle({ value: 45e9, data: rows[0] }), { color: "#ffffff", backgroundColor: "#16a34a" });
  assert.equal(change.hide, true);
  assert.equal(change.headerClass, "ag-table-chart-header-center");
  assert.equal(change.valueFormatter({ value: -0.5, context: en }), "-0.50%");
  assert.equal(change.cellStyle({ value: -0.5, data: rows[0] }).color, "#dc2626");
  assert.equal(change.cellClassRules["ag-table-chart-cell-down"]({ node: { id: "0" }, context: { changes: new Map([["0|change_1d", "down"]]) } }), true);
  assert.equal(history.cellRenderer, "agSparklineCellRenderer");
  assert.deepEqual(history.valueGetter({ data: rows[0] }), [1, 2, 3]);
  assert.equal(history.chartDataType, "excluded");
});

test("titleCase render function, table formatterFn and dates", () => {
  const rows = [{ name: "BITCOIN", w: 0.25, date: "2024-06-06" }];
  const [name, w, date] = agTableChartColumnDefs(rows, {
    formatterFn: "normalizedPercent",
    columnsDefs: [{ field: "name", renderFn: "titleCase", formatterFn: "none" }, { field: "w" }, { field: "date", chartDataType: "time" }],
  });
  assert.equal(name.valueFormatter({ value: "BITCOIN", context: en }), "Bitcoin");
  assert.equal(w.valueFormatter({ value: 0.25, context: en }), "25.00%");
  const parsed = date.valueGetter({ data: rows[0] });
  assert.ok(parsed instanceof Date);
  assert.equal(date.valueFormatter({ value: parsed, data: rows[0] }), "2024-06-06");
  assert.equal(date.filter, "agDateColumnFilter");
});

test("showAll adds undeclared fields unless it is false", () => {
  const rows = [{ a: 1, b: 2 }];
  assert.deepEqual(agTableChartColumnDefs(rows, { columnsDefs: [{ field: "a" }] }).map((c) => c.field), ["a", "b"]);
  assert.deepEqual(agTableChartColumnDefs(rows, { showAll: false, columnsDefs: [{ field: "a" }] }).map((c) => c.field), ["a"]);
});

test("cellOnClick runs the configured action", () => {
  const calls = [];
  const actions = {
    groupBy: (...a) => calls.push(["groupBy", ...a]),
    sendToAgent: (...a) => calls.push(["sendToAgent", ...a]),
    openUrl: (...a) => calls.push(["openUrl", ...a]),
  };
  const row = { symbol: "Microsoft", companyId: "MSFT", revenue: 12, url: "https://example.com/msft" };
  const click = (def) => toColDef(def, [row]).onCellClicked({ value: row[def.field], data: row, context: { actions } });
  click({ field: "symbol", renderFn: "cellOnClick", renderFnParams: { actionType: "groupBy", groupBy: { paramName: "symbol", valueField: "companyId", forceUpdate: true } } });
  click({ field: "revenue", renderFn: "cellOnClick", renderFnParams: { actionType: "sendToAgent", sendToAgent: { markdown: "Revenue ${revenue}M for {symbol}", agentId: "fa" } } });
  click({ field: "url", renderFn: "cellOnClick", renderFnParams: { actionType: "openUrl" } });
  assert.deepEqual(calls, [
    ["groupBy", "symbol", "MSFT", true],
    ["sendToAgent", "Revenue $12M for Microsoft", "fa"],
    ["openUrl", "https://example.com/msft"],
  ]);
  assert.deepEqual(renderFnsOf({ renderFn: ["cellOnClick", "nope"] }), ["cellOnClick"]);
});

test("changeTrackedColumns honours colorValueKey and enableCellChangeWs", () => {
  assert.deepEqual(changeTrackedColumns([
    { field: "symbol", renderFn: "showCellChange", renderFnParams: { colorValueKey: "price" } },
    { field: "price", renderFn: "showCellChange", enableCellChangeWs: false },
    { field: "volume" },
  ]), [{ field: "symbol", compareField: "price" }]);
});

test("ChartView picks chart types, columns and the navigator", () => {
  assert.equal(agChartType("column"), "groupedColumn");
  assert.equal(agChartType("heatmap"), "heatmap");
  assert.equal(agChartType("unknown"), "groupedColumn");
  const columns = [
    { id: "name", chartDataType: "category" },
    { id: "tvl", chartDataType: "series", numeric: true },
    { id: "spark", chartDataType: "excluded" },
    { id: "change", numeric: true },
    { id: "hidden", hide: true, numeric: true },
  ];
  assert.deepEqual(chartColumns(columns, {}, "line"), ["name", "tvl", "change"]);
  assert.deepEqual(chartColumns(columns, { cellRangeCols: { line: ["name", "change", "nope"] } }, "line"), ["name", "change"]);
  assert.deepEqual(chartColumns([{ id: "date", chartDataType: "time" }, { id: "eth", chartDataType: "series" }], {}, "line"), ["date", "eth"]);
  assert.deepEqual(navigatorOverrides({ chartNavigatorEnabled: true, chartMiniChartEnabled: true }, "line"), { common: { navigator: { enabled: true, miniChart: { enabled: true } } } });
  assert.equal(navigatorOverrides({ chartNavigatorEnabled: true }, "pie"), undefined);
  assert.equal(navigatorOverrides({}, "line"), undefined);
});
