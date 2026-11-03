type Labels = Record<string, string | number | undefined>;

export interface Counter {
  inc(labels?: Labels, by?: number): void;
}
export interface Gauge {
  set(value: number, labels?: Labels): void;
  inc(labels?: Labels, by?: number): void;
  dec(labels?: Labels, by?: number): void;
}
export interface Histogram {
  observe(value: number, labels?: Labels): void;
}
export type LabelValues = Readonly<Record<string, readonly string[]>>;
export type MetricType = "counter" | "gauge" | "histogram";

/** The part of the agent that a metric counts, which the reference page groups the metric under. */
export type MetricGroup = "http" | "queries" | "models" | "helpers" | "workspace" | "agent" | "mcp" | "process";

export interface MetricOptions {
  /** The labels that the metric carries. */
  labels?: readonly string[];
  /** The values that each label may take. A label that has its values takes only those. */
  labelValues?: LabelValues;
  /** The group that the reference page lists the metric under. */
  group: MetricGroup;
  /** The buckets of a histogram. */
  buckets?: readonly number[];
}

export interface MetricDefinition {
  name: string;
  type: MetricType;
  help: string;
  labels: readonly string[];
  labelValues: LabelValues | null;
  group: MetricGroup;
}

export interface Registry {
  counter(name: string, help: string, options: MetricOptions): Counter;
  gauge(name: string, help: string, options: MetricOptions): Gauge;
  histogram(name: string, help: string, options: MetricOptions): Histogram;
  /** The counter that holds the label values that a metric refused. */
  violations: Counter;
  definitions(): MetricDefinition[];
  render(): string;
}

const MAX_SERIES = 500;
export const DEFAULT_BUCKETS: readonly number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function labelText(names: readonly string[], values: readonly string[], extra?: [string, string]): string {
  const pairs = names.map((name, i) => `${name}="${escapeLabel(values[i])}"`);
  if (extra) pairs.push(`${extra[0]}="${extra[1]}"`);
  return pairs.length ? `{${pairs.join(",")}}` : "";
}

function numberText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
}

export function createRegistry(): Registry {
  const renderers: (() => string[])[] = [];
  const defined: MetricDefinition[] = [];
  let reportRefusal: (metric: string, label: string) => void = () => {};

  function series<T>(name: string, labelNames: readonly string[], labelValues: LabelValues | undefined, make: () => T) {
    const all = new Map<string, { values: string[]; state: T }>();
    return {
      all,
      get(labels: Labels = {}): T | undefined {
        const values = labelNames.map((labelName) => String(labels[labelName] ?? ""));
        for (const [index, labelName] of labelNames.entries()) {
          const allowed = labelValues?.[labelName];
          if (allowed && !allowed.includes(values[index])) {
            reportRefusal(name, labelName);
            return undefined;
          }
        }
        const key = values.join("\u0000");
        let entry = all.get(key);
        if (!entry) {
          if (all.size >= MAX_SERIES) return undefined;
          entry = { values, state: make() };
          all.set(key, entry);
        }
        return entry.state;
      },
    };
  }

  function header(name: string, help: string, type: string): string[] {
    return [`# HELP ${name} ${help.replace(/\n/g, " ")}`, `# TYPE ${name} ${type}`];
  }

  function scalar(name: string, help: string, type: "counter" | "gauge", labelNames: readonly string[], labelValues: LabelValues | undefined) {
    const store = series(name, labelNames, labelValues, () => ({ value: 0 }));
    renderers.push(() => [
      ...header(name, help, type),
      ...[...store.all.values()].map(
        ({ values, state }) => `${name}${labelText(labelNames, values)} ${numberText(state.value)}`,
      ),
    ]);
    return store;
  }

  /** Creates the series that a metric starts with: one for each combination of the values that its labels may take. */
  function seed(store: { get(labels?: Labels): unknown }, labelNames: readonly string[], labelValues: LabelValues | undefined) {
    if (labelNames.length === 0) {
      store.get({});
      return;
    }
    if (!labelValues) return;
    if (labelNames.some((name) => labelValues[name] === undefined)) return;
    let combinations: string[][] = [[]];
    for (const name of labelNames) {
      const values = labelValues[name];
      combinations = combinations.flatMap((prefix) => values.map((value) => [...prefix, value]));
    }
    for (const combination of combinations) {
      store.get(Object.fromEntries(labelNames.map((name, index) => [name, combination[index]])));
    }
  }

  function makeCounter(name: string, help: string, options: MetricOptions): Counter {
    const labels = options.labels ?? [];
    defined.push({ name, type: "counter", help, labels, labelValues: options.labelValues ?? null, group: options.group });
    const store = scalar(name, help, "counter", labels, options.labelValues);
    seed(store, labels, options.labelValues);
    return {
      inc(labels: Labels | undefined, by = 1) {
        const s = store.get(labels);
        if (s && by > 0) s.value += by;
      },
    };
  }

  function makeGauge(name: string, help: string, options: MetricOptions): Gauge {
    const labels = options.labels ?? [];
    defined.push({ name, type: "gauge", help, labels, labelValues: options.labelValues ?? null, group: options.group });
    const store = scalar(name, help, "gauge", labels, options.labelValues);
    seed(store, labels, options.labelValues);
    return {
      set(value: number, labels: Labels | undefined) {
        const s = store.get(labels);
        if (s) s.value = value;
      },
      inc(labels: Labels | undefined, by = 1) {
        const s = store.get(labels);
        if (s) s.value += by;
      },
      dec(labels: Labels | undefined, by = 1) {
        const s = store.get(labels);
        if (s) s.value -= by;
      },
    };
  }

  function makeHistogram(name: string, help: string, options: MetricOptions): Histogram {
    const labels = options.labels ?? [];
    const buckets = options.buckets ?? DEFAULT_BUCKETS;
    defined.push({ name, type: "histogram", help, labels, labelValues: options.labelValues ?? null, group: options.group });
    const store = series(name, labels, options.labelValues, () => ({
      counts: new Array<number>(buckets.length).fill(0),
      sum: 0,
      count: 0,
    }));
    renderers.push(() => {
      const lines = header(name, help, "histogram");
      for (const { values, state } of store.all.values()) {
        buckets.forEach((le, i) => {
          lines.push(`${name}_bucket${labelText(labels, values, ["le", String(le)])} ${state.counts[i]}`);
        });
        lines.push(`${name}_bucket${labelText(labels, values, ["le", "+Inf"])} ${state.count}`);
        lines.push(`${name}_sum${labelText(labels, values)} ${numberText(state.sum)}`);
        lines.push(`${name}_count${labelText(labels, values)} ${state.count}`);
      }
      return lines;
    });
    seed(store, labels, options.labelValues);
    return {
      observe(value, labels: Labels | undefined) {
        const s = store.get(labels);
        if (!s) return;
        buckets.forEach((le, i) => {
          if (value <= le) s.counts[i] += 1;
        });
        s.sum += value;
        s.count += 1;
      },
    };
  }

  const violations = makeCounter(
    "agent_metric_label_violations_total",
    "Label values that a metric refused because the metric does not declare them, by metric and label.",
    { labels: ["metric", "label"], group: "agent" },
  );
  reportRefusal = (metric, label) => violations.inc({ metric, label });

  return {
    counter: makeCounter,
    gauge: makeGauge,
    histogram: makeHistogram,
    violations,

    definitions() {
      return [...defined];
    },

    render() {
      return `${renderers.flatMap((r) => r()).join("\n")}\n`;
    },
  };
}

export const QUERY_OUTCOMES = ["completed", "continued", "limit", "denied", "busy", "invalid", "error", "aborted"] as const;
const DIRECTIONS = ["input", "output"] as const;
const ISOLATED_OUTCOMES = ["ok", "failed", "timeout", "crash", "output", "busy", "protocol"] as const;
const WORKSPACE_OUTCOMES = ["ok", "rejected", "limit", "error"] as const;
const CACHE_RESULTS = ["hit", "miss", "rejected"] as const;
const RECALL_MODES = ["latest", "words", "numbers"] as const;
const TOOL_OUTCOMES = ["ok", "error"] as const;
const UNHANDLED_KINDS = ["rejection", "exception"] as const;

export const registry = createRegistry();

export const metrics = {
  httpRequests: registry.counter("agent_http_requests_total", "HTTP requests by route, method and status.", {
    labels: ["route", "method", "status"],
    group: "http",
  }),
  httpDuration: registry.histogram(
    "agent_http_request_duration_seconds",
    "Time until an HTTP request is answered (for a stream, until it starts).",
    { labels: ["route", "method"], group: "http" },
  ),
  queryDuration: registry.histogram(
    "agent_query_duration_seconds",
    "Time a Copilot query takes, until its last event is sent, by outcome.",
    { labels: ["outcome"], labelValues: { outcome: QUERY_OUTCOMES }, group: "queries" },
  ),
  queries: registry.counter(
    "agent_queries_total",
    "Copilot queries by outcome. A query that ends by asking the browser for something is continued, and one whose client left is aborted.",
    { labels: ["outcome"], labelValues: { outcome: QUERY_OUTCOMES }, group: "queries" },
  ),
  activeQueries: registry.gauge("agent_active_queries", "Queries being answered right now.", { group: "queries" }),
  modelTokens: registry.counter("agent_model_tokens_total", "Model tokens used, by direction.", {
    labels: ["direction"],
    labelValues: { direction: DIRECTIONS },
    group: "models",
  }),
  modelErrors: registry.counter("agent_model_errors_total", "Model calls that failed, by provider.", {
    labels: ["provider"],
    group: "models",
  }),
  helperRefused: registry.counter(
    "agent_helper_calls_refused_total",
    "Helper calls (titles, rewritten prompts, ...) refused because the user made too many in a minute.",
    { group: "helpers" },
  ),
  unhandled: registry.counter("agent_unhandled_errors_total", "Errors that nothing handled, by kind.", {
    labels: ["kind"],
    labelValues: { kind: UNHANDLED_KINDS },
    group: "agent",
  }),
  isolated: registry.counter("agent_isolated_runs_total", "Work run in a child process, by how it ended.", {
    labels: ["kind"],
    labelValues: { kind: ISOLATED_OUTCOMES },
    group: "agent",
  }),
  isolatedDuration: registry.histogram("agent_isolated_run_duration_seconds", "How long work run in a child process took, by kind of work.", {
    labels: ["work"],
    group: "agent",
  }),
  modelCalls: registry.counter("agent_model_calls_total", "Calls made to a model (one for each step of a question), by provider.", {
    labels: ["provider"],
    group: "models",
  }),
  workspaceRequests: registry.counter(
    "agent_workspace_api_requests_total",
    "Calls to the FINOS Workspace API by endpoint and outcome.",
    { labels: ["endpoint", "outcome"], labelValues: { outcome: WORKSPACE_OUTCOMES }, group: "workspace" },
  ),
  workspaceDuration: registry.histogram(
    "agent_workspace_api_request_duration_seconds",
    "Time a call to the FINOS Workspace API takes.",
    { labels: ["endpoint"], group: "workspace" },
  ),
  authCache: registry.counter("agent_auth_cache_total", "Lookups of a signed-in user in the cache, by result.", {
    labels: ["result"],
    labelValues: { result: CACHE_RESULTS },
    group: "workspace",
  }),
  storeErrors: registry.counter(
    "agent_store_errors_total",
    "Times the shared store could not answer and this process answered instead, by operation. Steadily above zero means quotas and turns are being counted per replica.",
    { labels: ["op"], group: "agent" },
  ),
  recalls: registry.counter(
    "agent_conversation_recalls_total",
    "Times the model read the earlier part of a chat, by how: the latest messages, a search by words, or numbered messages.",
    { labels: ["mode"], labelValues: { mode: RECALL_MODES }, group: "agent" },
  ),
  toolCalls: registry.counter("agent_mcp_tool_calls_total", "MCP tool calls by tool and outcome. Only the process of the MCP server updates it.", {
    labels: ["tool", "outcome"],
    labelValues: { outcome: TOOL_OUTCOMES },
    group: "mcp",
  }),
  toolDuration: registry.histogram("agent_mcp_tool_duration_seconds", "Time an MCP tool takes. Only the process of the MCP server updates it.", {
    labels: ["tool"],
    group: "mcp",
  }),
};

interface ProcessMetric {
  name: string;
  type: "gauge";
  help: string;
  labels: readonly string[];
  group: MetricGroup;
  sample(): { labels: Record<string, string>; value: number };
}

export const PROCESS_METRICS: readonly ProcessMetric[] = [
  {
    name: "process_resident_memory_bytes",
    type: "gauge",
    help: "Resident memory of the process.",
    labels: [],
    group: "process",
    sample: () => ({ labels: {}, value: process.memoryUsage().rss }),
  },
  {
    name: "process_uptime_seconds",
    type: "gauge",
    help: "Seconds since the process started.",
    labels: [],
    group: "process",
    sample: () => ({ labels: {}, value: Math.round(process.uptime()) }),
  },
  {
    name: "agent_build_info",
    type: "gauge",
    help: "The version that is running. The value is always 1 and the label holds OTEL_SERVICE_VERSION, or dev.",
    labels: ["version"],
    group: "process",
    sample: () => ({ labels: { version: process.env.OTEL_SERVICE_VERSION ?? "dev" }, value: 1 }),
  },
];

export interface MetricGroupDefinition {
  id: MetricGroup;
  title: string;
  detail: string;
}

/** The groups that the reference page lists the metrics under, in the order that it lists them. */
export const METRIC_GROUPS: readonly MetricGroupDefinition[] = [
  {
    id: "http",
    title: "The requests of the API",
    detail: "What the API of the agent received and how long it took to answer.",
  },
  {
    id: "queries",
    title: "The questions of the users",
    detail: "The questions that the agent answered, how they ended and the ones that it is answering now.",
  },
  {
    id: "models",
    title: "The models",
    detail: "The calls that the agent made to a model, the tokens that they used and the ones that failed.",
  },
  {
    id: "helpers",
    title: "The helpers",
    detail: "The short requests that the Workspace makes to the agent, such as a title for a chat.",
  },
  {
    id: "workspace",
    title: "The FINOS Workspace",
    detail: "The calls that the agent made to the FINOS Workspace API and the lookups of a signed-in user.",
  },
  {
    id: "agent",
    title: "The agent itself",
    detail: "What the agent ran into: errors, work in a child process, the shared store and reading the earlier part of a chat.",
  },
  {
    id: "mcp",
    title: "The tools of the MCP server",
    detail: "Only the process of the MCP server updates these, and it serves them on its own port.",
  },
  {
    id: "process",
    title: "The process",
    detail: "What the process reports about itself: the memory it uses, how long it has run and the version that runs.",
  },
];

export function renderMetrics(): string {
  const process_ = PROCESS_METRICS.flatMap((metric) => {
    const { labels, value } = metric.sample();
    return [
      `# HELP ${metric.name} ${metric.help}`,
      `# TYPE ${metric.name} ${metric.type}`,
      `${metric.name}${labelText(metric.labels, metric.labels.map((name) => labels[name] ?? ""))} ${value}`,
    ];
  }).join("\n");
  return `${registry.render()}${process_}\n`;
}
