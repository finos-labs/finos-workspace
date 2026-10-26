import { envData, settingsData, webConfigData } from "./data";
import { formatValue } from "./format";
import { Lines, TableWrap } from "./shared";
import styles from "./styles.module.css";

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
              <td>{field.values ? field.values.map((value) => `"${value}"`).join(" | ") : field.type}</td>
              <td>
                <code>{formatValue(field.default)}</code>
              </td>
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
              <td>
                <code>{field.type}</code>
              </td>
              <td>
                {field.required ? (
                  <strong>required</strong>
                ) : field.hasDefaultFactory ? (
                  <span className={styles.muted}>computed</span>
                ) : (
                  <code>{formatValue(field.default)}</code>
                )}
              </td>
              <td>{field.description || <span className={styles.muted}>not described in envs/.env.example</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function UnreadEnvExample() {
  const readNames = new Set(envData.agentProcessEnv.map((entry) => entry.name));
  const entries = envData.agent.entries.filter((entry) => !readNames.has(entry.name));
  const sections = Array.from(new Set(entries.map((entry) => entry.section)));
  return (
    <>
      {sections.map((section) => (
        <div key={section}>
          <h3>{section || "General"}</h3>
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Example</th>
                  <th>In the file</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {entries
                  .filter((entry) => entry.section === section)
                  .map((entry) => (
                    <tr key={entry.name}>
                      <td>
                        <code>{entry.name}</code>
                      </td>
                      <td>{entry.example ? <code>{entry.example}</code> : <span className={styles.muted}>empty</span>}</td>
                      <td>{entry.commented ? "commented out" : "set"}</td>
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

export function ProcessEnvTable() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Read in</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {envData.agentProcessEnv.map((entry) => (
            <tr key={entry.name}>
              <td>
                <code>{entry.name}</code>
              </td>
              <td>
                <Lines items={entry.files} />
              </td>
              <td>{entry.description || <span className={styles.muted}>not described in agent/.env.example</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
