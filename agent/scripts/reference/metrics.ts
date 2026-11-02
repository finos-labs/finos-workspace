import { METRIC_GROUPS, PROCESS_METRICS, registry, type MetricGroup } from "../../src/lib/metrics.ts";

export interface MetricEntry {
  name: string;
  type: string;
  labels: readonly string[];
  labelValues: Record<string, readonly string[]> | null;
  help: string;
  group: MetricGroup;
}

export interface MetricGroupEntry {
  id: MetricGroup;
  title: string;
  detail: string;
}

export function collectMetrics(): MetricEntry[] {
  const own = registry.definitions().map((definition) => ({
    name: definition.name,
    type: definition.type,
    labels: definition.labels,
    labelValues: definition.labelValues ? { ...definition.labelValues } : null,
    help: definition.help,
    group: definition.group,
  }));
  const process = PROCESS_METRICS.map((metric) => ({
    name: metric.name,
    type: metric.type,
    labels: metric.labels,
    labelValues: null,
    help: metric.help,
    group: metric.group,
  }));
  return [...own, ...process];
}

/** The groups that the metrics are listed under, which the reference page gives each one a section. */
export function collectMetricGroups(): MetricGroupEntry[] {
  const metrics = collectMetrics();
  for (const group of METRIC_GROUPS) {
    if (!metrics.some((metric) => metric.group === group.id)) {
      throw new Error(`The group ${group.id} of the metrics lists no metric.`);
    }
  }
  for (const metric of metrics) {
    if (!METRIC_GROUPS.some((group) => group.id === metric.group)) {
      throw new Error(`The metric ${metric.name} is in the group ${metric.group}, which no group lists.`);
    }
  }
  return METRIC_GROUPS.map((group) => ({ id: group.id, title: group.title, detail: group.detail }));
}
