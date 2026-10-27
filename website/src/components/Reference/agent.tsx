import Heading from "@theme/Heading";
import type { AgentData, AgentField } from "../../data/types";
import { agentData } from "./data";
import { amount, slug, type Unit } from "./format";
import { Contents, TableWrap } from "./shared";
import styles from "./styles.module.css";

const MEBIBYTE = 1024 * 1024;

function bytes(value: number): string {
  return value % MEBIBYTE === 0 ? `${value / MEBIBYTE} MiB` : `${(value / MEBIBYTE).toFixed(2).replace(/\.?0+$/, "")} MiB`;
}

function isInternal(field: AgentField): boolean {
  return field.path.startsWith("x-ines-");
}

export function FieldTable({ fields, depth = 0, prefix = "" }: { fields: AgentField[]; depth?: number; prefix?: string }) {
  const rows = fields
    .filter((field) => field.path.startsWith(prefix) && !isInternal(field))
    .map((field) => ({ field, shown: prefix === "" ? field.path : field.path.slice(prefix.length) }))
    .filter(({ shown }) => shown.split(/\.|\[\]/).filter(Boolean).length <= depth + 1);
  if (rows.length === 0) return <p>No fields.</p>;
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Required</th>
            <th>Limits</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ field, shown }) => (
            <tr key={field.path}>
              <td>
                <code>{shown}</code>
              </td>
              <td>{field.type}</td>
              <td>{field.required ? "yes" : "no"}</td>
              <td>{field.limits ?? <span className={styles.muted}>none</span>}</td>
              <td>{field.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function InesLimit({ name }: { name: "helperBodyBytes" | "transcribeBodyBytes" | "audioBytes" | "defaultMaxBodyMb" }) {
  const limits = agentData.http.limits;
  return <>{name === "defaultMaxBodyMb" ? limits[name] : bytes(limits[name])}</>;
}

export function InesRoutes() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Method and path</th>
            <th>Needs a token</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {agentData.http.routes.map((route) => (
            <tr key={`${route.method} ${route.path}`}>
              <td>
                <code>
                  {route.method} {route.path}
                </code>
              </td>
              <td>{route.needsToken ? "Yes" : "No"}</td>
              <td>{route.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function InesHelperRoutes() {
  return (
    <>
      {agentData.http.helpers.map((helper) => (
        <div key={helper.path} className={styles.block}>
          <Heading as="h3" id={`helper-${slug(helper.path)}`}>
            <code>{helper.path}</code>
          </Heading>
          <p>{helper.detail}</p>
          {helper.fields.length > 0 ? <FieldTable fields={helper.fields} depth={1} /> : null}
          <p>
            <strong>Answer.</strong> {helper.answer}
          </p>
          <p>
            <strong>Fallback.</strong> {helper.fallback}
          </p>
        </div>
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
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Type</th>
            <th>Labels</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => (
            <tr key={metric.name}>
              <td>
                <code>{metric.name}</code>
              </td>
              <td>{metric.type}</td>
              <td>
                {metric.labels.length === 0 ? (
                  <span className={styles.muted}>none</span>
                ) : (
                  <ul className={styles.lines}>
                    {metric.labels.map((label) => (
                      <li key={label}>
                        <code>{label}</code>
                        {metric.labelValues?.[label] ? <>: {metric.labelValues[label].join(", ")}</> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td>{metric.help}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
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
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Method and path</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {agentData.mcp.routes.map((route) => (
            <tr key={`${route.method} ${route.path}`}>
              <td>
                <code>
                  {route.method} {route.path}
                </code>
              </td>
              <td>{route.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function InesMcpTools({ group }: { group: "backend" | "documents" | "workspace" }) {
  const tools = agentData.mcp.tools.filter((tool) => tool.group === group);
  return (
    <>
      <Contents items={tools.map((tool) => ({ id: `ines-tool-${tool.name}`, label: tool.name }))} />
      {tools.map((tool) => (
        <div key={tool.name} className={styles.block}>
          <Heading as="h3" id={`ines-tool-${tool.name}`}>
            <code>{tool.name}</code>
          </Heading>
          <p>
            <strong>Registered:</strong> {tool.availability}
            {tool.scoped ? " The tool checks the signed chat scope of every call." : ""}
          </p>
          <p className={styles.pre}>{tool.description}</p>
          <FieldTable fields={tool.fields} depth={1} />
        </div>
      ))}
    </>
  );
}

export function InesMcpPrompts() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Prompt</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {agentData.mcp.prompts.map((prompt) => (
            <tr key={prompt.name}>
              <td>
                <code>{prompt.name}</code>
              </td>
              <td>{prompt.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function InesMcpResources() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>URI</th>
            <th>Name</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {agentData.mcp.resources.map((resource) => (
            <tr key={resource.uri}>
              <td>
                <code>{resource.uri}</code>
              </td>
              <td>{resource.name}</td>
              <td>{resource.mimeType}</td>
              <td>{resource.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
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
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Fields of data</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {agentData.protocol.events.map((event) => (
            <tr key={event.event}>
              <td>
                <code>{event.event}</code>
              </td>
              <td>{event.fields}</td>
              <td>{event.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function ExtraStateKeys() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Content</th>
          </tr>
        </thead>
        <tbody>
          {agentData.protocol.extraState.map((entry) => (
            <tr key={entry.key}>
              <td>
                <code>{entry.key}</code>
              </td>
              <td>{entry.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function BridgeCommands() {
  return (
    <>
      <Contents items={agentData.protocol.bridgeCommands.map((command) => ({ id: `bridge-${command.name}`, label: command.name }))} />
      {agentData.protocol.bridgeCommands.map((command) => (
        <div key={command.name} className={styles.block}>
          <Heading as="h3" id={`bridge-${command.name}`}>
            <code>{command.name}</code>
          </Heading>
          <p className={styles.pre}>{command.description}</p>
          <FieldTable fields={command.fields} depth={1} />
        </div>
      ))}
    </>
  );
}

export function ToolGroups() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Group</th>
            <th>What the tools do</th>
            <th>Tools</th>
            <th>Loaded</th>
          </tr>
        </thead>
        <tbody>
          {agentData.protocol.toolGroups.map((group) => (
            <tr key={group.id}>
              <td>
                <code>{group.id}</code>
              </td>
              <td>{group.summary}</td>
              <td>
                {group.tools.length === 0 ? (
                  <span className={styles.muted}>the tools that the Workspace supplies</span>
                ) : (
                  <ul className={styles.lines}>
                    {group.tools.map((tool) => (
                      <li key={tool}>
                        <code>{tool}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td>{group.alwaysLoaded ? "always" : "when the model asks for it with load_tools"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
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
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Argument</th>
            <th>Sent to</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {[...rows.entries()].map(([name, row]) => (
            <tr key={name}>
              <td>
                <code>{name}</code>
              </td>
              <td>
                <ul className={styles.lines}>
                  {row.tools.map((tool) => (
                    <li key={tool}>
                      <code>{tool}</code>
                    </li>
                  ))}
                </ul>
              </td>
              <td>{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
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
