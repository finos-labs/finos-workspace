import type { HtmlArtifact } from "./types";

/**
 * The Workspace has no table artifact: it renders `text`, `html` and `app`
 * artifacts. A table is therefore an `html` artifact, styled the way Ines's
 * own `html-table` skill (src/skills/html-table.md) asks for: its exact
 * light/dark colors, no borders, the theme background on the outermost element
 * with small padding, and no title repeated inside the HTML (the artifact's
 * name is shown by the Workspace). The artifact renders in a sandboxed iframe
 * with no script, so the theme is chosen with `prefers-color-scheme`.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const STYLE = `
html,body{margin:0;padding:0;background:#FFFFFF;color:#191D1F;font:13px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{width:100%;min-height:100%;box-sizing:border-box;padding:8px 12px}
table{width:100%;border-collapse:collapse;border:0}
th,td{padding:6px 10px;text-align:left;border:0;white-space:nowrap}
th{background:#EBEBED;font-weight:600}
tbody tr:nth-child(odd){background:#FFFFFF}
tbody tr:nth-child(even){background:#F6F6F6}
.num{text-align:right;font-variant-numeric:tabular-nums}
@media (prefers-color-scheme: dark){
html,body{background:#0b2432;color:#FFFFFF}
th{background:#36363E}
tbody tr:nth-child(odd){background:#1F1E23}
tbody tr:nth-child(even){background:#2A2A31}
}
`.trim();

/** One HTML document holding `rows` as a table; columns are the first row's keys plus any later ones. */
export function renderHtmlTable(rows: Record<string, unknown>[]): string {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  }
  // A column is numeric when it has at least one number and nothing but numbers or blanks.
  const numeric = new Set(
    columns.filter(
      (c) =>
        rows.some((r) => typeof r[c] === "number") &&
        rows.every((r) => r[c] === null || r[c] === undefined || typeof r[c] === "number"),
    ),
  );
  const head = columns
    .map((c) => `<th${numeric.has(c) ? ' class="num"' : ""}>${escapeHtml(c)}</th>`)
    .join("");
  const body = rows
    .map(
      (r) =>
        "<tr>" +
        columns
          .map((c) => `<td${numeric.has(c) ? ' class="num"' : ""}>${escapeHtml(cellText(r[c]))}</td>`)
          .join("") +
        "</tr>",
    )
    .join("");
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head>` +
    `<body><div class="wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></body></html>`
  );
}

export function htmlTableArtifact(
  name: string,
  description: string,
  rows: Record<string, unknown>[],
): HtmlArtifact {
  return {
    type: "html",
    uuid: crypto.randomUUID(),
    name,
    description,
    content: renderHtmlTable(rows),
  };
}
