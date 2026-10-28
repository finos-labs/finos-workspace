import { useId } from "react";
import {
  AGGREGATIONS,
  type Aggregation,
  type AdvancedGroupingConfig,
  FIELD_LABELS,
  GROUP_FIELDS,
  type GroupField,
} from "../types";

const AGGREGATION_LABELS: Record<Aggregation, string> = {
  sum: "Sum",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
};

interface GroupingToolbarProps {
  features: AdvancedGroupingConfig["features"];
  groupBy: GroupField[];
  onGroupByChange: (groupBy: GroupField[]) => void;
  aggregation: Aggregation;
  onAggregationChange: (aggregation: Aggregation) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onExport: () => void;
  exportDisabled: boolean;
}

export function GroupingToolbar(props: GroupingToolbarProps) {
  const { features, groupBy } = props;
  const ids = { add: useId(), aggregation: useId(), search: useId() };
  const available = GROUP_FIELDS.filter((field) => !groupBy.includes(field));

  const move = (index: number, offset: -1 | 1) => {
    const next = [...groupBy];
    const target = index + offset;
    const [item] = next.splice(index, 1);
    if (item === undefined || target < 0 || target > next.length) return;
    next.splice(target, 0, item);
    props.onGroupByChange(next);
  };

  return (
    <div className="bqag-toolbar">
      {features.grouping && (
        <div className="bqag-toolbar__group" aria-label="Group by">
          <span className="bqag-toolbar__label">Group by</span>
          {groupBy.length === 0 && <span className="bqag-muted">No grouping</span>}
          {groupBy.map((field, index) => (
            <span key={field} className="bqag-chip">
              {FIELD_LABELS[field]}
              <button
                type="button"
                aria-label={`Move ${FIELD_LABELS[field]} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ←
              </button>
              <button
                type="button"
                aria-label={`Move ${FIELD_LABELS[field]} down`}
                disabled={index === groupBy.length - 1}
                onClick={() => move(index, 1)}
              >
                →
              </button>
              <button
                type="button"
                aria-label={`Remove ${FIELD_LABELS[field]} grouping`}
                onClick={() =>
                  props.onGroupByChange(groupBy.filter((item) => item !== field))
                }
              >
                ×
              </button>
            </span>
          ))}
          {available.length > 0 && (
            <>
              <label className="bqag-visually-hidden" htmlFor={ids.add}>
                Add a grouping column
              </label>
              <select
                id={ids.add}
                className="bqag-select"
                value=""
                onChange={(event) =>
                  props.onGroupByChange([...groupBy, event.target.value as GroupField])
                }
              >
                <option value="" disabled>
                  + Add column
                </option>
                {available.map((field) => (
                  <option key={field} value={field}>
                    {FIELD_LABELS[field]}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {features.aggregation && (
        <div className="bqag-toolbar__group">
          <label className="bqag-toolbar__label" htmlFor={ids.aggregation}>
            Aggregate
          </label>
          <select
            id={ids.aggregation}
            className="bqag-select"
            value={props.aggregation}
            onChange={(event) =>
              props.onAggregationChange(event.target.value as Aggregation)
            }
          >
            {AGGREGATIONS.map((fn) => (
              <option key={fn} value={fn}>
                {AGGREGATION_LABELS[fn]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="bqag-toolbar__group bqag-toolbar__group--end">
        {features.search && (
          <>
            <label className="bqag-visually-hidden" htmlFor={ids.search}>
              Search companies
            </label>
            <input
              id={ids.search}
              type="search"
              className="bqag-input"
              placeholder="Search companies"
              value={props.search}
              onChange={(event) => props.onSearchChange(event.target.value)}
            />
          </>
        )}
        {features.grouping && groupBy.length > 0 && (
          <>
            <button type="button" className="bqag-button" onClick={props.onExpandAll}>
              Expand all
            </button>
            <button type="button" className="bqag-button" onClick={props.onCollapseAll}>
              Collapse all
            </button>
          </>
        )}
        {features.export && (
          <button
            type="button"
            className="bqag-button"
            onClick={props.onExport}
            disabled={props.exportDisabled}
          >
            Export CSV
          </button>
        )}
      </div>
    </div>
  );
}
