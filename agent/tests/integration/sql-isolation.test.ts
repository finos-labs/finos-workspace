/**
 * Tier 2 — what the model writes as SQL cannot stop the agent.
 *
 * The SQL tools run in a child process that is killed when its time is up (src/agent/tools/sql/isolated.ts).
 * These tests send the queries that used to freeze the whole process, and check that the agent goes on
 * answering and that the model is told what happened.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { makeSqlTools } from "../../src/agent/tools/sql";
import type { SSEEvent } from "../../src/protocol/types";

type Tools = ReturnType<typeof makeSqlTools>;

function tools(rows: Record<string, unknown>[] = [{ a: 1 }, { a: 2 }, { a: 3 }]) {
  const artifactQueue: SSEEvent[] = [];
  const pendingTables = new Map<string, Record<string, unknown>[]>([["t", rows]]);
  const set: Tools = makeSqlTools({ pendingTables, artifactQueue });
  const call = async (name: string, args: unknown) =>
    String(await (set[name] as unknown as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(args, { toolCallId: "1", messages: [] }));
  return { call, artifactQueue };
}

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.INES_SQL_TIMEOUT_MS;
  process.env.INES_SQL_TIMEOUT_MS = "1500";
});
afterEach(() => {
  if (saved === undefined) delete process.env.INES_SQL_TIMEOUT_MS;
  else process.env.INES_SQL_TIMEOUT_MS = saved;
});

async function whileRunning<T>(work: () => Promise<T>): Promise<{ result: T; beats: number; ms: number }> {
  let beats = 0;
  const timer = setInterval(() => beats++, 50);
  const started = Date.now();
  try {
    return { result: await work(), beats, ms: Date.now() - started };
  } finally {
    clearInterval(timer);
  }
}

describe("a query that never ends", () => {
  it("is stopped, the model is told, and the agent goes on answering meanwhile", async () => {
    const { call } = tools();
    const { result, beats, ms } = await whileRunning(() =>
      call("execute_sql", { sql: "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r) SELECT count(*) FROM r" }),
    );
    expect(result).toContain("was stopped");
    expect(result).toContain("Make it cheaper");
    expect(ms).toBeLessThan(6_000);
    // A process that was blocked would have beaten a few times at most; 1.5 s is ~30 beats.
    expect(beats).toBeGreaterThan(10);
  });

  it("is stopped when it is a join of a table with itself many times", async () => {
    const { call } = tools(Array.from({ length: 100 }, (_, i) => ({ a: i })));
    const sql = "SELECT count(*) FROM t a, t b, t c, t d, t e, t f, t g, t h, t i, t j";
    const { result } = await whileRunning(() => call("execute_sql", { sql }));
    expect(result).toContain("was stopped");
  });

  it("is stopped through create_artifact too, and no artifact is made", async () => {
    const { call, artifactQueue } = tools();
    const result = await call("create_artifact", {
      sql: "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r) SELECT n FROM r ORDER BY n DESC",
      artifact: { type: "table", name: "x", description: "x" },
    });
    expect(result).toContain("was stopped");
    expect(artifactQueue).toHaveLength(0);
  });

  it("does not hold up another user's query that runs at the same time", async () => {
    const stuck = tools();
    const other = tools();
    const runaway = stuck.call("execute_sql", { sql: "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r) SELECT count(*) FROM r" });
    const started = Date.now();
    const answer = await other.call("execute_sql", { sql: "SELECT sum(a) AS total FROM t" });
    expect(answer).toContain('"total": 6');
    expect(Date.now() - started).toBeLessThan(1_200);
    await runaway;
  });
});

describe("a query that wants more memory than there is", () => {
  /**
   * What ends these queries has to be the heap limit (`SQL_HEAP_LIMIT_BYTES`, 512 MB), not the clock.
   * The 1.5 s the other tests here use is enough time to reach that limit on a fast machine and not
   * on a slow one, so with it these tests assert "out of memory" on one machine and read the timeout
   * message on another — which is what they did on CI. The time limit has its own tests above; here
   * it is set out of the way so that only running out of memory can end the query.
   */
  beforeEach(() => {
    process.env.INES_SQL_TIMEOUT_MS = "30000";
  });

  it("fails with an error instead of taking the memory of the machine", async () => {
    const { call } = tools();
    const out = await call("execute_sql", { sql: "SELECT length(randomblob(900000000)) AS n" });
    expect(out).toContain("SQL error");
    expect(out.toLowerCase()).toContain("out of memory");
  });

  it("fails the same way when it builds a huge value from many small ones", async () => {
    const { call } = tools();
    const out = await call("execute_sql", {
      sql: "SELECT length(group_concat(randomblob(1000000))) AS n FROM (WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n < 2000) SELECT n FROM r)",
    });
    expect(out.toLowerCase()).toContain("out of memory");
  });
});

describe("the tools still do their work", () => {
  it("execute_sql answers a query", async () => {
    const { call } = tools();
    const out = await call("execute_sql", { sql: "SELECT a FROM t WHERE a > 1 ORDER BY a" });
    expect(out).toContain("Rows: 2");
    expect(out).toContain('"a": 3');
  });

  it("execute_sql says what is wrong with a query that is wrong", async () => {
    const { call } = tools();
    const out = await call("execute_sql", { sql: "SELECT nope FROM t" });
    expect(out).toContain("SQL error");
    expect(out).toContain("Available tables");
  });

  it("refuses a query that is not a SELECT without starting a process for it", async () => {
    const { call } = tools();
    expect(await call("execute_sql", { sql: "DROP TABLE t" })).toContain("only SELECT");
    expect(await call("execute_sql", { sql: "SELECT * FROM sqlite_master" })).toContain("sqlite internals");
  });

  it("peek_table and peek_column_values answer", async () => {
    const { call } = tools();
    expect(await call("peek_table", { table_name: "t" })).toContain("a");
    expect(await call("peek_column_values", { column: "a", table_name: "t" })).toContain("1");
  });

  it("create_artifact from a query queues its artifact for the user", async () => {
    const { call, artifactQueue } = tools();
    const out = await call("create_artifact", { sql: "SELECT a FROM t", artifact: { type: "table", name: "A", description: "all of a" } });
    expect(out).toContain("Created table artifact");
    expect(artifactQueue).toHaveLength(1);
    expect(artifactQueue[0].event).toBe("copilotMessageArtifact");
  });

  it("create_artifact from rows given as they are needs no process", async () => {
    const { call, artifactQueue } = tools();
    await call("create_artifact", { data: [{ x: 1 }], artifact: { type: "table", name: "D", description: "d" } });
    expect(artifactQueue).toHaveLength(1);
  });
});

describe("a table that is very large", () => {
  it("is loaded up to 200,000 rows", async () => {
    const { call } = tools(Array.from({ length: 200_050 }, (_, i) => ({ a: i })));
    const out = await call("execute_sql", { sql: "SELECT count(*) AS n FROM t" });
    expect(out).toContain('"n": 200000');
  }, 30_000);
});
