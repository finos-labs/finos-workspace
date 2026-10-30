import type { AgentEnvVariable, WebConfigField } from "../../data/types";
import { envData, settingsData, webConfigData, webData } from "./data";
import { amount, formatValue, type Unit } from "./format";
import { Chip, ItemList } from "./kit";
import { FactValue } from "./plugins";

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
    <ItemList
      items={found.fields.map((field) => ({
        key: field.path,
        id: `setting-${field.path}`,
        title: <code>{field.path}</code>,
        chips: (
          <>
            <Chip>{webConfigType(field)}</Chip>
            <Chip>default {formatValue(field.default)}</Chip>
          </>
        ),
        description: field.description,
        meta: [
          ["Container variable", <code key="container">{field.containerVariable}</code>],
          ["Build variable", <code key="build">{field.buildVariable}</code>],
        ],
      }))}
    />
  );
}

export function WebBuildVariables() {
  return (
    <ItemList
      items={webConfigData.buildVariables.map((variable) => ({
        key: variable.name,
        id: `build-${variable.name}`,
        title: <code>{variable.name}</code>,
        chips: (
          <>
            <Chip>{variable.values ? variable.values.map((value) => `"${value}"`).join(" | ") : "any text"}</Chip>
            <Chip>default {variable.default === null ? "none" : variable.default}</Chip>
          </>
        ),
        description: variable.description,
      }))}
    />
  );
}

export function SettingsTable({ group }: { group: string }) {
  const fields = settingsData.fields.filter((field) => field.group === group);
  if (fields.length === 0) throw new Error(`No settings group ${group}`);
  return (
    <ItemList
      items={fields.map((field) => ({
        key: field.name,
        id: `setting-${field.name}`,
        title: <code>{field.name}</code>,
        chips: (
          <>
            <Chip>{field.choices ? field.choices.map((value) => `"${value}"`).join(" | ") : field.type}</Chip>
            {field.required ? (
              <Chip tone="required">required</Chip>
            ) : (
              <Chip>{field.hasDefaultFactory ? "computed default" : `default ${formatValue(field.default)}`}</Chip>
            )}
          </>
        ),
        description: field.description,
      }))}
    />
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
          <ItemList
            items={envData.agent
              .filter((entry) => entry.group === group)
              .map((entry) => ({
                key: entry.name,
                id: `env-${entry.name}`,
                title: <code>{entry.name}</code>,
                chips: (
                  <>
                    <Chip>{agentEnvType(entry)}</Chip>
                    {entry.default === null ? null : <Chip>default {entry.default}</Chip>}
                    {entry.required === null ? null : <Chip tone="required">{entry.required}</Chip>}
                  </>
                ),
                description: entry.description,
                meta: [["Read by", entry.readBy.join(" and ")]],
              }))}
          />
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

export function WebAppValue({
  of,
  unit,
  plain,
  or,
}: {
  of: string;
  unit?: Unit;
  plain?: boolean;
  or?: boolean;
}) {
  return <FactValue values={webData.values} of={of} unit={unit} plain={plain} or={or} />;
}
