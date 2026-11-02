import { useDocById, useDocsSidebar } from "@docusaurus/plugin-content-docs/client";
import Link from "@docusaurus/Link";
import type { PropSidebarItem } from "@docusaurus/plugin-content-docs";
import { firstSentence } from "../Reference/kit";

function Description({ docId }: { docId: string | undefined }) {
  const doc = useDocById(docId);
  return doc?.description ? <> {firstSentence(doc.description)}</> : null;
}

function Pages({ items }: { items: PropSidebarItem[] }) {
  return (
    <ul>
      {items.map((item) => {
        if (item.type === "category") {
          return (
            <li key={item.label}>
              <strong>{item.label}</strong>
              <Pages items={item.items} />
            </li>
          );
        }
        if (item.type !== "link") return null;
        return (
          <li key={item.href}>
            <Link to={item.href}>{item.label}</Link>
            <Description docId={item.docId} />
          </li>
        );
      })}
    </ul>
  );
}

export default function ReferenceSections() {
  const sidebar = useDocsSidebar();
  if (sidebar === null) return null;
  const links = sidebar.items.filter((item) => item.type === "link" && item.href !== "/reference");
  const categories = sidebar.items.filter((item) => item.type === "category");
  return (
    <>
      <Pages items={links} />
      {categories.map((category) =>
        category.type === "category" ? (
          <section key={category.label}>
            <h2>{category.label}</h2>
            <Pages items={category.items} />
          </section>
        ) : null,
      )}
    </>
  );
}
