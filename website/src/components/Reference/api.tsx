import { MetricsTable } from "./agent";
import { agentData, apiData, pluginsData } from "./data";
import { ApiOperations } from "./operations";

export function ApiMetrics() {
  return <MetricsTable metrics={apiData.metrics} />;
}

export function MetricName({ name }: { name: string }) {
  const known = [...apiData.metrics, ...agentData.metrics, ...pluginsData.metrics].some((metric) => metric.name === name);
  if (!known) throw new Error(`No metric is named ${name}`);
  return <code>{name}</code>;
}

export function ApiTag({ tag, schemaPage }: { tag: string; schemaPage: string }) {
  const found = apiData.tags.find((item) => item.name === tag);
  if (found === undefined) throw new Error(`No API tag ${tag}`);
  return <ApiOperations operations={found.operations} schemas={apiData.schemas} schemaPage={schemaPage} />;
}
