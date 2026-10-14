// The widget's exports and agent context, against a model with fixed traits. Drawing
// needs a browser and is checked on a Workspace dashboard (README.md).
import assert from "node:assert/strict";
import { test } from "node:test";

// Nothing is drawn outside a browser, so the module finds no chart
globalThis.document = { querySelector: () => null };
const { default: widget } = await import("../src/widget.js");

function start(data) {
  const model = { get: (name) => structuredClone({ data }[name]), on() {} };
  return widget.initialize({ model });
}

/** A typed array as plotly.py writes a numpy array. */
function typed(Type, dtype, values, shape) {
  const bdata = Buffer.from(new Type(values).buffer).toString("base64");
  return shape ? { dtype, bdata, shape } : { dtype, bdata };
}

const SALES = {
  data: [
    { type: "bar", name: "emea", x: ["Jan", "Feb"], y: [100, 114] },
    { type: "bar", name: "apac", x: ["Jan", "Feb"], y: [105, 104] },
  ],
  layout: { title: { text: "Sales" }, xaxis: { title: { text: "month" } }, template: { layout: { paper_bgcolor: "white" } } },
};

test("traces sharing x values export one row per x", async () => {
  const sales = start(SALES);
  assert.equal(await sales.exportData("csv"), "month,emea,apac\nJan,100,105\nFeb,114,104");
});

test("the figure is exported as the backend returned it", async () => {
  const sales = start(SALES);
  assert.deepEqual(JSON.parse(await sales.exportData("figure")), SALES);
});

test("the agent gets the title and each trace's size and range", async () => {
  assert.deepEqual(await start(SALES).copilotContext(), {
    title: "Sales",
    traces: [
      { name: "emea", type: "bar", points: 2, min: 100, max: 114 },
      { name: "apac", type: "bar", points: 2, min: 104, max: 105 },
    ],
  });
});

test("typed arrays are read as plotly.py writes them", async () => {
  const signal = start({
    data: [
      { type: "scatter", name: 'a, "quoted"', x: typed(Float64Array, "f8", [0, 0.5]), y: typed(Int32Array, "i4", [1, -2]) },
      { type: "scatter", name: "b", x: [0.25], y: [3] },
    ],
    layout: { xaxis: { title: "t" }, yaxis: { title: { text: "value" } } },
  });
  assert.equal(await signal.exportData("csv"), 'trace,t,value\n"a, ""quoted""",0,1\n"a, ""quoted""",0.5,-2\nb,0.25,3');
  assert.deepEqual((await signal.copilotContext()).traces[0], { name: 'a, "quoted"', type: "scatter", points: 2, min: -2, max: 1 });
});

test("a pie exports its labels and values; y without x is indexed", async () => {
  assert.equal(
    await start({ data: [{ type: "pie", name: "share", labels: ["a", "b"], values: [3, 1] }] }).exportData("csv"),
    "x,share\na,3\nb,1",
  );
  assert.equal(await start({ data: [{ name: "n", y: [5, 6] }] }).exportData("csv"), "x,n\n0,5\n1,6");
});

test("a heatmap has no CSV; its range comes from z", async () => {
  const heatmap = start({
    data: [{ type: "heatmap", x: ["a", "b"], y: ["a", "b"], z: typed(Float64Array, "f8", [1, -0.5, -0.5, 1], "2, 2") }],
    layout: { title: "Correlation" },
  });
  assert.deepEqual((await heatmap.exportOptions()).map((o) => o.id), ["figure"]);
  assert.equal(await heatmap.exportData("csv"), null);
  assert.deepEqual(await heatmap.copilotContext(), {
    title: "Correlation",
    traces: [{ name: null, type: "heatmap", points: 4, min: -0.5, max: 1 }],
  });
});

test("the SVG is offered only once the chart is drawn", async () => {
  const sales = start(SALES);
  assert.deepEqual((await sales.exportOptions()).map((o) => o.id), ["csv", "figure"]);
  assert.equal(await sales.exportData("svg"), null);
  assert.equal(await sales.exportData("anything else"), null);
});

test("a response that is not a figure: nothing to export, nothing for the agent", async () => {
  for (const data of [[{ month: "Jan", sales: 1 }], "{\"data\": []}", { layout: {} }, null]) {
    const other = start(data);
    assert.deepEqual(await other.exportOptions(), []);
    assert.equal(await other.exportData("figure"), null);
    assert.equal(await other.copilotContext(), null);
  }
});
