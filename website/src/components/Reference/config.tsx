import type { AgentEnvVariable, WebConfigField } from "../../data/types";
import { envData, settingsData, webConfigData, webData } from "./data";
import { amount, formatValue, type Unit } from "./format";
import { TableWrap } from "./shared";
import styles from "./styles.module.css";

function webConfigType(field: WebConfigField): string {
  const quoted = (values: string[]) => values.map((value) => `"${value}"`).join(" | ");
  if (field.values) return quoted(field.values);
  if (field.itemValues) return `${field.type} of ${quoted(field.itemValues)}`;
  return field.type;
}

export function WebConfigTable({ group }: { group: string }) {
  const found = webConfigData.groups.find((item) => item.name === group);
  if (found === undefined) throw new Error(`No web config group ${group}`);
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Setting</th>
            <th>Container variable</th>
            <th>Build variable</th>
            <th>Type</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {found.fields.map((field) => (
            <tr key={field.path}>
              <td>
                <code>{field.path}</code>
              </td>
              <td>
                <code>{field.containerVariable}</code>
              </td>
              <td>
                <code>{field.buildVariable}</code>
              </td>
              <td>{webConfigType(field)}</td>
              <td>
                <code>{formatValue(field.default)}</code>
              </td>
              <td>{field.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function WebBuildVariables() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Values</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {webConfigData.buildVariables.map((variable) => (
            <tr key={variable.name}>
              <td>
                <code>{variable.name}</code>
              </td>
              <td>{variable.values ? variable.values.map((value) => `"${value}"`).join(" | ") : "any text"}</td>
              <td>{variable.default === null ? <span className={styles.muted}>none</span> : <code>{variable.default}</code>}</td>
              <td>{variable.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function SettingsTable({ group }: { group: string }) {
  const fields = settingsData.fields.filter((field) => field.group === group);
  if (fields.length === 0) throw new Error(`No settings group ${group}`);
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Type</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.name}>
              <td>
                <code>{field.name}</code>
              </td>
              <td>{field.choices ? <code>{field.choices.map((value) => `"${value}"`).join(" | ")}</code> : <code>{field.type}</code>}</td>
              <td>
                {field.required ? (
                  <strong>required</strong>
                ) : field.hasDefaultFactory ? (
                  <span className={styles.muted}>computed</span>
                ) : (
                  <code>{formatValue(field.default)}</code>
                )}
              </td>
              <td>{field.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function agentEnvType(entry: AgentEnvVariable): string {
  const quoted = (values: string[]) => values.map((value) => `"${value}"`).join(" | ");
  if (entry.choices) return quoted(entry.choices);
  if (entry.providers) {
    const shape = entry.type === "model-list" ? "comma-separated <provider>:<model>" : "<provider>:<model>";
    return `${shape}, with provider ${quoted(entry.providers)}`;
  }
  return entry.type;
}

export function AgentEnvTable() {
  const groups = Array.from(new Set(envData.agent.map((entry) => entry.group)));
  return (
    <>
      {groups.map((group) => (
        <div key={group}>
          <h3>{group}</h3>
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Read by</th>
                  <th>Type</th>
                  <th>Default</th>
                  <th>Required</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {envData.agent
                  .filter((entry) => entry.group === group)
                  .map((entry) => (
                    <tr key={entry.name}>
                      <td>
                        <code>{entry.name}</code>
                      </td>
                      <td>{entry.readBy.join(" and ")}</td>
                      <td>{agentEnvType(entry)}</td>
                      <td>{entry.default === null ? <span className={styles.muted}>none</span> : <code>{entry.default}</code>}</td>
                      <td>{entry.required ?? <span className={styles.muted}>no</span>}</td>
                      <td>{entry.description}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      ))}
    </>
  );
}

export function EnvDefault({ name }: { name: string }) {
  const entry = envData.agent.find((item) => item.name === name);
  if (entry === undefined) throw new Error(`No agent variable ${name}`);
  if (entry.default === null) throw new Error(`The agent variable ${name} has no default`);
  return <>{entry.default}</>;
}

export function SettingDefault({ name, unit }: { name: string; unit?: Unit }) {
  const field = settingsData.fields.find((item) => item.name === name);
  if (field === undefined) throw new Error(`No backend setting ${name}`);
  if (typeof field.default === "number") return <>{amount(field.default, unit)}</>;
  if (typeof field.default === "string") return <>{field.default}</>;
  throw new Error(`The backend setting ${name} has no number or text as its default`);
}

export function SettingConstant({ name, unit }: { name: string; unit?: Unit }) {
  const value = settingsData.constants[name];
  if (value === undefined) throw new Error(`No backend constant ${name}`);
  return <>{typeof value === "number" ? amount(value, unit) : value}</>;
}

export function WebPort() {
  return <>{webData.port}</>;
}
