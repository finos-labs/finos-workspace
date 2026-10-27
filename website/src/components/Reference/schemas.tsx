import Heading from "@theme/Heading";
import type { SchemaDoc } from "../../data/types";
import { databaseData, schemaSets } from "./data";
import { Contents, Lines, TableWrap, TypeText } from "./shared";
import styles from "./styles.module.css";

function PropertyTable({ doc, schemaPage }: { doc: SchemaDoc; schemaPage: string }) {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Type</th>
            <th>Required</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {doc.properties.map((property) => (
            <tr key={property.name}>
              <td>
                <code>{property.name}</code>
              </td>
              <td>
                <TypeText type={property.type} schemaPage={schemaPage} />
              </td>
              <td>{property.required ? "yes" : "no"}</td>
              <td>
                {property.description ? <p>{property.description}</p> : null}
                {property.notes.length > 0 ? <Lines items={property.notes} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function SchemaBlock({ doc, id }: { doc: SchemaDoc; id: string }) {
  return (
    <div className={styles.block}>
      <Heading as="h3" id={id}>
        <code>{doc.name}</code>
      </Heading>
      {doc.description ? <p>{doc.description}</p> : null}
      <p>
        Type: <TypeText type={doc.type} />
      </p>
      {doc.notes.length > 0 ? (
        <ul>
          {doc.notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      ) : null}
      {doc.properties.length > 0 ? <PropertyTable doc={doc} schemaPage="" /> : null}
    </div>
  );
}

export function SchemaTable({ set, name, schemaPage }: { set: keyof typeof schemaSets; name?: string; schemaPage: string }) {
  const data = schemaSets[set];
  const doc = name === undefined ? data.root : data.definitions.find((definition) => definition.name === name);
  if (doc === undefined) throw new Error(`The schema set ${set} has no ${name ?? "root"}`);
  return <PropertyTable doc={doc} schemaPage={schemaPage} />;
}

export function SchemaDocs({ set }: { set: keyof typeof schemaSets }) {
  const data = schemaSets[set];
  const items = [
    ...(data.root ? [{ id: "schema-root", label: data.title }] : []),
    ...data.definitions.map((doc) => ({ id: `schema-${doc.name}`, label: doc.name })),
  ];
  return (
    <>
      <Contents items={items} />
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
      <Contents items={databaseData.tables.map((table) => ({ id: `table-${table.name}`, label: table.name }))} />
      {databaseData.tables.map((table) => (
        <div key={table.name} className={styles.block}>
          <Heading as="h3" id={`table-${table.name}`}>
            <code>{table.name}</code>
          </Heading>
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
          {table.indexes.length + table.uniqueConstraints.length > 0 ? (
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
          ) : null}
        </div>
      ))}
    </>
  );
}
