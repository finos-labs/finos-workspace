import type { PluginState, PluginValueType, ProtocolMessage } from "../../data/types";
import { FieldTable, MetricsTable } from "./agent";
import { pluginsData } from "./data";
import { amount, type Unit } from "./format";
import { TableWrap } from "./shared";
import styles from "./styles.module.css";

export function Codes({ items, or }: { items: string[]; or?: boolean }) {
  const last = or ? " or " : " and ";
  return (
    <>
      {items.map((item, index) => (
        <span key={item}>
          {index > 0 ? (index === items.length - 1 ? last : ", ") : ""}
          <code>{item}</code>
        </span>
      ))}
    </>
  );
}

export function FactValue({
  values,
  of,
  unit,
  plain,
  or,
}: {
  values: Record<string, PluginValueType>;
  of: string;
  unit?: Unit;
  plain?: boolean;
  or?: boolean;
}) {
  const value = values[of];
  if (value === undefined) throw new Error(`The reference has no value ${of}`);
  if (Array.isArray(value)) return <Codes items={value} or={or} />;
  if (typeof value === "string") return plain ? <>{value}</> : <code>{value}</code>;
  return <>{amount(value, unit)}</>;
}

export function PluginValue({ of, unit, plain, or }: { of: string; unit?: Unit; plain?: boolean; or?: boolean }) {
  return <FactValue values={pluginsData.values} of={of} unit={unit} plain={plain} or={or} />;
}

export function PluginList({
  of,
  or,
}: {
  of: "permissionsLater" | "commandErrors" | "exportMembers" | "traits" | "builtInTypes";
  or?: boolean;
}) {
  return <Codes items={pluginsData[of]} or={or} />;
}

export function PluginPermissions() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Permission</th>
            <th>What it allows</th>
          </tr>
        </thead>
        <tbody>
          {pluginsData.permissions.map((permission) => (
            <tr key={permission.name}>
              <td>
                <code>{permission.name}</code>
              </td>
              <td>{permission.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function PluginStates({ kind }: { kind: "plugin" | "version" }) {
  const states: PluginState[] = pluginsData.states[kind];
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>State</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {states.map((state) => (
            <tr key={state.state}>
              <td>
                <code>{state.state}</code>
              </td>
              <td>{state.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function PluginMetrics() {
  return <MetricsTable metrics={pluginsData.metrics} />;
}

export function CspFloor() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Directive</th>
            <th>Sources of the floor</th>
          </tr>
        </thead>
        <tbody>
          {pluginsData.cspFloor.map((entry) => (
            <tr key={entry.directive}>
              <td>
                <code>{entry.directive}</code>
              </td>
              <td>
                <Codes items={entry.sources} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function summary(field: ProtocolMessage["fields"][number]): string {
  return [field.type, field.required ? null : "optional", field.limits].filter(Boolean).join(", ");
}

export function MessageTable({ messages }: { messages: ProtocolMessage[] }) {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>
              <code>t</code>
            </th>
            <th>Fields</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {messages.map((message) => (
            <tr key={message.t}>
              <td>
                <code>{message.t}</code>
              </td>
              <td>
                {message.fields.length === 0 ? (
                  <span className={styles.muted}>none</span>
                ) : (
                  <ul className={styles.lines}>
                    {message.fields.map((field) => (
                      <li key={field.path}>
                        <code>{field.path}</code>: {summary(field)}
                        {field.description ? `. ${field.description}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td>{message.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function PluginGuestMessages() {
  return <MessageTable messages={pluginsData.guestMessages} />;
}

export function PluginHostMessages() {
  return <MessageTable messages={pluginsData.hostMessages} />;
}

export function PluginExportOption() {
  return <FieldTable fields={pluginsData.exportOption} depth={1} />;
}
