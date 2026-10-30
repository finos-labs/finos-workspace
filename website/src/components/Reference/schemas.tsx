import type { ReactNode } from "react";
import type { SchemaDoc } from "../../data/types";
import { databaseData, schemaSets } from "./data";
import { Fields, fromSchema, TypeLabelText } from "./fields";
import { Chip, Entry, Index, Section } from "./kit";
import { TableWrap } from "./shared";
import styles from "./styles.module.css";

function SchemaFields({ doc, schemaPage }: { doc: SchemaDoc; schemaPage: string }) {
  return <Fields fields={fromSchema(doc.properties)} schemaPage={schemaPage} empty="This schema has no named properties." />;
}

const RULE_LENGTH = 30;

interface Heading {
  name: string;
  title: ReactNode;
  description?: string;
}

function SchemaBlock({ doc, id, heading }: { doc: SchemaDoc; id: string; heading?: Heading }) {
  const rules = doc.notes.filter((note) => note.length > RULE_LENGTH);
  return (
    <Entry
      id={id}
      level={heading ? 2 : 3}
      title={heading ? heading.title : <code>{doc.name}</code>}
      description={[heading?.description, doc.description].filter((text) => text !== undefined).join("\n\n")}
      chips={
        <>
          <TypeLabelText label={doc.type} />
          {doc.notes
            .filter((note) => note.length <= RULE_LENGTH)
            .map((note) => (
              <Chip key={note}>{note}</Chip>
            ))}
        </>
      }
    >
      {doc.properties.length > 0 ? (
        <Section title="Properties">
          <SchemaFields doc={doc} schemaPage="" />
        </Section>
      ) : null}
      {rules.length > 0 ? (
        <Section title="Rules">
          <ul>
            {rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </Entry>
  );
}

export function SchemaTable({ set, name, schemaPage }: { set: keyof typeof schemaSets; name?: string; schemaPage: string }) {
  const data = schemaSets[set];
  const doc = name === undefined ? data.root : data.definitions.find((definition) => definition.name === name);
  if (doc === undefined) throw new Error(`The schema set ${set} has no ${name ?? "root"}`);
  return <SchemaFields doc={doc} schemaPage={schemaPage} />;
}

export function SchemaSource({ set }: { set: keyof typeof schemaSets }) {
  const data = schemaSets[set];
  const docs = [...(data.root ? [{ ...data.root, name: data.title }] : []), ...data.definitions].filter((doc) => doc.json !== undefined);
  return (
    <>
      {docs.map((doc) => (
        <details key={doc.name} className={styles.source}>
          <summary>
            <code>{doc.name}</code>
          </summary>
          <pre className={styles.json}>
            <code>{JSON.stringify(doc.json, null, 2)}</code>
          </pre>
        </details>
      ))}
    </>
  );
}

export function SchemaDocs({
  set,
  show,
  root = true,
}: {
  set: keyof typeof schemaSets;
  show?: (string | Heading)[];
  root?: boolean;
}) {
  const data = schemaSets[set];
  const headings = show?.map((item) => (typeof item === "string" ? { name: item, title: item } : item));
  const definitions =
    headings === undefined ? data.definitions.map((doc) => ({ doc, heading: undefined })) : headings.flatMap((heading) => data.definitions.filter((doc) => doc.name === heading.name).map((doc) => ({ doc, heading })));
  const items = [
    ...(root && data.root ? [{ id: "schema-root", label: <code>{data.title}</code> }] : []),
    ...definitions.map(({ doc }) => ({ id: `schema-${doc.name}`, label: <code>{doc.name}</code> })),
  ];
  const named = headings?.some((heading) => heading.title !== heading.name) ?? false;
  return (
    <>
      {named ? null : <Index items={items} />}
      {root && data.root ? <SchemaBlock doc={{ ...data.root, name: data.title }} id="schema-root" /> : null}
      {definitions.map(({ doc, heading }) => (
        <SchemaBlock key={doc.name} doc={doc} id={`schema-${doc.name}`} heading={named ? heading : undefined} />
      ))}
    </>
  );
}

export function DatabaseTables() {
  return (
    <>
      <Index items={databaseData.tables.map((table) => ({ id: `table-${table.name}`, label: <code>{table.name}</code> }))} />
      {databaseData.tables.map((table) => (
        <Entry key={table.name} id={`table-${table.name}`} title={<code>{table.name}</code>}>
          <Section title="Columns">
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Null</th>
                  <th>Key</th>
                  <th>References</th>
                  <th>Server default</th>
                </tr>
              </thead>
              <tbody>
                {table.columns.map((column) => (
                  <tr key={column.name}>
                    <td>
                      <code>{column.name}</code>
                    </td>
                    <td>
                      <code>{column.type}</code>
                    </td>
                    <td>{column.nullable ? "yes" : "no"}</td>
                    <td>{[column.primaryKey ? "primary" : "", column.unique ? "unique" : "", column.indexed ? "indexed" : ""].filter(Boolean).join(", ")}</td>
                    <td>
                      {column.references.map((reference) => (
                        <code key={reference.column}>
                          {reference.column}
                          {reference.onDelete ? ` (on delete ${reference.onDelete})` : ""}
                        </code>
                      ))}
                    </td>
                    <td>{column.serverDefault ? <code>{column.serverDefault}</code> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          </Section>
          {table.indexes.length + table.uniqueConstraints.length > 0 ? (
            <Section title="Indexes and constraints">
            <ul>
              {table.indexes.map((index, position) => (
                <li key={`index-${position}`}>
                  {index.unique ? "Unique index" : "Index"} <code>{index.name}</code> on <code>{index.columns.join(", ")}</code>
                </li>
              ))}
              {table.uniqueConstraints.map((constraint, position) => (
                <li key={`unique-${position}`}>
                  Unique constraint {constraint.name ? <code>{constraint.name}</code> : null} on <code>{constraint.columns.join(", ")}</code>
                </li>
              ))}
            </ul>
            </Section>
          ) : null}
        </Entry>
      ))}
    </>
  );
}
