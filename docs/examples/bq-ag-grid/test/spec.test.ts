import { describe, expect, it } from "vitest";
import manifest from "../src/plugin.json";
import {
  COLUMN_GROUP_KEYS,
  COLUMN_KEYS,
  DEFAULT_COLUMN_KEYS,
  GRID_OPTION_KEYS,
  type GridSpec,
  groupingOf,
  headerOf,
  inferColumns,
  readSpec,
  typeOf,
} from "../src/spec";

const ok = (response: unknown, definition?: unknown): GridSpec & { warnings: string[] } => {
  const parsed = readSpec(response, definition);
  if (!parsed.ok) throw new Error(parsed.message);
  return { ...parsed.spec, warnings: parsed.warnings };
};

describe("readSpec", () => {
  it("takes rows and infers their columns and types", () => {
    const spec = ok([
      { name: "Acme", revenue: 1.5, listed: true, founded: "1999-04-01", tags: ["a"] },
      { name: "Bolt", revenue: null, region: "EMEA" },
    ]);
    expect(spec.inferred).toBe(true);
    expect(spec.columnDefs).toEqual([
      { field: "name", cellDataType: "text" },
      { field: "revenue", cellDataType: "number" },
      { field: "listed", cellDataType: "boolean" },
      { field: "founded", cellDataType: "dateString" },
      { field: "tags", cellDataType: "object" },
      { field: "region", cellDataType: "text" },
    ]);
  });

  it("takes a grid in AG Grid's names, and types the columns it leaves untyped", () => {
    const spec = ok({
      rowData: [{ a: 1, b: "x" }],
      columnDefs: [{ field: "a", headerName: "A", aggFunc: "sum" }, { headerName: "Group", children: [{ field: "b" }] }],
      gridOptions: { pagination: true, paginationPageSize: 25 },
    });
    expect(spec.inferred).toBe(false);
    expect(spec.columnDefs).toEqual([
      { field: "a", headerName: "A", aggFunc: "sum", cellDataType: "number" },
      { headerName: "Group", children: [{ field: "b", cellDataType: "text" }] },
    ]);
    expect(spec.gridOptions).toEqual({ pagination: true, paginationPageSize: 25 });
    expect(spec.warnings).toEqual([]);
  });

  it("uses the definition's columns and options, and lets the response override them", () => {
    const definition = {
      columnDefs: [{ field: "a", headerName: "From the definition" }],
      gridOptions: { pagination: true, defaultColDef: { floatingFilter: true, minWidth: 80 } },
    };
    const rows = ok([{ a: 1 }], definition);
    expect(rows.columnDefs).toEqual([{ field: "a", headerName: "From the definition", cellDataType: "number" }]);
    expect(rows.gridOptions.pagination).toBe(true);

    const grid = ok(
      {
        rowData: [{ a: 1 }],
        columnDefs: [{ field: "a", headerName: "From the response" }],
        gridOptions: { pagination: false, defaultColDef: { minWidth: 120 } },
      },
      definition,
    );
    expect(grid.columnDefs[0]).toMatchObject({ headerName: "From the response" });
    expect(grid.gridOptions).toEqual({ pagination: false, defaultColDef: { floatingFilter: true, minWidth: 120 } });
  });

  it("drops what it does not support, and says so", () => {
    const spec = ok({
      rowData: [{ a: 1 }],
      columnDefs: [
        { field: "a", valueFormatter: "x => x * 2", width: 5, valueFormat: { style: "currency", currency: "usd" } },
        { headerName: "no field" },
      ],
      gridOptions: { getRowId: "id", pagination: "yes" },
      extra: 1,
    });
    expect(spec.columnDefs).toEqual([
      { field: "a", valueFormat: { style: "currency" }, cellDataType: "number" },
    ]);
    expect(spec.gridOptions).toEqual({});
    expect(spec.warnings).toEqual([
      "response: extra is not supported",
      "response.columnDefs[0]: valueFormatter is not supported",
      "response.columnDefs[0]: width has a value that is not supported",
      "response.columnDefs[0].valueFormat: currency has a value that is not supported",
      "response.columnDefs[1]: a column needs a field",
      "response.gridOptions: getRowId is not supported",
      "response.gridOptions: pagination has a value that is not supported",
    ]);
  });

  it("refuses what is neither rows nor a grid", () => {
    for (const response of [{ rows: [] }, "rows", [1, 2], { rowData: [1] }]) {
      expect(readSpec(response, null)).toMatchObject({ ok: false });
    }
  });
});

describe("typeOf", () => {
  it("names the type every present value has, else text", () => {
    expect(typeOf([1, null, 2.5])).toBe("number");
    expect(typeOf([1, "2"])).toBe("text");
    expect(typeOf(["2024-01-31", ""])).toBe("dateString");
    expect(typeOf(["2024-01-31T10:00:00Z"])).toBe("text");
    expect(typeOf([null, undefined])).toBe("text");
    expect(typeOf([{ a: 1 }, [1]])).toBe("object");
  });

  it("reads the keys in the order first seen", () => {
    expect(inferColumns([{ b: 1 }, { a: 1, b: 2 }]).map((c) => c.field)).toEqual(["b", "a"]);
  });
});

describe("groupingOf", () => {
  it("groups inferred text columns and sums inferred numbers", () => {
    const grouping = groupingOf(ok([{ name: "a", region: "x", revenue: 1, listed: true }]));
    expect(grouping.groupable.map((c) => c.field)).toEqual(["name", "region", "listed"]);
    expect(grouping.measures).toEqual([{ field: "revenue", aggFunc: "sum" }]);
    expect(grouping.initial).toEqual([]);
  });

  it("reads AG Grid's grouping keys from declared columns", () => {
    const grouping = groupingOf(
      ok({
        rowData: [{ a: "x", b: "y", c: 1, d: 2 }],
        columnDefs: [
          { field: "a", enableRowGroup: true, rowGroup: true, rowGroupIndex: 1 },
          { field: "b", rowGroup: true, rowGroupIndex: 0 },
          { field: "c", aggFunc: "avg" },
          { field: "d" },
        ],
      }),
    );
    expect(grouping.groupable.map((c) => c.field)).toEqual(["a", "b"]);
    expect(grouping.measures).toEqual([{ field: "c", aggFunc: "avg" }]);
    expect(grouping.initial).toEqual(["b", "a"]);
    expect(grouping.pivotable).toEqual([]);
  });

  it("reads AG Grid's pivot keys from declared columns, and pivots inferred ones as they group", () => {
    const grouping = groupingOf(
      ok({
        rowData: [{ a: "x", b: "y", c: 1 }],
        columnDefs: [
          { field: "a", enablePivot: true, pivot: true, pivotIndex: 1 },
          { field: "b", pivot: true, pivotIndex: 0 },
          { field: "c", aggFunc: "sum" },
        ],
        gridOptions: { pivotMode: true },
      }),
    );
    expect(grouping.pivotable.map((c) => c.field)).toEqual(["a", "b"]);
    expect(grouping.initialPivot).toEqual(["b", "a"]);
    expect(groupingOf(ok([{ name: "a", revenue: 1 }])).pivotable.map((c) => c.field)).toEqual(["name"]);
  });
});

describe("headerOf", () => {
  it("writes a field in words, as AG Grid does", () => {
    expect(headerOf({ field: "revenueUsdM" })).toBe("Revenue Usd M");
    expect(headerOf({ field: "founded_year" })).toBe("Founded Year");
    expect(headerOf({ field: "x", headerName: "Given" })).toBe("Given");
  });
});

describe("plugin.json", () => {
  // The manifest's definition is what Workspace checks a backend's data["bq-ag-grid"] against;
  // the code reads the same keys from a response. They must agree.
  const defs = manifest.contributes.widgets[0].handles[0].definition.$defs;
  const keys = (schema: { properties: object }) => Object.keys(schema.properties).sort();

  it("declares the keys the code reads", () => {
    expect(keys(defs.column)).toEqual(Object.keys(COLUMN_KEYS).sort());
    expect(keys(defs.columnGroup)).toEqual([...COLUMN_GROUP_KEYS].sort());
    expect(keys(defs.gridOptions)).toEqual(Object.keys(GRID_OPTION_KEYS).sort());
    expect(keys(defs.gridOptions.properties.defaultColDef)).toEqual(Object.keys(DEFAULT_COLUMN_KEYS).sort());
  });
});
