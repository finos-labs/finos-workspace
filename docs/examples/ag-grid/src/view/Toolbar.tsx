import { useId } from "react";
import { AGG_FUNCS, type AggFunc } from "../spec";

export const AGG_LABELS: Record<AggFunc, string> = {
  sum: "Sum",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
  count: "Count",
};

/** A column the user may choose, with its header. */
interface Choice {
  field: string;
  header: string;
}

interface ToolbarProps {
  /** The columns the user may group by, with their headers. */
  groupable: Choice[];
  groupBy: string[];
  onGroupByChange: (groupBy: string[]) => void;
  /** The columns the user may pivot by; none, and the toolbar offers no pivot. */
  pivotable: Choice[];
  pivotMode: boolean;
  onPivotModeChange: (pivotMode: boolean) => void;
  pivotBy: string[];
  onPivotByChange: (pivotBy: string[]) => void;
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

interface PickerProps {
  label: string;
  /** What the picker reads when nothing is chosen. */
  empty: string;
  choices: Choice[];
  chosen: string[];
  /** Fields chosen elsewhere, which this picker does not offer. */
  taken: string[];
  onChange: (chosen: string[]) => void;
}

/** An ordered choice of columns: chips that move and go, and a menu that adds. */
function Picker({ label, empty, choices, chosen, taken, onChange }: PickerProps) {
  const addId = useId();
  const headers = new Map(choices.map((column) => [column.field, column.header]));
  const available = choices.filter((column) => !chosen.includes(column.field) && !taken.includes(column.field));

  const move = (index: number, offset: -1 | 1) => {
    const next = [...chosen];
    const target = index + offset;
    const [item] = next.splice(index, 1);
    if (item === undefined || target < 0 || target > next.length) return;
    next.splice(target, 0, item);
    onChange(next);
  };

  return (
    <div className="agw-toolbar__group" aria-label={label}>
      <span className="agw-toolbar__label">{label}</span>
      {!chosen.length && <span className="agw-muted">{empty}</span>}
      {chosen.map((field, index) => {
        const header = headers.get(field) ?? field;
        return (
          <span key={field} className="agw-chip">
            {header}
            <button type="button" aria-label={`Move ${header} up`} disabled={index === 0} onClick={() => move(index, -1)}>
              ←
            </button>
            <button
              type="button"
              aria-label={`Move ${header} down`}
              disabled={index === chosen.length - 1}
              onClick={() => move(index, 1)}
            >
              →
            </button>
            <button
              type="button"
              aria-label={`Remove ${header} from ${label}`}
              onClick={() => onChange(chosen.filter((item) => item !== field))}
            >
              ×
            </button>
          </span>
        );
      })}
      {available.length > 0 && (
        <>
          <label className="agw-visually-hidden" htmlFor={addId}>
            Add a column to {label}
          </label>
          <select
            id={addId}
            className="agw-select"
            value=""
            onChange={(event) => onChange([...chosen, event.target.value])}
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
  );
}

export function Toolbar(props: ToolbarProps) {
  const { groupBy, pivotMode, pivotBy } = props;
  const ids = { aggregation: useId(), search: useId() };
  const grouped = groupBy.length > 0;

  return (
    <div className="agw-toolbar">
      {props.pivotable.length > 0 && (
        <label className="agw-toolbar__group agw-switch">
          <input
            type="checkbox"
            checked={pivotMode}
            onChange={(event) => props.onPivotModeChange(event.target.checked)}
          />
          <span className="agw-toolbar__label">Pivot</span>
        </label>
      )}

      {props.groupable.length > 0 && (
        <Picker
          label={pivotMode ? "Rows" : "Group by"}
          empty={pivotMode ? "Totals only" : "No grouping"}
          choices={props.groupable}
          chosen={groupBy}
          taken={pivotMode ? pivotBy : []}
          onChange={props.onGroupByChange}
        />
      )}

      {pivotMode && (
        <Picker
          label="Columns"
          empty="Totals only"
          choices={props.pivotable}
          chosen={pivotBy}
          taken={groupBy}
          onChange={props.onPivotByChange}
        />
      )}

      {(grouped || pivotMode) && props.hasMeasures && (
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
        {grouped && !pivotMode && (
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
