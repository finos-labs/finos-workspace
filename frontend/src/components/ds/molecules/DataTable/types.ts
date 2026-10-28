import type { ReactNode } from "react";

export type SortDir = "asc" | "desc";

export type SortState = { id: string; dir: SortDir };

export type ColumnAlign = "left" | "center" | "right";

export type ColumnWidth = number | `${number}%` | "auto" | "fill";

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  width: ColumnWidth;
  minWidth?: number;
  align?: ColumnAlign;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  truncate?: boolean;
  headerClassName?: string;
  cellClassName?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowId: (row: T) => string;

  virtualized?: boolean;
  estimateRowHeight?: number;
  maxHeight?: number | string;
  overscan?: number;

  selectedIds?: Set<string>;
  onToggleRow?: (id: string, checked: boolean) => void;
  onToggleAll?: (rows: T[], checked: boolean) => void;
  isRowSelectable?: (row: T) => boolean;

  sortState?: SortState | null;
  onSortChange?: (next: SortState) => void;

  renderRowActions?: (row: T) => ReactNode;
  actionsWidth?: number;

  highlightRowId?: string | null;
  onHighlightConsumed?: () => void;

  emptyState?: ReactNode;
  rowClassName?: (row: T) => string;
  rowGap?: number;
  className?: string;
  "data-testid"?: string;
}
