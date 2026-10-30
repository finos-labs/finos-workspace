import type { AgentData, AgentField } from "../../data/types";
import { agentData } from "./data";
import { Fields, fromAgent } from "./fields";
import { amount, slug, type Unit } from "./format";
import { Chip, Entry, firstSentence, Index, ItemList, MethodBadge, Names, Section } from "./kit";
import { InlineText, Prose } from "./prose";

const MEBIBYTE = 1024 * 1024;

function bytes(value: number): string {
  return value % MEBIBYTE === 0 ? `${value / MEBIBYTE} MiB` : `${(value / MEBIBYTE).toFixed(2).replace(/\.?0+$/, "")} MiB`;
}

export function FieldTable({ fields, depth = 0, prefix = "" }: { fields: AgentField[]; depth?: number; prefix?: string }) {
  const rows = fields
    .filter((field) => field.path.startsWith(prefix) && !field.path.startsWith("x-ines-"))
    .map((field) => ({ ...field, path: prefix === "" ? field.path : field.path.slice(prefix.length) }))
    .filter((field) => field.path.split(/\.|\[\]/).filter(Boolean).length <= depth + 1);
  return <Fields fields={fromAgent(rows)} empty="No fields." />;
}

export function InesLimit({ name }: { name: "helperBodyBytes" | "transcribeBodyBytes" | "audioBytes" | "defaultMaxBodyMb" }) {
  const limits = agentData.http.limits;
  return <>{name === "defaultMaxBodyMb" ? limits[name] : bytes(limits[name])}</>;
}

export function InesRoutes() {
  return (
    <ItemList
      items={agentData.http.routes.map((route) => ({
        key: `${route.method} ${route.path}`,
        title: (
          <>
            <MethodBadge method={route.method} />
            <code>{route.path}</code>
          </>
        ),
        chips: route.needsToken ? <Chip>needs a token</Chip> : undefined,
        description: route.summary,
      }))}
    />
  );
}

export function InesHelperRoutes() {
  return (
    <>
      <Index
        items={agentData.http.helpers.map((helper) => ({
          id: `helper-${slug(helper.path)}`,
          label: <code>{helper.path}</code>,
          summary: firstSentence(helper.detail),
        }))}
      />
      {agentData.http.helpers.map((helper) => (
        <Entry key={helper.path} id={`helper-${slug(helper.path)}`} title={<code>{helper.path}</code>} description={helper.detail}>
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

export function MetricsTable({ metrics }: { metrics: MetricRow[] }) {
  return (
    <ItemList
      items={metrics.map((metric) => ({
        key: metric.name,
        title: <code>{metric.name}</code>,
        chips: <Chip>{metric.type}</Chip>,
        description: metric.help,
        meta:
          metric.labels.length === 0
            ? []
            : [
                [
                  "Labels",
                  <ul key="labels" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {metric.labels.map((label) => (
                      <li key={label}>
                        <code>{label}</code>
                        {metric.labelValues?.[label] ? <>: {metric.labelValues[label].join(", ")}</> : null}
                      </li>
                    ))}
                  </ul>,
                ],
              ],
      }))}
    />
  );
}

export function InesMetrics() {
  return <MetricsTable metrics={agentData.metrics} />;
}

export function InesMcpCorsHeaders() {
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

export function InesCount({ what }: { what: "backendTools" | "documentTools" | "workspaceTools" | "prompts" | "resources" }) {
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

export function InesScopedTools() {
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

export function InesMcpRoutes() {
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

export function InesMcpTools({ group }: { group: "backend" | "documents" | "workspace" }) {
  const tools = agentData.mcp.tools.filter((tool) => tool.group === group);
  return (
    <>
      <Index items={tools.map((tool) => ({ id: `ines-tool-${tool.name}`, label: <code>{tool.name}</code>, summary: firstSentence(tool.description) }))} />
      {tools.map((tool) => (
        <Entry
          key={tool.name}
          id={`ines-tool-${tool.name}`}
          title={<code>{tool.name}</code>}
          description={tool.description}
          chips={tool.scoped ? <Chip>checks the signed chat scope of every call</Chip> : undefined}
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

export function InesMcpPrompts() {
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

export function InesMcpResources() {
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
      <Index items={agentData.protocol.bridgeCommands.map((command) => ({ id: `bridge-${command.name}`, label: <code>{command.name}</code>, summary: firstSentence(command.description) }))} />
      {agentData.protocol.bridgeCommands.map((command) => (
        <Entry key={command.name} id={`bridge-${command.name}`} title={<code>{command.name}</code>} description={command.description}>
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
      if (!field.path.startsWith("x-ines-") || field.path.includes(".") || field.path.includes("[")) continue;
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

export function InesCoreTools() {
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
