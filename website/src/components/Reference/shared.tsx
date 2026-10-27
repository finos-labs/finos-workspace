import Link from "@docusaurus/Link";
import type { ReactNode } from "react";
import type { TypeLabel } from "../../data/types";
import styles from "./styles.module.css";

export function TypeText({ type, schemaPage = "" }: { type: TypeLabel; schemaPage?: string }) {
  return (
    <code>
      {type.map((part, index) =>
        typeof part === "string" ? (
          <span key={index}>{part}</span>
        ) : (
          <Link key={index} to={`${schemaPage}#schema-${part.ref}`}>
            {part.ref}
          </Link>
        ),
      )}
    </code>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className={styles.wrap}>{children}</div>;
}

export function Lines({ items }: { items: string[] }) {
  if (items.length === 0) return <span className={styles.muted}>none</span>;
  return (
    <ul className={styles.lines}>
      {items.map((item, index) => (
        <li key={index}>
          <code>{item}</code>
        </li>
      ))}
    </ul>
  );
}

export function Contents({ items }: { items: { id: string; label: string }[] }) {
  return (
    <ul className={styles.contents}>
      {items.map((item) => (
        <li key={item.id}>
          <a href={`#${item.id}`}>{item.label}</a>
        </li>
      ))}
    </ul>
  );
}
