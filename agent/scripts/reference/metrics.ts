import { PROCESS_METRICS, registry } from "../../src/lib/metrics.ts";

export interface MetricEntry {
  name: string;
  type: string;
  labels: readonly string[];
  labelValues: Record<string, readonly string[]> | null;
  help: string;
}

export function collectMetrics(): MetricEntry[] {
  const own = registry.definitions().map((definition) => ({
    name: definition.name,
    type: definition.type,
    labels: definition.labels,
    labelValues: definition.labelValues ? { ...definition.labelValues } : null,
    help: definition.help,
  }));
  const process = PROCESS_METRICS.map((metric) => ({
    name: metric.name,
    type: metric.type,
    labels: metric.labels,
    labelValues: null,
    help: metric.help,
  }));
  return [...own, ...process];
}
