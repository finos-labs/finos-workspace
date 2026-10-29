import type { CustomCellRendererProps } from "ag-grid-react";
import type { DisplayRow } from "../grouping";

export interface GroupCellContext {
  toggle: (key: string) => void;
  isExpanded: (key: string) => boolean;
  /** The header of a grouped column, for the group rows' labels. */
  headerOf: (field: string) => string;
  /** The column whose value labels the rows inside the groups, if any. */
  labelField: string | null;
}

/** First column: indented group label with expand/collapse, or the row's label inside a group. */
export function GroupCell(props: CustomCellRendererProps<DisplayRow, unknown, GroupCellContext>) {
  const row = props.data;
  if (!row) return null;
  const { context } = props;
  const indent = { paddingLeft: `${row.level * 18}px` };

  if (row.kind === "leaf") {
    const label = context.labelField ? row.row[context.labelField] : null;
    return (
      <span className="agw-cell" style={indent}>
        <span className="agw-cell__spacer" aria-hidden="true" />
        {label === null || label === undefined ? "" : String(label)}
      </span>
    );
  }

  const expanded = context.isExpanded(row.key);
  const header = context.headerOf(row.field);
  return (
    <span className="agw-cell" style={indent}>
      <button
        type="button"
        className="agw-cell__toggle"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${header} ${row.value}`}
        onClick={() => context.toggle(row.key)}
      >
        {expanded ? "▾" : "▸"}
      </button>
      <span className="agw-cell__label">
        <span className="agw-cell__field">{header}:</span> {row.value}
      </span>
      <span className="agw-cell__count">({row.count})</span>
    </span>
  );
}
