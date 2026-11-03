import { agentsJsonData } from "./data";
import { ItemList } from "./kit";
import styles from "./styles.module.css";

export function AgentFeatures() {
  return (
    <ItemList
      items={agentsJsonData.features.map(({ key, description }) => ({
        key,
        title: <code className={styles.fieldName}>{key}</code>,
        description,
      }))}
    />
  );
}

export function AgentsFileExample() {
  const groups: { feature: string; variables: string[] }[] = [];
  for (const { feature, variable } of agentsJsonData.conditional) {
    const found = groups.find((group) => group.feature === feature);
    if (found) found.variables.push(variable);
    else groups.push({ feature, variables: [variable] });
  }
  return (
    <>
      <pre className={styles.json}>
        <code>{JSON.stringify(agentsJsonData.file, null, 2)}</code>
      </pre>
      <ul>
        {groups.map(({ feature, variables }) => (
          <li key={feature}>
            <code>features.{feature}</code> is present only when{" "}
            {variables.map((variable, index) => (
              <span key={variable}>
                {index > 0 ? " or " : ""}
                <code>{variable}</code>
              </span>
            ))}{" "}
            is set.
          </li>
        ))}
      </ul>
    </>
  );
}
