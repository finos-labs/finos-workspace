import { describe, it, expect } from "bun:test";
import { createRegistry, renderMetrics, metrics } from "../../../../src/lib/metrics";

describe("counter", () => {
  it("is written with its labels and counts up", () => {
    const r = createRegistry();
    const c = r.counter("things_total", "Things.", ["kind"]);
    c.inc({ kind: "a" });
    c.inc({ kind: "a" }, 2);
    c.inc({ kind: "b" });
    expect(r.render()).toBe(
      ["# HELP things_total Things.", "# TYPE things_total counter", 'things_total{kind="a"} 3', 'things_total{kind="b"} 1', ""].join("\n"),
    );
  });

  it("writes nothing until something was counted, and never counts down", () => {
    const r = createRegistry();
    const c = r.counter("quiet_total", "Quiet.");
    expect(r.render()).toBe("\n");
    c.inc(undefined, -5);
    expect(r.render()).not.toContain("quiet_total 0\n-");
    c.inc();
    expect(r.render()).toContain("quiet_total 1");
  });

  it("escapes label values and ignores labels it was not declared with", () => {
    const r = createRegistry();
    const c = r.counter("escaped_total", "Escaped.", ["path"]);
    c.inc({ path: 'a"b\\c\nd', user: "ignored" });
    expect(r.render()).toContain('escaped_total{path="a\\"b\\\\c\\nd"} 1');
    expect(r.render()).not.toContain("ignored");
  });

  it("keeps a bounded number of series so that a stray label cannot grow it without end", () => {
    const r = createRegistry();
    const c = r.counter("bounded_total", "Bounded.", ["id"]);
    for (let i = 0; i < 2000; i++) c.inc({ id: String(i) });
    const series = r.render().split("\n").filter((l) => l.startsWith("bounded_total{"));
    expect(series).toHaveLength(500);
    c.inc({ id: "0" });
    expect(r.render()).toContain('bounded_total{id="0"} 2');
  });
});

describe("gauge", () => {
  it("goes up, down and to a value", () => {
    const r = createRegistry();
    const g = r.gauge("active", "Active.");
    g.set(3);
    g.inc();
    g.dec(undefined, 2);
    expect(r.render()).toContain("active 2");
  });
});

describe("histogram", () => {
  it("writes cumulative buckets, a sum and a count", () => {
    const r = createRegistry();
    const h = r.histogram("seconds", "Seconds.", ["route"], [0.1, 1, 10]);
    h.observe(0.05, { route: "/q" });
    h.observe(0.5, { route: "/q" });
    h.observe(20, { route: "/q" });
    const text = r.render();
    expect(text).toContain('seconds_bucket{route="/q",le="0.1"} 1');
    expect(text).toContain('seconds_bucket{route="/q",le="1"} 2');
    expect(text).toContain('seconds_bucket{route="/q",le="10"} 2');
    expect(text).toContain('seconds_bucket{route="/q",le="+Inf"} 3');
    expect(text).toContain('seconds_sum{route="/q"} 20.55');
    expect(text).toContain('seconds_count{route="/q"} 3');
  });
});

describe("renderMetrics", () => {
  it("adds the process's own metrics to what was registered", () => {
    metrics.queries.inc({ outcome: "completed" });
    const text = renderMetrics();
    expect(text).toContain('ines_queries_total{outcome="completed"}');
    expect(text).toMatch(/process_resident_memory_bytes \d+/);
    expect(text).toMatch(/ines_build_info\{version="[^"]+"\} 1/);
    expect(text.endsWith("\n")).toBe(true);
  });
});
