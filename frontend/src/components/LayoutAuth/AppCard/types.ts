import type { ReactNode } from "react";
import type { SelectedBackends } from "~/components/Apps/backendSelection";
import type { UnifiedTemplate } from "~/hooks/useAllTemplates";

export type AppTemplate = UnifiedTemplate;

export type SortOption = {
  label: string;
  value: "newest" | "oldest" | "a-z" | "z-a";
};

export type FilterOption = {
  label: string;
  value: "all" | "shared" | "user";
};

export type AppsOptions = {
  filterBy: FilterOption["value"];
  sortBy: SortOption["value"];
  selectedBackends: SelectedBackends;
};

type DeleteConfirm = {
  template: UnifiedTemplate;
  type: "app" | "backend";
};

export type AppsPageState = {
  search: string;
  filterOptions: FilterOption[];
  showToast: boolean;
  deleteConfirm: DeleteConfirm | null;
  backendDropdownOpen: boolean;
  backendSearch: string;
};

export interface AppCardProps {
  template: AppTemplate;
  setDeleteConfirm?: (deleteConfirm: DeleteConfirm) => void;
  bottomLeft?: ReactNode;
  bottomRight?: ReactNode;
  className?: string;
  hideActions?: boolean;
}

export interface AppCardDropdownItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  color?: string;
}
