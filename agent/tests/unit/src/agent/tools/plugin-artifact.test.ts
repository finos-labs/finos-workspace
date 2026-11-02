import { describe, it } from "node:test";
import { expect } from "expect";
import {
  pluginArtifactSchema,
  runPluginArtifact,
} from "../../../../../src/agent/tools/plugin-artifact.ts";
import type { PluginArtifact, PluginArtifactEntry, SSEEvent } from "../../../../../src/protocol/types.ts";

const bars: PluginArtifactEntry = {
  plugin: "chart-kit",
  widget: "bars",
  name: "Bars",
  description: "Bars of x labels and y values",
  data_schema: {
    type: "object",
    additionalProperties: false,
    required: ["rows"],
    properties: {
      title: { type: "string" },
      rows: {
        type: "array",
        items: {
          type: "object",
          required: ["x", "y"],
          properties: { x: { type: "string" }, y: { type: "number" } },
        },
      },
    },
  },
  config_schema: { type: "object", properties: { color: { type: "string", enum: ["red", "blue"] } } },
};
const plain: PluginArtifactEntry = { ...bars, widget: "plain", config_schema: undefined };

function ctx(tables: [string, Record<string, unknown>[]][] = []) {
  const artifactQueue: SSEEvent[] = [];
  return { catalog: [bars, plain], pendingTables: new Map(tables), artifactQueue };
}

const shown = (context: ReturnType<typeof ctx>) =>
  context.artifactQueue.map((e) => e.data as unknown as PluginArtifact);

describe("runPluginArtifact", () => {
  it("shows the component with the data the model gave, as a plugin artifact", () => {
    const context = ctx();
    const out = runPluginArtifact(
      {
        component: "chart-kit/bars",
        name: "Sales",
        data: { title: "By month", rows: [{ x: "jan", y: 3 }] },
        config: { color: "red" },
      },
      context,
    );

    expect(out).toContain("Showed Bars");
    expect(context.artifactQueue[0].event).toBe("copilotMessageArtifact");
    const [artifact] = shown(context);
    expect(artifact).toMatchObject({
      type: "plugin",
      name: "Sales",
      description: "Bars",
      plugin: { id: "chart-kit", widget: "bars" },
      data: { title: "By month", rows: [{ x: "jan", y: 3 }] },
      config: { color: "red" },
    });
    expect(artifact.uuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("fills a property of the data with the rows of a loaded table", () => {
    const context = ctx([["sales", [{ x: "jan", y: 3 }, { x: "feb", y: 5 }]]]);
    const out = runPluginArtifact(
      { component: "chart-kit/bars", name: "Sales", data: { title: "t" }, sql: "SELECT x, y FROM sales ORDER BY y DESC", rows_key: "rows" },
      context,
    );

    expect(out).toContain("Showed Bars");
    expect(shown(context)[0].data).toEqual({ title: "t", rows: [{ x: "feb", y: 5 }, { x: "jan", y: 3 }] });
  });

  it("takes a loaded table as it is", () => {
    const context = ctx([["sales", [{ x: "jan", y: 3 }]]]);
    runPluginArtifact({ component: "chart-kit/bars", name: "S", from_table_id: "sales", rows_key: "rows" }, context);
    expect(shown(context)[0].data).toEqual({ rows: [{ x: "jan", y: 3 }] });
  });

  it("drops what the schema does not name, so only declared data reaches the page", () => {
    const context = ctx();
    runPluginArtifact(
      { component: "chart-kit/bars", name: "S", data: { rows: [{ x: "a", y: 1, secret: "token" }], extra: 1 } },
      context,
    );
    expect(shown(context)[0].data).toEqual({ rows: [{ x: "a", y: 1 }] });
  });

  it("refuses an unknown component and lists the known ones", () => {
    const context = ctx();
    const out = runPluginArtifact({ component: "chart-kit/pie", name: "S", data: { rows: [] } }, context);
    expect(out).toContain("unknown component");
    expect(out).toContain("chart-kit/bars");
    expect(context.artifactQueue).toHaveLength(0);
  });

  it("tells the model what is wrong with the data and what the schema is", () => {
    const context = ctx();
    const out = runPluginArtifact({ component: "chart-kit/bars", name: "S", data: { rows: [{ x: "a", y: "high" }] } }, context);
    expect(out).toContain("does not match the schema");
    expect(out).toContain("rows.0.y");
    expect(out).toContain('"required":["rows"]');
    expect(context.artifactQueue).toHaveLength(0);
  });

  it("refuses data that is too large", () => {
    const context = ctx();
    const rows = Array.from({ length: 6_000 }, (_, i) => ({ x: `label-${i}`.padEnd(60, "x"), y: i }));
    const out = runPluginArtifact({ component: "chart-kit/bars", name: "S", data: { rows } }, context);
    expect(out).toContain("byte limit");
    expect(context.artifactQueue).toHaveLength(0);
  });

  it("checks the config, and refuses one for a component that takes none", () => {
    const context = ctx();
    expect(
      runPluginArtifact({ component: "chart-kit/bars", name: "S", data: { rows: [] }, config: { color: "green" } }, context),
    ).toContain("config does not match");
    expect(
      runPluginArtifact({ component: "chart-kit/plain", name: "S", data: { rows: [] }, config: { color: "red" } }, context),
    ).toContain("takes no config");
    expect(context.artifactQueue).toHaveLength(0);
  });

  it("refuses misuse of the row sources", () => {
    const context = ctx([["sales", [{ x: "a", y: 1 }]]]);
    const base = { component: "chart-kit/bars", name: "S" };
    expect(runPluginArtifact({ ...base, sql: "SELECT * FROM sales" }, context)).toContain("rows_key");
    expect(runPluginArtifact({ ...base, data: { rows: [] }, rows_key: "rows" }, context)).toContain("goes with");
    expect(
      runPluginArtifact({ ...base, sql: "SELECT * FROM sales", from_table_id: "sales", rows_key: "rows" }, context),
    ).toContain("not both");
    expect(runPluginArtifact({ ...base, sql: "DROP TABLE sales", rows_key: "rows" }, context)).toContain("SELECT");
    expect(runPluginArtifact({ ...base, from_table_id: "nope", rows_key: "rows" }, context)).toContain("nope");
    expect(context.artifactQueue).toHaveLength(0);
  });
});

describe("pluginArtifactSchema", () => {
  it("offers only the components of the request, each with what it is for and the data it takes", () => {
    const schema = pluginArtifactSchema([bars, plain]);
    const component = schema.shape.component;
    expect(component.options).toEqual(["chart-kit/bars", "chart-kit/plain"]);
    expect(component.description).toContain("Bars of x labels and y values");
    expect(component.description).toContain('"required":["rows"]');
    expect(component.description).toContain("Its config:");
    expect(schema.safeParse({ component: "chart-kit/pie", name: "S" }).success).toBe(false);
  });
});
