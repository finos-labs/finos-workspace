import Heading from "@theme/Heading";
import { Fragment, type ReactNode } from "react";
import { Prose } from "./prose";
import styles from "./styles.module.css";

export function MethodBadge({ method }: { method: string }) {
  const variant = styles[method.toLowerCase()] ?? "";
  return <span className={`${styles.method} ${variant}`}>{method}</span>;
}

export function StatusBadge({ code }: { code: string }) {
  const variant = styles[`status${code.charAt(0)}`] ?? "";
  return <span className={`${styles.status} ${variant}`}>{code}</span>;
}

export function Chip({ children, tone }: { children: ReactNode; tone?: "required" | "warning" }) {
  return <span className={`${styles.chip} ${tone ? styles[tone] : ""}`}>{children}</span>;
}

export function Entry({
  id,
  level = 3,
  title,
  badge,
  lead,
  description,
  chips,
  children,
}: {
  id: string;
  level?: 2 | 3 | 4;
  title: ReactNode;
  badge?: ReactNode;
  lead?: string;
  description?: string;
  chips?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className={styles.entry}>
      <header className={styles.entryHeader}>
        <Heading as={`h${level}`} id={id} className={styles.entryTitle}>
          {badge}
          {title}
        </Heading>
      </header>
      <div className={styles.entryBody}>
        {lead ? <p className={styles.lead}>{lead}</p> : null}
        {description ? <Prose text={description} /> : null}
        {chips ? <div className={styles.chips}>{chips}</div> : null}
        {children}
      </div>
    </section>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <h4 className={styles.sectionTitle}>{title}</h4>
      {children}
    </div>
  );
}

export function Names({ items }: { items: string[] }) {
  return (
    <ul className={styles.names}>
      {items.map((item) => (
        <li key={item}>
          <code>{item}</code>
        </li>
      ))}
    </ul>
  );
}

export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = flat.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? flat : flat.slice(0, end + 1);
  return sentence.length > 180 ? `${sentence.slice(0, 177)}...` : sentence;
}

export function Index({ items }: { items: { id: string; label: ReactNode; badge?: ReactNode; summary?: string }[] }) {
  return (
    <ul className={styles.index}>
      {items.map((item) => (
        <li key={item.id}>
          {item.badge}
          <a href={`#${item.id}`}>{item.label}</a>
          {item.summary ? <span className={styles.indexSummary}>{item.summary}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export interface Item {
  key: string;
  id?: string;
  title: ReactNode;
  chips?: ReactNode;
  description?: string;
  meta?: [string, ReactNode][];
  body?: ReactNode;
}

export function ItemList({ items }: { items: Item[] }) {
  return (
    <ul className={styles.settings}>
      {items.map((item) => (
        <li key={item.key} id={item.id} className={styles.setting}>
          <div className={styles.fieldHead}>
            {item.title}
            {item.chips}
          </div>
          {item.description ? <Prose text={item.description} /> : null}
          {item.meta && item.meta.length > 0 ? (
            <dl className={styles.meta}>
              {item.meta.map(([label, value]) => (
                <Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </Fragment>
              ))}
            </dl>
          ) : null}
          {item.body}
        </li>
      ))}
    </ul>
  );
}
