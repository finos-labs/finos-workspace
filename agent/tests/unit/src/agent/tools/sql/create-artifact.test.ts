import { describe, it } from "node:test";
import { expect } from "expect";
import {
  createArtifactDescription,
  createArtifactSchema,
  runCreateArtifact,
} from "../../../../../../src/agent/tools/sql/create-artifact.ts";
import type { SSEEvent } from "../../../../../../src/protocol/types.ts";

const prices = [
  { symbol: "NVDA", close: 100 },
  { symbol: "AAPL", close: 200 },
];

const energyRows = [
  { Year: 2020, Energy_Total_MWh: 980000, Renewable_Energy_Percent: 12 },
  { Year: 2021, Energy_Total_MWh: 964320, Renewable_Energy_Percent: 17.75 },
];

function ctx(tables: Record<string, Record<string, unknown>[]> = {}) {
  return {
    pendingTables: new Map(Object.entries(tables)),
    artifactQueue: [] as SSEEvent[],
  };
}

// The FINOS Workspace has no table artifact, so a table is an HTML artifact; these read it back.
function cells(html: string, tag: "th" | "td"): string[] {
  return [...html.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "g"))].map((m) => m[1]);
}

function lastArtifactPayload(queue: SSEEvent[]) {
  expect(queue.length).toBeGreaterThan(0);
  const e = queue[queue.length - 1];
  expect(e.event).toBe("copilotMessageArtifact");
  return e.data;
}

describe("runCreateArtifact — guards", () => {
  it("tells the model to provide exactly one source field", () => {
    expect(createArtifactDescription).toContain("If you use `sql`, omit `from_table_id` and `data`");
    expect(createArtifactDescription).toContain("If you use `from_table_id`, omit `sql` and `data`");
    expect(createArtifactDescription).toContain("After a successful create_artifact call, do not call create_artifact again");
  });

  it("requires one of sql, data, or from_table_id", () => {
    const c = ctx();
    const text = runCreateArtifact(
      { artifact: { type: "table", name: "T", description: "d" } },
      c,
    );
    expect(text).toContain("provide one of");
    expect(c.artifactQueue.length).toBe(0);
  });

  it("rejects multiple source kinds at once", () => {
    const c = ctx({ prices });
    const text = runCreateArtifact(
      {
        data: prices,
        from_table_id: "prices",
        artifact: { type: "table", name: "T", description: "d" },
      },
      c,
    );
    expect(text).toContain("exactly one");
    expect(c.artifactQueue.length).toBe(0);
  });

  it("rejects from_table_id when SQL is provided", () => {
    const c = ctx({ prices });
    const text = runCreateArtifact(
      {
        sql: "SELECT symbol, close FROM prices",
        from_table_id: "prices",
        artifact: { type: "table", name: "T", description: "d" },
      },
      c,
    );

    expect(text).toContain("exactly one");
    expect(c.artifactQueue.length).toBe(0);
  });

  it("accepts data:null with SQL and treats null as absent", () => {
    const parsed = createArtifactSchema.safeParse({
      sql: "SELECT * FROM prices",
      data: null,
      artifact: { type: "table", name: "T", description: "d" },
    });
    expect(parsed.success).toBe(true);

    const c = ctx({ prices });
    const text = runCreateArtifact(
      {
        sql: "SELECT * FROM prices",
        data: null,
        artifact: { type: "table", name: "T", description: "d" },
      },
      c,
    );
    expect(text).toContain("Created table artifact");
    expect(c.artifactQueue.length).toBe(1);
  });

  it("accepts null SQL/from_table_id placeholders and treats them as absent", () => {
    const parsed = createArtifactSchema.safeParse({
      sql: null,
      from_table_id: null,
      data: prices,
      artifact: { type: "table", name: "T", description: "d" },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.sql).toBeUndefined();
    expect(parsed.data.from_table_id).toBeUndefined();

    const c = ctx();
    const text = runCreateArtifact(parsed.data, c);
    expect(text).toContain("Created table artifact");
    expect(c.artifactQueue.length).toBe(1);
  });

  it("ignores empty data when SQL is provided", () => {
    const c = ctx({ prices });
    const text = runCreateArtifact(
      {
        sql: "SELECT * FROM prices",
        data: [],
        artifact: { type: "table", name: "T", description: "d" },
      },
      c,
    );
    expect(text).toContain("Created table artifact");
    expect(c.artifactQueue.length).toBe(1);
  });

  it("errors with a helpful message when from_table_id is unknown", () => {
    const c = ctx({ prices });
    const text = runCreateArtifact(
      {
        from_table_id: "missing",
        artifact: { type: "table", name: "T", description: "d" },
      },
      c,
    );
    // Internal state names must not leak into tool output — the model echoes
    // them back to the user. Route through the shared not-found contract.
    expect(text).not.toContain("pendingTables");
    expect(text).toContain('Table "missing" not loaded');
    expect(text).toContain("prices");
    expect(text).toContain("call get_widget_data");
    expect(c.artifactQueue.length).toBe(0);
  });

  it("rejects non-SELECT/WITH SQL", () => {
    const c = ctx({ prices });
    const text = runCreateArtifact(
      {
        sql: "DELETE FROM prices",
        artifact: { type: "table", name: "T", description: "d" },
      },
      c,
    );
    expect(text).toContain("only SELECT or WITH");
    expect(c.artifactQueue.length).toBe(0);
  });

  it("accepts leading SQL comments before SELECT", () => {
    const c = ctx({ prices });
    const text = runCreateArtifact(
      {
        sql: "-- Show all prices\nSELECT * FROM prices",
        artifact: { type: "table", name: "T", description: "d" },
      },
      c,
    );
    expect(text).toContain("Created table artifact");
    expect(c.artifactQueue.length).toBe(1);
  });

  it("returns a no-rows message when SQL produces nothing", () => {
    const c = ctx({ prices });
    const text = runCreateArtifact(
      {
        sql: "SELECT * FROM prices WHERE close > 999999",
        artifact: { type: "table", name: "T", description: "d" },
      },
      c,
    );
    expect(text).toContain("No rows");
    expect(c.artifactQueue.length).toBe(0);
  });

  it("returns a no-rows message when data is an empty array", () => {
    const c = ctx();
    const text = runCreateArtifact(
      { data: [], artifact: { type: "table", name: "T", description: "d" } },
      c,
    );
    expect(text).toContain("No rows");
    expect(c.artifactQueue.length).toBe(0);
  });

  it("returns a SQL error message on bad query without pushing an artifact", () => {
    const c = ctx({ prices });
    const text = runCreateArtifact(
      {
        sql: "SELECT * FROM nope",
        artifact: { type: "table", name: "T", description: "d" },
      },
      c,
    );
    expect(text).toContain("SQL error");
    expect(c.artifactQueue.length).toBe(0);
  });

  it("returns raw missing-table SQL errors", () => {
    const c = ctx({ prices });
    const text = runCreateArtifact(
      {
        sql: "SELECT * FROM change",
        artifact: { type: "table", name: "T", description: "d" },
      },
      c,
    );

    expect(text).toContain("SQL error");
    expect(text).toContain("no such table: change");
    expect(text).not.toContain("execute_sql result sets");
    expect(text).not.toContain("include the full WITH query");
    expect(c.artifactQueue.length).toBe(0);
  });

  it("does not repair metric-table value columns when SQL selects the table name", () => {
    const c = ctx({
      ctx_unrate_series: [
        { date: "2024-01-01", unrate: 3.7 },
        { date: "2024-02-01", unrate: 3.8 },
      ],
      cpi: [
        { date: "2024-01-01", country: "united_states", value: 0.031 },
        { date: "2024-02-01", country: "united_states", value: 0.032 },
      ],
    });

    const text = runCreateArtifact(
      {
        sql: "SELECT date, unrate, cpi FROM ctx_unrate_series JOIN cpi USING(date)",
        artifact: { type: "table", name: "UNRATE vs CPI", description: "Unemployment versus CPI" },
      },
      c,
    );

    expect(text).toContain("SQL error");
    expect(text).toContain("no such column: cpi");
    expect(c.artifactQueue.length).toBe(0);
  });

  it("returns raw SQLite compound SELECT ORDER BY errors", () => {
    const c = ctx({ years: [{ year: 2020 }, { year: 2021 }] });
    const text = runCreateArtifact(
      {
        sql:
          "SELECT year FROM years " +
          "UNION ALL SELECT 'Overall' AS year " +
          "ORDER BY CASE WHEN year = 'Overall' THEN 999 ELSE CAST(year AS INTEGER) END",
        artifact: { type: "table", name: "T", description: "d" },
      },
      c,
    );

    expect(text).toContain("SQL error");
    expect(text).toContain("ORDER BY");
    expect(text).not.toContain("wrap the compound query");
    expect(c.artifactQueue.length).toBe(0);
  });

  it("returns raw date_trunc errors", () => {
    const c = ctx({ dates: [{ date: "2024-01-01" }] });
    const text = runCreateArtifact(
      {
        sql: "SELECT date_trunc('quarter', date) AS quarter FROM dates",
        artifact: { type: "table", name: "T", description: "d" },
      },
      c,
    );

    expect(text).toContain("SQL error");
    expect(text).toContain("no such function: date_trunc");
    expect(text).not.toContain("SQLite does not support date_trunc");
    expect(text).not.toContain("substr(date, 1, 4)");
    expect(c.artifactQueue.length).toBe(0);
  });

  it("lists loaded columns when SQL references a missing column", () => {
    const c = ctx({
      ctx_unrate_series: [{ date: "2024-01-01", unrate: 3.9 }],
      cpi: [{ date: "2024-01-01", country: "united_states", value: 310.3 }],
    });
    const text = runCreateArtifact(
      {
        sql: "SELECT date, unrate, cpi AS cpi_value FROM ctx_unrate_series JOIN cpi USING(date)",
        artifact: { type: "table", name: "UNRATE vs CPI", description: "d" },
      },
      c,
    );

    expect(text).toContain("SQL error: no such column: cpi");
    expect(text).toContain('"cpi" (1 rows; columns: "date", "country", "value")');
    expect(text).toContain('"ctx_unrate_series" (1 rows; columns: "date", "unrate")');
    expect(c.artifactQueue.length).toBe(0);
  });
});

describe("runCreateArtifact — table happy path", () => {
  it("pushes an html table artifact onto the queue from SQL rows", () => {
    const c = ctx({ prices });
    const text = runCreateArtifact(
      {
        sql: "SELECT * FROM prices",
        artifact: { type: "table", name: "Top Closes", description: "test" },
      },
      c,
    );
    expect(text).toContain("Created table artifact");
    const artifact = lastArtifactPayload(c.artifactQueue) as {
      type: string;
      name: string;
      content: string;
    };
    expect(artifact.type).toBe("html");
    expect(artifact.name).toBe("Top Closes");
    expect(cells(artifact.content, "th")).toEqual(["symbol", "close"]);
    expect(cells(artifact.content, "td")).toEqual(["NVDA", "100", "AAPL", "200"]);
  });

  it("pushes a table from inline data", () => {
    const c = ctx();
    runCreateArtifact(
      { data: prices, artifact: { type: "table", name: "Inline", description: "" } },
      c,
    );
    const artifact = lastArtifactPayload(c.artifactQueue) as { content: string };
    expect(cells(artifact.content, "td")).toEqual(["NVDA", "100", "AAPL", "200"]);
  });

  it("truncates rows over 500", () => {
    const big = Array.from({ length: 600 }, (_, i) => ({ id: i }));
    const c = ctx();
    runCreateArtifact(
      { data: big, artifact: { type: "table", name: "Big", description: "" } },
      c,
    );
    const artifact = lastArtifactPayload(c.artifactQueue) as { content: string };
    expect(cells(artifact.content, "td").length).toBe(500);
  });

  it("renders a table from from_table_id without running any SQL", () => {
    const c = ctx({ prices });
    const text = runCreateArtifact(
      {
        from_table_id: "prices",
        artifact: { type: "table", name: "From table", description: "by id" },
      },
      c,
    );
    expect(text).toContain("Created table artifact");
    const artifact = lastArtifactPayload(c.artifactQueue) as { type: string; content: string };
    expect(artifact.type).toBe("html");
    expect(cells(artifact.content, "td")).toEqual(["NVDA", "100", "AAPL", "200"]);
  });

  it("renders from_table_id rows with the same sanitized column shape as SQL", () => {
    const c = ctx({ energy_consumption__renewables_and_revenue: energyRows });
    runCreateArtifact(
      {
        from_table_id: "energy_consumption__renewables_and_revenue",
        artifact: { type: "table", name: "Renewable Energy", description: "trend" },
      },
      c,
    );
    const artifact = lastArtifactPayload(c.artifactQueue) as { content: string };
    expect(cells(artifact.content, "th")).toEqual([
      "year",
      "energy_total_mwh",
      "renewable_energy_percent",
    ]);
    expect(cells(artifact.content, "td").slice(0, 3)).toEqual(["2020", "980000", "12"]);
  });

  it("escapes cell values so row data cannot inject markup", () => {
    const c = ctx();
    runCreateArtifact(
      { data: [{ note: "<script>alert(1)</script>" }], artifact: { type: "table", name: "X", description: "" } },
      c,
    );
    const artifact = lastArtifactPayload(c.artifactQueue) as { content: string };
    expect(artifact.content).not.toContain("<script>alert");
    expect(artifact.content).toContain("&lt;script&gt;");
  });
});

describe("createArtifactDescription", () => {
  it("says it draws tables only and where charts go", () => {
    expect(createArtifactDescription).toContain("tables only");
    expect(createArtifactDescription).toContain("create_html_artifact");
    expect(createArtifactDescription).toContain("html-chart");
    expect(createArtifactDescription).not.toContain("chartType");
    expect(createArtifactDescription).toContain("Do not switch to `data` unless you are passing raw row objects");
    expect(createArtifactDescription).toContain("Call peek_table before this tool");
    expect(createArtifactDescription).toContain("execute_sql result sets and CTE aliases are not persistent tables");
  });
});
