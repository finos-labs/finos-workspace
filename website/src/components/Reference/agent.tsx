import type { AgentData, AgentField } from "../../data/types";
import { agentApiData, agentData } from "./data";
import { Fields, fromAgent, fromSchema } from "./fields";
import { amount, slug, type Unit } from "./format";
import { Chip, Entry, firstSentence, ItemList, MethodBadge, Names, Section } from "./kit";
import { InlineText, Prose } from "./prose";
import { ApiOperations } from "./operations";
import { TableWrap } from "./shared";
import styles from "./styles.module.css";

const MEBIBYTE = 1024 * 1024;

function bytes(value: number): string {
  return value % MEBIBYTE === 0 ? `${value / MEBIBYTE} MiB` : `${(value / MEBIBYTE).toFixed(2).replace(/\.?0+$/, "")} MiB`;
}

export function FieldTable({ fields, depth = 0, prefix = "" }: { fields: AgentField[]; depth?: number; prefix?: string }) {
  const rows = fields
    .filter((field) => field.path.startsWith(prefix) && !field.path.startsWith("x-agent-"))
    .map((field) => ({ ...field, path: prefix === "" ? field.path : field.path.slice(prefix.length) }))
    .filter((field) => field.path.split(/\.|\[\]/).filter(Boolean).length <= depth + 1);
  return <Fields fields={fromAgent(rows)} empty="No fields." />;
}

export function AgentBodyLimit({ name }: { name: "helperBodyBytes" | "transcribeBodyBytes" | "audioBytes" | "defaultMaxBodyMb" }) {
  const limits = agentData.http.limits;
  return <>{name === "defaultMaxBodyMb" ? limits[name] : bytes(limits[name])}</>;
}

/** The routes of the agent, as the OpenAPI document that the agent writes describes them. */
export function AgentApiTag({ tag, schemaPage = "/reference/http-api/agent-api" }: { tag: string; schemaPage?: string }) {
  const found = agentApiData.tags.find((item) => item.name === tag);
  if (found === undefined) throw new Error(`No agent API tag ${tag}`);
  return <ApiOperations operations={found.operations} schemas={agentApiData.schemas} schemaPage={schemaPage} />;
}

/** The schemas of the request and the response bodies of the agent's routes. */
export function AgentSchemas({ schemaPage = "/reference/http-api/agent-api" }: { schemaPage?: string }) {
  return (
    <>
      {agentApiData.schemas.map((schema) => (
        <Entry
          key={schema.name}
          id={`schema-${schema.name}`}
          title={schema.name}
          description={schema.description ?? ""}
          collapsed
        >
          <Fields fields={fromSchema(schema.properties)} schemaPage={schemaPage} empty="This schema has no named properties." />
        </Entry>
      ))}
    </>
  );
}

export function AgentHelperRoutes() {
  return (
    <>
      {agentData.http.helpers.map((helper) => (
        <Entry key={helper.path} id={`helper-${slug(helper.path)}`} title={<code>{helper.path}</code>} lead={firstSentence(helper.detail)} description={helper.detail} collapsed>
          {helper.fields.length > 0 ? (
            <Section title="Request fields">
              <FieldTable fields={helper.fields} depth={1} />
            </Section>
          ) : null}
          <Section title="Answer">
            <Prose text={helper.answer} />
          </Section>
          <Section title="Fallback">
            <Prose text={helper.fallback} />
          </Section>
        </Entry>
      ))}
    </>
  );
}

interface MetricRow {
  name: string;
  type: string;
  labels: string[];
  labelValues?: Record<string, string[]> | null;
  help: string;
}

function MetricLabels({ metric }: { metric: MetricRow }) {
  if (metric.labels.length === 0) return <span className={styles.muted}>none</span>;
  return (
    <ul className={styles.names}>
      {metric.labels.map((label) => (
        <li key={label}>
          <code>{label}</code>
          {metric.labelValues?.[label] ? <>: {metric.labelValues[label].join(", ")}</> : null}
        </li>
      ))}
    </ul>
  );
}

/** The metrics of an API, one row each, with the labels that they carry and what they count. */
export function MetricsTable({ metrics }: { metrics: MetricRow[] }) {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Type</th>
            <th>Labels</th>
            <th>What it counts</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => (
            <tr key={metric.name}>
              <td>
                <code>{metric.name}</code>
              </td>
              <td>
                <Chip>{metric.type}</Chip>
              </td>
              <td>
                <MetricLabels metric={metric} />
              </td>
              <td>{metric.help}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

/** The metrics that the agent serves, grouped by the part of the agent that they count. */
export function AgentMetrics() {
  return (
    <>
      {agentData.metricGroups.map((group) => (
        <Section key={group.id} title={group.title}>
          <p>{group.detail}</p>
          <MetricsTable metrics={agentData.metrics.filter((metric) => metric.group === group.id)} />
        </Section>
      ))}
    </>
  );
}

export function AgentMcpCorsHeaders() {
  return (
    <>
      {agentData.mcp.corsHeaders.map((header, index) => (
        <span key={header}>
          {index > 0 ? (index === agentData.mcp.corsHeaders.length - 1 ? " and " : ", ") : ""}
          <code>{header}</code>
        </span>
      ))}
    </>
  );
}

export function AgentCount({ what }: { what: "backendTools" | "documentTools" | "workspaceTools" | "prompts" | "resources" }) {
  const { tools, prompts, resources } = agentData.mcp;
  const counts = {
    backendTools: tools.filter((tool) => tool.group === "backend").length,
    documentTools: tools.filter((tool) => tool.group === "documents").length,
    workspaceTools: tools.filter((tool) => tool.group === "workspace").length,
    prompts: prompts.length,
    resources: resources.length,
  };
  return <>{counts[what]}</>;
}

export function AgentScopedTools() {
  const names = agentData.mcp.tools.filter((tool) => tool.scoped).map((tool) => tool.name);
  return (
    <>
      {names.map((name, index) => (
        <span key={name}>
          {index > 0 ? (index === names.length - 1 ? " and " : ", ") : ""}
          <code>{name}</code>
        </span>
      ))}
    </>
  );
}

export function AgentMcpRoutes() {
  return (
    <ItemList
      items={agentData.mcp.routes.map((route) => ({
        key: `${route.method} ${route.path}`,
        title: (
          <>
            <MethodBadge method={route.method} />
            <code>{route.path}</code>
          </>
        ),
        description: route.summary,
      }))}
    />
  );
}

export function AgentMcpTools({ group }: { group: "backend" | "documents" | "workspace" }) {
  const tools = agentData.mcp.tools.filter((tool) => tool.group === group);
  return (
    <>
      {tools.map((tool) => (
        <Entry
          key={tool.name}
          id={`agent-tool-${tool.name}`}
          title={<code>{tool.name}</code>}
          description={tool.description}
          chips={tool.scoped ? <Chip>checks the signed chat scope of every call</Chip> : undefined}
          collapsed
        >
          <dl>
            <dt>Registered</dt>
            <dd>
              <InlineText text={tool.availability} />
            </dd>
          </dl>
          <Section title="Parameters">
            <FieldTable fields={tool.fields} depth={1} />
          </Section>
        </Entry>
      ))}
    </>
  );
}

export function AgentMcpPrompts() {
  return (
    <ItemList
      items={agentData.mcp.prompts.map((prompt) => ({
        key: prompt.name,
        title: <code>{prompt.name}</code>,
        description: prompt.description,
      }))}
    />
  );
}

export function AgentMcpResources() {
  return (
    <ItemList
      items={agentData.mcp.resources.map((resource) => ({
        key: resource.uri,
        title: <code>{resource.uri}</code>,
        chips: resource.mimeType ? <Chip>{resource.mimeType}</Chip> : undefined,
        description: resource.description,
        meta: [["Name", resource.name]],
      }))}
    />
  );
}

export function QueryRequestFields({ prefix = "", depth = 0 }: { prefix?: string; depth?: number }) {
  return <FieldTable fields={agentData.protocol.queryRequest} prefix={prefix} depth={depth} />;
}

export function WidgetFields() {
  return <FieldTable fields={agentData.protocol.widget} depth={1} />;
}

export function QueryEvents() {
  return (
    <ItemList
      items={agentData.protocol.events.map((event) => ({
        key: event.event,
        title: <code>{event.event}</code>,
        description: event.meaning,
        meta: [["Fields of data", event.fields]],
      }))}
    />
  );
}

export function ExtraStateKeys() {
  return (
    <ItemList
      items={agentData.protocol.extraState.map((entry) => ({
        key: entry.key,
        title: <code>{entry.key}</code>,
        description: entry.meaning,
      }))}
    />
  );
}

export function BridgeCommands() {
  return (
    <>
      {agentData.protocol.bridgeCommands.map((command) => (
        <Entry key={command.name} id={`bridge-${command.name}`} title={<code>{command.name}</code>} description={command.description} collapsed>
          <Section title="Arguments">
            <FieldTable fields={command.fields} depth={1} />
          </Section>
        </Entry>
      ))}
    </>
  );
}

export function ToolGroups() {
  return (
    <ItemList
      items={agentData.protocol.toolGroups.map((group) => ({
        key: group.id,
        title: <code>{group.id}</code>,
        chips: <Chip>{group.alwaysLoaded ? "always loaded" : "loaded when the model asks with load_tools"}</Chip>,
        description: group.summary,
        meta: [["Tools", group.tools.length === 0 ? "the tools that the FINOS Workspace supplies" : <Names items={group.tools} />]],
      }))}
    />
  );
}

export function TypedResultLimit({ name, unit }: { name: keyof AgentData["protocol"]["typedResults"]["limits"]; unit?: Unit }) {
  return <>{amount(agentData.protocol.typedResults.limits[name], unit)}</>;
}

export function TypedResultKinds() {
  const kinds = agentData.protocol.typedResults.kinds;
  return (
    <>
      {kinds.map((kind, index) => (
        <span key={kind}>
          {index > 0 ? (index === kinds.length - 1 ? " and " : ", ") : ""}
          <code>{kind}</code>
        </span>
      ))}
    </>
  );
}

export function InternalArguments() {
  const rows = new Map<string, { tools: string[]; description: string }>();
  for (const tool of agentData.mcp.tools) {
    for (const field of tool.fields) {
      if (!field.path.startsWith("x-agent-") || field.path.includes(".") || field.path.includes("[")) continue;
      const row = rows.get(field.path) ?? { tools: [], description: field.description };
      row.tools.push(tool.name);
      rows.set(field.path, row);
    }
  }
  return (
    <ItemList
      items={Array.from(rows.entries()).map(([name, row]) => ({
        key: name,
        title: <code>{name}</code>,
        description: row.description,
        meta: [["Sent to", <Names key="tools" items={row.tools} />]],
      }))}
    />
  );
}

export function AgentLimit({ name, unit }: { name: string; unit?: Unit }) {
  const value = agentData.protocol.limits[name];
  if (value === undefined) throw new Error(`The agent reference has no limit ${name}`);
  return <>{amount(value, unit)}</>;
}

export function AgentCoreTools() {
  const names = agentData.protocol.coreTools;
  return (
    <>
      {names.map((name, index) => (
        <span key={name}>
          {index > 0 ? (index === names.length - 1 ? " and " : ", ") : ""}
          <code>{name}</code>
        </span>
      ))}
    </>
  );
}
