import { Fields, fromSchema, TypeLabelText } from "./fields";
import { Chip, Entry, MethodBadge, Section, StatusBadge } from "./kit";
import { slug } from "./format";
import { Prose } from "./prose";
import styles from "./styles.module.css";
import type { ApiOperation, SchemaDoc, TypeLabel } from "../../data/types";

const LOCATIONS: { location: string; title: string }[] = [
  { location: "path", title: "Path parameters" },
  { location: "query", title: "Query parameters" },
  { location: "header", title: "Header parameters" },
  { location: "cookie", title: "Cookie parameters" },
];

function operationId(method: string, path: string): string {
  return `op-${method.toLowerCase()}-${slug(path)}`;
}

function referenced(label: TypeLabel, schemas: SchemaDoc[]): SchemaDoc[] {
  const names = label.flatMap((part) => (typeof part === "string" ? [] : [part.ref]));
  return names.flatMap((name) => schemas.filter((schema) => schema.name === name));
}

function SchemaDetails({
  label,
  schemaPage,
  schemas,
  open,
}: {
  label: TypeLabel;
  schemaPage: string;
  schemas: SchemaDoc[];
  open?: boolean;
}) {
  return (
    <>
      {referenced(label, schemas).map((schema) => (
        <details key={schema.name} className={styles.schemaBlock} open={open}>
          <summary>{schema.name}</summary>
          {schema.description ? <Prose text={schema.description} /> : null}
          <Fields fields={fromSchema(schema.properties)} schemaPage={schemaPage} empty="This schema has no named properties." />
        </details>
      ))}
    </>
  );
}

export function Operation({
  operation,
  schemaPage,
  schemas,
}: {
  operation: ApiOperation;
  schemaPage: string;
  schemas: SchemaDoc[];
}) {
  const parameters = (location: string) => operation.parameters.filter((parameter) => parameter.in === location);
  return (
    <Entry
      id={operationId(operation.method, operation.path)}
      badge={<MethodBadge method={operation.method} />}
      title={<code>{operation.path}</code>}
      lead={operation.summary}
      description={operation.description}
      chips={operation.secured ? <Chip>needs a token</Chip> : undefined}
      collapsed
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
          <SchemaDetails label={operation.requestBody.schema} schemaPage={schemaPage} schemas={schemas} open />
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
              {response.schema ? <SchemaDetails label={response.schema} schemaPage={schemaPage} schemas={schemas} /> : null}
            </li>
          ))}
        </ul>
      </Section>
    </Entry>
  );
}

/** Renders the operations of an OpenAPI document, the way the API reference pages do. */
export function ApiOperations({
  operations,
  schemas,
  schemaPage,
}: {
  operations: ApiOperation[];
  schemas: SchemaDoc[];
  schemaPage: string;
}) {
  return (
    <>
      {operations.map((operation) => (
        <Operation
          key={`${operation.method} ${operation.path}`}
          operation={operation}
          schemaPage={schemaPage}
          schemas={schemas}
        />
      ))}
    </>
  );
}
