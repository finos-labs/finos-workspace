import type { SchemaDoc } from "../../data/types";
import { databaseData, schemaSets } from "./data";
import { Fields, fromSchema, TypeLabelText } from "./fields";
import { Chip, Entry, Index, Section } from "./kit";
import { TableWrap } from "./shared";

function SchemaFields({ doc, schemaPage }: { doc: SchemaDoc; schemaPage: string }) {
  return <Fields fields={fromSchema(doc.properties)} schemaPage={schemaPage} empty="This schema has no named properties." />;
}

function SchemaBlock({ doc, id }: { doc: SchemaDoc; id: string }) {
  return (
    <Entry
      id={id}
      title={<code>{doc.name}</code>}
      description={doc.description}
      chips={
        <>
          <TypeLabelText label={doc.type} />
          {doc.notes.map((note) => (
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
    </Entry>
  );
}

export function SchemaTable({ set, name, schemaPage }: { set: keyof typeof schemaSets; name?: string; schemaPage: string }) {
  const data = schemaSets[set];
  const doc = name === undefined ? data.root : data.definitions.find((definition) => definition.name === name);
  if (doc === undefined) throw new Error(`The schema set ${set} has no ${name ?? "root"}`);
  return <SchemaFields doc={doc} schemaPage={schemaPage} />;
}

export function SchemaDocs({ set }: { set: keyof typeof schemaSets }) {
  const data = schemaSets[set];
  const items = [
    ...(data.root ? [{ id: "schema-root", label: <code>{data.title}</code> }] : []),
    ...data.definitions.map((doc) => ({ id: `schema-${doc.name}`, label: <code>{doc.name}</code> })),
  ];
  return (
    <>
      <Index items={items} />
      {data.root ? <SchemaBlock doc={{ ...data.root, name: data.title }} id="schema-root" /> : null}
      {data.definitions.map((doc) => (
        <SchemaBlock key={doc.name} doc={doc} id={`schema-${doc.name}`} />
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
