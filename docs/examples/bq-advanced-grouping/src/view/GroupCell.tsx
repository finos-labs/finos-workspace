import type { CustomCellRendererProps } from "ag-grid-react";
import type { DisplayRow } from "../grouping";
import { FIELD_LABELS } from "../types";

export interface GroupCellContext {
  toggle: (key: string) => void;
  isExpanded: (key: string) => boolean;
}

/** First column: indented group label with expand/collapse, or the company name for leaf rows. */
export function GroupCell(
  props: CustomCellRendererProps<DisplayRow, unknown, GroupCellContext>,
) {
  const row = props.data;
  if (!row) return null;
  const indent = { paddingLeft: `${row.level * 18}px` };

  if (row.kind === "leaf") {
    return (
      <span className="bqag-cell" style={indent}>
        <span className="bqag-cell__spacer" aria-hidden="true" />
        {row.row.company}
      </span>
    );
  }

  const expanded = props.context.isExpanded(row.key);
  return (
    <span className="bqag-cell" style={indent}>
      <button
        type="button"
        className="bqag-cell__toggle"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${FIELD_LABELS[row.field]} ${row.value}`}
        onClick={() => props.context.toggle(row.key)}
      >
        {expanded ? "▾" : "▸"}
      </button>
      <span className="bqag-cell__label">
        <span className="bqag-cell__field">{FIELD_LABELS[row.field]}:</span> {row.value}
      </span>
      <span className="bqag-cell__count">({row.count})</span>
    </span>
  );
}
