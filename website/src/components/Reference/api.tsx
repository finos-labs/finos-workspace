import { MetricsTable } from "./agent";
import { Fields, fromSchema, TypeLabelText } from "./fields";
import { Chip, Entry, MethodBadge, Section, StatusBadge } from "./kit";
import { agentData, apiData, pluginsData } from "./data";
import { slug } from "./format";
import { Prose } from "./prose";
import styles from "./styles.module.css";
import type { ApiOperation, SchemaDoc, TypeLabel } from "../../data/types";

export function ApiMetrics() {
  return <MetricsTable metrics={apiData.metrics} />;
}

export function MetricName({ name }: { name: string }) {
  const known = [...apiData.metrics, ...agentData.metrics, ...pluginsData.metrics].some((metric) => metric.name === name);
  if (!known) throw new Error(`No metric is named ${name}`);
  return <code>{name}</code>;
}

const LOCATIONS: { location: string; title: string }[] = [
  { location: "path", title: "Path parameters" },
  { location: "query", title: "Query parameters" },
  { location: "header", title: "Header parameters" },
  { location: "cookie", title: "Cookie parameters" },
];

function operationId(method: string, path: string): string {
  return `op-${method.toLowerCase()}-${slug(path)}`;
}

function referenced(label: TypeLabel): SchemaDoc[] {
  const names = label.flatMap((part) => (typeof part === "string" ? [] : [part.ref]));
  return names.flatMap((name) => apiData.schemas.filter((schema) => schema.name === name));
}

function SchemaDetails({ label, schemaPage, open }: { label: TypeLabel; schemaPage: string; open?: boolean }) {
  return (
    <>
      {referenced(label).map((schema) => (
        <details key={schema.name} className={styles.schemaBlock} open={open}>
          <summary>{schema.name}</summary>
          {schema.description ? <Prose text={schema.description} /> : null}
          <Fields fields={fromSchema(schema.properties)} schemaPage={schemaPage} empty="This schema has no named properties." />
        </details>
      ))}
    </>
  );
}

function Operation({ operation, schemaPage }: { operation: ApiOperation; schemaPage: string }) {
  const parameters = (location: string) => operation.parameters.filter((parameter) => parameter.in === location);
  return (
    <Entry
      id={operationId(operation.method, operation.path)}
      badge={<MethodBadge method={operation.method} />}
      title={<code>{operation.path}</code>}
      lead={operation.summary}
      description={operation.description}
    >
      {LOCATIONS.map(({ location, title }) =>
        parameters(location).length > 0 ? (
          <Section key={location} title={title}>
            <Fields
              schemaPage={schemaPage}
              fields={parameters(location).map((parameter) => ({
                path: parameter.name,
                type: parameter.type,
                required: parameter.required,
                description: parameter.description,
                constraints: [],
              }))}
            />
          </Section>
        ) : null,
      )}
      {operation.requestBody ? (
        <Section title="Request body">
          <div className={styles.responseHead}>
            <code>{operation.requestBody.contentType}</code>
            <TypeLabelText label={operation.requestBody.schema} schemaPage={schemaPage} />
            {operation.requestBody.required ? <Chip tone="required">required</Chip> : null}
          </div>
          <SchemaDetails label={operation.requestBody.schema} schemaPage={schemaPage} open />
        </Section>
      ) : null}
      <Section title="Responses">
        <ul className={styles.responses}>
          {operation.responses.map((response) => (
            <li key={response.code} className={styles.response}>
              <div className={styles.responseHead}>
                <StatusBadge code={response.code} />
                {response.description ? <span>{response.description}</span> : null}
                {response.schema ? <TypeLabelText label={response.schema} schemaPage={schemaPage} /> : null}
              </div>
              {response.schema ? <SchemaDetails label={response.schema} schemaPage={schemaPage} /> : null}
            </li>
          ))}
        </ul>
      </Section>
    </Entry>
  );
}

export function ApiTag({ tag, schemaPage }: { tag: string; schemaPage: string }) {
  const found = apiData.tags.find((item) => item.name === tag);
  if (found === undefined) throw new Error(`No API tag ${tag}`);
  return (
    <>
      <ul className={styles.index}>
        {found.operations.map((operation) => (
          <li key={`${operation.method} ${operation.path}`}>
            <MethodBadge method={operation.method} />
            <a href={`#${operationId(operation.method, operation.path)}`}>
              <code>{operation.path}</code>
            </a>
            <span className={styles.indexSummary}>{operation.summary}</span>
          </li>
        ))}
      </ul>
      {found.operations.map((operation) => (
        <Operation key={`${operation.method} ${operation.path}`} operation={operation} schemaPage={schemaPage} />
      ))}
    </>
  );
}
