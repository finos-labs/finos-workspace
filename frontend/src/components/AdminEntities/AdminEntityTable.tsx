import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "~/components/ds/atoms/Button";
import { Input } from "~/components/ds/atoms/Input";
import type { DataTableColumn, SortState } from "~/components/ds/molecules/DataTable";
import { DataTable } from "~/components/ds/molecules/DataTable";
import Icon from "~/components/Icon";
import Tooltip from "~/components/Tooltip";
import { RenderNoData } from "~/routes/admin";

interface AdminEntityTableProps<T> {
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  sortValues: Record<string, (row: T) => string | number>;
  searchText: (row: T) => string;
  searchPlaceholder: string;
  addLabel?: string;
  onAdd?: () => void;
  onEdit: (row: T) => void;
  editLabel: string;
  isLoading: boolean;
  isError: boolean;
  emptyMessage: ReactNode;
}

export function AdminEntityTable<T>({
  rows,
  columns,
  getRowId,
  sortValues,
  searchText,
  searchPlaceholder,
  addLabel,
  onAdd,
  onEdit,
  editLabel,
  isLoading,
  isError,
  emptyMessage,
}: AdminEntityTableProps<T>) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortState, setSortState] = useState<SortState | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timeout);
  }, [search]);

  const visible = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    const matching = query
      ? rows.filter((row) => searchText(row).toLowerCase().includes(query))
      : rows;
    const sortValue = sortState ? sortValues[sortState.id] : undefined;
    if (!(sortState && sortValue)) return matching;
    const sign = sortState.dir === "asc" ? 1 : -1;
    return [...matching].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      if (typeof av === "number" && typeof bv === "number") return sign * (av - bv);
      return sign * String(av).localeCompare(String(bv));
    });
  }, [rows, debouncedSearch, sortState, sortValues, searchText]);

  const renderRowActions = useCallback(
    (row: T) => (
      <Tooltip message={editLabel}>
        <button
          type="button"
          aria-label={editLabel}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-300 ws-small-navbar-btn rounded flex items-center justify-center"
          onClick={() => onEdit(row)}
        >
          <Icon id="pencil-04" className="size-3.5" />
        </button>
      </Tooltip>
    ),
    [editLabel, onEdit],
  );

  return (
    <div className="p-6 text-sm flex flex-col">
      <div className="flex items-center gap-[10px]">
        <Input
          size="xs"
          className="min-w-[270px] h-8 [&_input]:h-8"
          placeholder={searchPlaceholder}
          prefix={<Icon id="search" />}
          onChange={(value: string) => setSearch(value)}
        />
        <div className="flex-1" />
        {onAdd && (
          <Button variant="primary" size="sm" onClick={onAdd}>
            {addLabel}
          </Button>
        )}
      </div>
      <div className="relative mt-6 min-h-[200px]">
        <DataTable
          columns={columns}
          data={visible}
          getRowId={getRowId}
          sortState={sortState}
          onSortChange={setSortState}
          renderRowActions={renderRowActions}
          actionsWidth={64}
        />
        {visible.length === 0 && (
          <div className="absolute bottom-0 left-0 right-0 top-0">
            <RenderNoData isError={isError} isLoading={isLoading}>
              {emptyMessage}
            </RenderNoData>
          </div>
        )}
      </div>
    </div>
  );
}
