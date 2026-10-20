import type { MoveToTabs } from "~/lib/state/app";
import type { DraggableState } from "../DraggableCard";
import type { ExtraActionT } from "../DraggableCard/NavBar";
import type { Widget } from "../types";

/** A dashboard a widget can be copied to; a folder's children are not needed for that. */
export type MoveTarget = Omit<MoveToTabs, "children">;

export type InnerTabsMenuProps = {
  uniqueKey: string;
  tab: MoveTarget;
  gridLayout: MoveTarget["data"]["gridLayout"];
};

export type MoveToOnSelectProps = {
  widget: Widget;
  tab: MoveTarget;
  activeDashboardId: string;
  navigate: (path: string) => void;
};

type ExportFn = ((title: string) => void) | null;

export type ExportFns = Partial<
  Record<"csvFunction" | "pngFunction" | "pdfFunction" | "txtFunction", ExportFn>
>;

export type EllipsisSettings = {
  showSettings?: boolean;
  showParameters?: boolean;
  showShare?: boolean;
  showDuplicate?: boolean;
  showExport?: boolean;
  showMaximize?: boolean;
  showMove?: boolean;
  showMetadata?: boolean;
  showMinimize?: boolean;
};

export type EllipsisDropdownMenuProps = {
  dispatch: (value: Partial<DraggableState>) => void;
  settings?: EllipsisSettings;
  exportFns?: ExportFns;
  extraSettings?: ExtraActionT[];
  isMinimized?: boolean;
  onMinimizeToggle?: () => void;
};
