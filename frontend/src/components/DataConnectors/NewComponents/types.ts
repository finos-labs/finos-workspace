import type { IconId } from "~/components/Icon.types";
import type { BackendTemplate } from "~/lib/state/backendConnector";
import type { WidgetsType } from "~/utils/zodForms";

type EndpointHeader = {
  key?: string;
  value?: string;
  location?: "headers" | "query";
};

export type POSSIBLE_SOURCES =
  | "file"
  | "backend"
  | "others"
  | "websites"
  | "ai_artifacts"
  | "html";

type BaseItem = {
  uuid?: string;
  id?: string;
  name: string;
  description: string;
  selectionId: string;
  shared: boolean;
  status: "success" | "error";
  url?: string;
  type: POSSIBLE_SOURCES;
};

type FileItem = BaseItem & {
  id: string;
  widgets: {
    id: string;
    name: string;
    description: string;
    category: string;
    subCategory: string;
    storedFileUuid: string | null;
    url: string;
    extension: string;
    dataKey: string;
    originalFileName: string;
    source: string;
    uuid: string;
    widgetId: string;
    selectionId: string;
    shared: boolean;
    uploadedAt?: string | number;
  }[];
};

export type BackendItem = BaseItem & {
  url: string;
  endpointHeaders: EndpointHeader[];
  uuid: string;
  id: string;
  selectionId: string;
  templates?: BackendTemplate[];
  widgets?: (WidgetsType[string] & { selectionId: string; shared?: boolean })[];
};

export type ItemType<T extends POSSIBLE_SOURCES> = T extends "file"
  ? FileItem
  : T extends "backend"
    ? BackendItem
    : never;

export type WidgetCardItem = {
  uuid?: string;
  id?: string;
  widgetId?: string;
  name: string;
  category?: string;
  subCategory?: string;
  source?: string | string[] | null;
  selectionId: string;
  shared?: boolean;
  description?: string;
  url?: string;
  originalFileName?: string;
  createdDate?: string;
  widgetType?: string;
  type?: string | null;
};

export const SourceMeta = {
  backend: { name: "Backend Widgets", icon: "grid-01" },
  "advanced-backend": { name: "Backends", icon: "grid-01" },
  file: { name: "File Uploads", icon: "file-attachment-01" },
  websites: { name: "Iframes", icon: "globe-01" },
  website: { name: "Iframes", icon: "globe-01" },
  html: { name: "HTML", icon: "code-browser", showEdit: false },
  others: { name: "Core Widgets", icon: "plus-circle" },
  ai_artifacts: { name: "AI Artifacts", icon: "table-02", showEdit: false },
} as const satisfies Record<string, { name: string; icon: IconId; showEdit?: boolean }>;
