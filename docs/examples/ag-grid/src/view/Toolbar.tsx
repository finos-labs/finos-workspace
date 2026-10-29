import { useId } from "react";
import { AGG_FUNCS, type AggFunc } from "../spec";

const AGG_LABELS: Record<AggFunc, string> = {
  sum: "Sum",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
  count: "Count",
};

interface ToolbarProps {
  /** The columns the user may group by, with their headers. */
  groupable: { field: string; header: string }[];
  groupBy: string[];
  onGroupByChange: (groupBy: string[]) => void;
  /** Whether the grouping has columns to aggregate. */
  hasMeasures: boolean;
  /** Whether the columns declare their own `aggFunc`s, which "As declared" keeps. */
  declared: boolean;
  aggFunc: AggFunc | null;
  onAggFuncChange: (aggFunc: AggFunc | null) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

const DECLARED = "declared";

export function Toolbar(props: ToolbarProps) {
  const { groupable, groupBy } = props;
  const ids = { add: useId(), aggregation: useId(), search: useId() };
  const headers = new Map(groupable.map((column) => [column.field, column.header]));
  const available = groupable.filter((column) => !groupBy.includes(column.field));
  const grouped = groupBy.length > 0;

  const move = (index: number, offset: -1 | 1) => {
    const next = [...groupBy];
    const target = index + offset;
    const [item] = next.splice(index, 1);
    if (item === undefined || target < 0 || target > next.length) return;
    next.splice(target, 0, item);
    props.onGroupByChange(next);
  };

  return (
    <div className="agw-toolbar">
      {groupable.length > 0 && (
        <div className="agw-toolbar__group" aria-label="Group by">
          <span className="agw-toolbar__label">Group by</span>
          {!grouped && <span className="agw-muted">No grouping</span>}
          {groupBy.map((field, index) => {
            const header = headers.get(field) ?? field;
            return (
              <span key={field} className="agw-chip">
                {header}
                <button
                  type="button"
                  aria-label={`Move ${header} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label={`Move ${header} down`}
                  disabled={index === groupBy.length - 1}
                  onClick={() => move(index, 1)}
                >
                  →
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${header} grouping`}
                  onClick={() => props.onGroupByChange(groupBy.filter((item) => item !== field))}
                >
                  ×
                </button>
              </span>
            );
          })}
          {available.length > 0 && (
            <>
              <label className="agw-visually-hidden" htmlFor={ids.add}>
                Add a grouping column
              </label>
              <select
                id={ids.add}
                className="agw-select"
                value=""
                onChange={(event) => props.onGroupByChange([...groupBy, event.target.value])}
              >
                <option value="" disabled>
                  + Add column
                </option>
                {available.map((column) => (
                  <option key={column.field} value={column.field}>
                    {column.header}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {grouped && props.hasMeasures && (
        <div className="agw-toolbar__group">
          <label className="agw-toolbar__label" htmlFor={ids.aggregation}>
            Aggregate
          </label>
          <select
            id={ids.aggregation}
            className="agw-select"
            value={props.aggFunc ?? DECLARED}
            onChange={(event) =>
              props.onAggFuncChange(event.target.value === DECLARED ? null : (event.target.value as AggFunc))
            }
          >
            {props.declared && <option value={DECLARED}>As declared</option>}
            {AGG_FUNCS.map((fn) => (
              <option key={fn} value={fn}>
                {AGG_LABELS[fn]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="agw-toolbar__group agw-toolbar__group--end">
        <label className="agw-visually-hidden" htmlFor={ids.search}>
          Search the rows
        </label>
        <input
          id={ids.search}
          type="search"
          className="agw-input"
          placeholder="Search"
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
        />
        {grouped && (
          <>
            <button type="button" className="agw-button" onClick={props.onExpandAll}>
              Expand all
            </button>
            <button type="button" className="agw-button" onClick={props.onCollapseAll}>
              Collapse all
            </button>
          </>
        )}
      </div>
    </div>
  );
}
