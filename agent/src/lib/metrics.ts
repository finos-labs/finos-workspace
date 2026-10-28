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
export interface MetricDefinition {
  name: string;
  type: MetricType;
  help: string;
  labels: readonly string[];
  labelValues: LabelValues | null;
}
export interface Registry {
  counter(name: string, help: string, labelNames?: readonly string[], labelValues?: LabelValues): Counter;
  gauge(name: string, help: string, labelNames?: readonly string[], labelValues?: LabelValues): Gauge;
  histogram(
    name: string,
    help: string,
    labelNames?: readonly string[],
    buckets?: readonly number[],
    labelValues?: LabelValues,
  ): Histogram;
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

  function series<T>(labelNames: readonly string[], make: () => T) {
    const all = new Map<string, { values: string[]; state: T }>();
    return {
      all,
      get(labels: Labels = {}): T | undefined {
        const values = labelNames.map((name) => String(labels[name] ?? ""));
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

  function scalar(name: string, help: string, type: "counter" | "gauge", labelNames: readonly string[]) {
    const store = series(labelNames, () => ({ value: 0 }));
    renderers.push(() =>
      store.all.size === 0
        ? []
        : [
            ...header(name, help, type),
            ...[...store.all.values()].map(
              ({ values, state }) => `${name}${labelText(labelNames, values)} ${numberText(state.value)}`,
            ),
          ],
    );
    return store;
  }

  return {
    counter(name, help, labelNames = [], labelValues) {
      defined.push({ name, type: "counter", help, labels: labelNames, labelValues: labelValues ?? null });
      const store = scalar(name, help, "counter", labelNames);
      return {
        inc(labels, by = 1) {
          const s = store.get(labels);
          if (s && by > 0) s.value += by;
        },
      };
    },

    gauge(name, help, labelNames = [], labelValues) {
      defined.push({ name, type: "gauge", help, labels: labelNames, labelValues: labelValues ?? null });
      const store = scalar(name, help, "gauge", labelNames);
      return {
        set(value, labels) {
          const s = store.get(labels);
          if (s) s.value = value;
        },
        inc(labels, by = 1) {
          const s = store.get(labels);
          if (s) s.value += by;
        },
        dec(labels, by = 1) {
          const s = store.get(labels);
          if (s) s.value -= by;
        },
      };
    },

    histogram(name, help, labelNames = [], buckets = DEFAULT_BUCKETS, labelValues) {
      defined.push({ name, type: "histogram", help, labels: labelNames, labelValues: labelValues ?? null });
      const store = series(labelNames, () => ({ counts: new Array<number>(buckets.length).fill(0), sum: 0, count: 0 }));
      renderers.push(() => {
        if (store.all.size === 0) return [];
        const lines = header(name, help, "histogram");
        for (const { values, state } of store.all.values()) {
          buckets.forEach((le, i) => {
            lines.push(`${name}_bucket${labelText(labelNames, values, ["le", String(le)])} ${state.counts[i]}`);
          });
          lines.push(`${name}_bucket${labelText(labelNames, values, ["le", "+Inf"])} ${state.count}`);
          lines.push(`${name}_sum${labelText(labelNames, values)} ${numberText(state.sum)}`);
          lines.push(`${name}_count${labelText(labelNames, values)} ${state.count}`);
        }
        return lines;
      });
      return {
        observe(value, labels) {
          const s = store.get(labels);
          if (!s) return;
          buckets.forEach((le, i) => {
            if (value <= le) s.counts[i] += 1;
          });
          s.sum += value;
          s.count += 1;
        },
      };
    },

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
  httpRequests: registry.counter("ines_http_requests_total", "HTTP requests by route, method and status.", [
    "route",
    "method",
    "status",
  ]),
  httpDuration: registry.histogram(
    "ines_http_request_duration_seconds",
    "Time until an HTTP request is answered (for a stream, until it starts).",
    ["route", "method"],
  ),
  queryDuration: registry.histogram(
    "ines_query_duration_seconds",
    "Time a Copilot query takes, until its last event is sent, by outcome.",
    ["outcome"],
    DEFAULT_BUCKETS,
    { outcome: QUERY_OUTCOMES },
  ),
  queries: registry.counter(
    "ines_queries_total",
    "Copilot queries by outcome. A query that ends by asking the browser for something is continued, and one whose client left is aborted.",
    ["outcome"],
    { outcome: QUERY_OUTCOMES },
  ),
  activeQueries: registry.gauge("ines_active_queries", "Queries being answered right now."),
  modelTokens: registry.counter("ines_model_tokens_total", "Model tokens used, by direction.", ["direction"], {
    direction: DIRECTIONS,
  }),
  modelErrors: registry.counter("ines_model_errors_total", "Model calls that failed, by provider.", ["provider"]),
  helperRefused: registry.counter("ines_helper_calls_refused_total", "Helper calls (titles, rewritten prompts, ...) refused because the user made too many in a minute."),
  unhandled: registry.counter("ines_unhandled_errors_total", "Errors that nothing handled, by kind.", ["kind"], {
    kind: UNHANDLED_KINDS,
  }),
  isolated: registry.counter("ines_isolated_runs_total", "Work run in a child process, by how it ended.", ["kind"], {
    kind: ISOLATED_OUTCOMES,
  }),
  isolatedDuration: registry.histogram("ines_isolated_run_duration_seconds", "How long work run in a child process took, by kind of work.", ["work"]),
  modelCalls: registry.counter("ines_model_calls_total", "Calls made to a model (one for each step of a question), by provider.", ["provider"]),
  workspaceRequests: registry.counter(
    "ines_workspace_api_requests_total",
    "Calls to the FINOS Workspace API by endpoint and outcome.",
    ["endpoint", "outcome"],
    { outcome: WORKSPACE_OUTCOMES },
  ),
  workspaceDuration: registry.histogram(
    "ines_workspace_api_request_duration_seconds",
    "Time a call to the FINOS Workspace API takes.",
    ["endpoint"],
  ),
  authCache: registry.counter("ines_auth_cache_total", "Lookups of a signed-in user in the cache, by result.", ["result"], {
    result: CACHE_RESULTS,
  }),
  storeErrors: registry.counter(
    "ines_store_errors_total",
    "Times the shared store could not answer and this process answered instead, by operation. Steadily above zero means quotas and turns are being counted per replica.",
    ["op"],
  ),
  recalls: registry.counter(
    "ines_conversation_recalls_total",
    "Times the model read the earlier part of a chat, by how: the latest messages, a search by words, or numbered messages.",
    ["mode"],
    { mode: RECALL_MODES },
  ),
  toolCalls: registry.counter("ines_mcp_tool_calls_total", "MCP tool calls by tool and outcome. Only the process of the MCP server updates it.", ["tool", "outcome"], {
    outcome: TOOL_OUTCOMES,
  }),
  toolDuration: registry.histogram("ines_mcp_tool_duration_seconds", "Time an MCP tool takes. Only the process of the MCP server updates it.", ["tool"]),
};

interface ProcessMetric {
  name: string;
  type: "gauge";
  help: string;
  labels: readonly string[];
  sample(): { labels: Record<string, string>; value: number };
}

export const PROCESS_METRICS: readonly ProcessMetric[] = [
  {
    name: "process_resident_memory_bytes",
    type: "gauge",
    help: "Resident memory of the process.",
    labels: [],
    sample: () => ({ labels: {}, value: process.memoryUsage().rss }),
  },
  {
    name: "process_uptime_seconds",
    type: "gauge",
    help: "Seconds since the process started.",
    labels: [],
    sample: () => ({ labels: {}, value: Math.round(process.uptime()) }),
  },
  {
    name: "ines_build_info",
    type: "gauge",
    help: "The version that is running. The value is always 1 and the label holds OTEL_SERVICE_VERSION, or dev.",
    labels: ["version"],
    sample: () => ({ labels: { version: process.env.OTEL_SERVICE_VERSION ?? "dev" }, value: 1 }),
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
