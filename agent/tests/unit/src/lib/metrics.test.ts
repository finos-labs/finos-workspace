import { describe, it } from "node:test";
import { expect } from "expect";
import { METRIC_GROUPS, createRegistry, registry, renderMetrics, metrics } from "../../../../src/lib/metrics.ts";

describe("counter", () => {
  it("is written with its labels and counts up", () => {
    const r = createRegistry();
    const c = r.counter("things_total", "Things.", { labels: ["kind"], group: "agent" });
    c.inc({ kind: "a" });
    c.inc({ kind: "a" }, 2);
    c.inc({ kind: "b" });
    const text = r.render();
    expect(text).toContain("# HELP things_total Things.");
    expect(text).toContain("# TYPE things_total counter");
    expect(text).toContain('things_total{kind="a"} 3');
    expect(text).toContain('things_total{kind="b"} 1');
  });

  it("reads zero until something was counted, and never counts down", () => {
    const r = createRegistry();
    const c = r.counter("quiet_total", "Quiet.", { group: "agent" });
    expect(r.render()).toContain("quiet_total 0");
    c.inc(undefined, -5);
    expect(r.render()).not.toContain("quiet_total 0\n-");
    expect(r.render()).toContain("quiet_total 0");
    c.inc();
    expect(r.render()).toContain("quiet_total 1");
  });

  it("escapes label values and ignores labels it was not declared with", () => {
    const r = createRegistry();
    const c = r.counter("escaped_total", "Escaped.", { labels: ["path"], group: "agent" });
    c.inc({ path: 'a"b\\c\nd', user: "ignored" });
    expect(r.render()).toContain('escaped_total{path="a\\"b\\\\c\\nd"} 1');
    expect(r.render()).not.toContain("ignored");
  });

  it("keeps a bounded number of series so that a stray label cannot grow it without end", () => {
    const r = createRegistry();
    const c = r.counter("bounded_total", "Bounded.", { labels: ["id"], group: "agent" });
    for (let i = 0; i < 2000; i++) c.inc({ id: String(i) });
    const series = r.render().split("\n").filter((l) => l.startsWith("bounded_total{"));
    expect(series).toHaveLength(500);
    c.inc({ id: "0" });
    expect(r.render()).toContain('bounded_total{id="0"} 2');
  });
});

describe("the values that a label may take", () => {
  it("starts a metric with a zero for every value that its labels may take", () => {
    const r = createRegistry();
    r.counter("kinds_total", "Kinds.", { labels: ["kind"], labelValues: { kind: ["a", "b"] }, group: "agent" });
    expect(r.render()).toContain('kinds_total{kind="a"} 0');
    expect(r.render()).toContain('kinds_total{kind="b"} 0');
  });

  it("refuses a value that the label does not declare, and says that it did", () => {
    const r = createRegistry();
    const c = r.counter("kinds_total", "Kinds.", { labels: ["kind"], labelValues: { kind: ["a", "b"] }, group: "agent" });
    c.inc({ kind: "c" });
    expect(r.render()).not.toContain('kinds_total{kind="c"}');
    expect(r.render()).toContain('agent_metric_label_violations_total{metric="kinds_total",label="kind"} 1');
  });

  it("takes any value of a label that does not declare them", () => {
    const r = createRegistry();
    const c = r.counter("routes_total", "Routes.", { labels: ["route"], group: "agent" });
    c.inc({ route: "/anything" });
    expect(r.render()).toContain('routes_total{route="/anything"} 1');
  });
});

describe("gauge", () => {
  it("goes up, down and to a value", () => {
    const r = createRegistry();
    const g = r.gauge("active", "Active.", { group: "agent" });
    g.set(3);
    g.inc();
    g.dec(undefined, 2);
    expect(r.render()).toContain("active 2");
  });
});

describe("histogram", () => {
  it("writes cumulative buckets, a sum and a count", () => {
    const r = createRegistry();
    const h = r.histogram("seconds", "Seconds.", { labels: ["route"], buckets: [0.1, 1, 10], group: "agent" });
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

  it("is written from the start, with nothing in it", () => {
    const r = createRegistry();
    r.histogram("seconds", "Seconds.", { labels: ["route"], group: "agent" });
    expect(r.render()).toContain("# TYPE seconds histogram");
  });
});

describe("renderMetrics", () => {
  it("adds the process's own metrics to what was registered", () => {
    metrics.queries.inc({ outcome: "completed" });
    const text = renderMetrics();
    expect(text).toContain('agent_queries_total{outcome="completed"}');
    expect(text).toMatch(/process_resident_memory_bytes \d+/);
    expect(text).toMatch(/agent_build_info\{version="[^"]+"\} 1/);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("writes every metric that the agent registers, whether anything happened yet or not", () => {
    const text = renderMetrics();
    for (const definition of registry.definitions()) {
      expect(text).toContain(`# HELP ${definition.name} `);
      expect(text).toContain(`# TYPE ${definition.name} ${definition.type}`);
    }
  });

  it("puts every metric in a group that the reference page lists", () => {
    const groups = METRIC_GROUPS.map((group) => group.id);
    for (const definition of registry.definitions()) {
      expect(groups).toContain(definition.group);
    }
  });
});
