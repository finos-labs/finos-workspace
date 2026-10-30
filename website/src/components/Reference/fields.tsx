import Link from "@docusaurus/Link";
import type { AgentField, SchemaProperty, TypeLabel } from "../../data/types";
import { type FieldNode, type FlatField, fieldTree, labelText, splitNotes } from "./fieldtree";
import { Chip } from "./kit";
import { Prose } from "./prose";
import styles from "./styles.module.css";

const ENUM_INLINE_LIMIT = 4;

export function fromSchema(properties: SchemaProperty[]): FlatField[] {
  return properties.map((property) => ({
    path: property.name,
    type: property.type,
    required: property.required,
    description: property.description,
    enumValues: property.enum,
    ...splitNotes(property.notes),
  }));
}

export function fromAgent(fields: AgentField[]): FlatField[] {
  return fields
    .filter((field) => !field.path.startsWith("x-ines-"))
    .map((field) => ({
      path: field.path,
      type: [field.type],
      required: field.required,
      description: field.description,
      constraints: field.limits ? [field.limits] : [],
    }));
}

export function TypeLabelText({ label, schemaPage = "" }: { label: TypeLabel; schemaPage?: string }) {
  return (
    <span className={styles.type}>
      {label.map((part, index) =>
        typeof part === "string" ? (
          <span key={index}>{part}</span>
        ) : (
          <Link key={index} to={`${schemaPage}#schema-${part.ref}`}>
            {part.ref}
          </Link>
        ),
      )}
    </span>
  );
}

function enumLabel(label: TypeLabel): TypeLabel {
  return labelText(label).endsWith(" | null") ? ["enum | null"] : ["enum"];
}

function FieldItem({ node, schemaPage }: { node: FieldNode; schemaPage: string }) {
  const { field } = node;
  const values = field.enumValues ?? [];
  const listed = values.length > ENUM_INLINE_LIMIT;
  return (
    <li className={styles.field}>
      <div className={styles.fieldHead}>
        <code className={styles.fieldName}>{node.name}</code>
        <TypeLabelText label={listed ? enumLabel(field.type) : field.type} schemaPage={schemaPage} />
        {field.required ? <Chip tone="required">required</Chip> : null}
        {field.defaultValue !== undefined ? (
          <span className={styles.default}>
            default <code>{field.defaultValue}</code>
          </span>
        ) : null}
        {field.constraints.map((constraint) => (
          <Chip key={constraint} tone={constraint === "deprecated" ? "warning" : undefined}>
            {constraint}
          </Chip>
        ))}
      </div>
      {field.description ? <Prose text={field.description} /> : null}
      {listed ? (
        <div className={styles.values}>
          <span className={styles.valuesLabel}>One of</span>
          {values.map((value) => (
            <code key={value}>{value}</code>
          ))}
        </div>
      ) : null}
      {node.children.length > 0 ? (
        <details className={styles.nested} open>
          <summary>{node.children.length === 1 ? "1 nested property" : `${node.children.length} nested properties`}</summary>
          <FieldList nodes={node.children} schemaPage={schemaPage} />
        </details>
      ) : null}
    </li>
  );
}

function FieldList({ nodes, schemaPage }: { nodes: FieldNode[]; schemaPage: string }) {
  return (
    <ul className={styles.fields}>
      {nodes.map((node, index) => (
        <FieldItem key={`${node.field.path}:${index}`} node={node} schemaPage={schemaPage} />
      ))}
    </ul>
  );
}

export function Fields({ fields, schemaPage = "", empty = "No fields." }: { fields: FlatField[]; schemaPage?: string; empty?: string }) {
  const nodes = fieldTree(fields);
  if (nodes.length === 0) return <p className={styles.muted}>{empty}</p>;
  return <FieldList nodes={nodes} schemaPage={schemaPage} />;
}
