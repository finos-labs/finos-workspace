import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type {
  BackendItem,
  ItemType,
  POSSIBLE_SOURCES,
  WidgetCardItem,
} from "~/components/DataConnectors/NewComponents/types";
import type { WidgetT } from "~/components/types";
import {
  type UserResourcePermissionsT,
  useUserResourcePermissions,
} from "~/hooks/useUserResourcePermissions";
import {
  type Source,
  type StoredFile,
  useShallowBackendConnectorStore,
  type WidgetMetadataItem,
} from "~/lib/state/backendConnector";
import WIDGETS from "~/lib/widgets.json";
import type { WidgetType } from "~/utils/zodForms";
import { getFileWidgetType } from "../constants";
import { useAppStore } from "../state/app";
import { isWidgetVizType } from "../types/app";
import { convertAdvancedBackend, generateRandomName, uuidv4 } from "../utils";

/** What the user picked in My Data Connectors: a widget of a backend, a stored file or a feed, or a whole backend. */
export type SelectedWidget = WidgetCardItem &
  Partial<Omit<WidgetType, keyof WidgetCardItem>> & {
    parentName?: string;
    extension?: string;
    dataKey?: string | null;
    storage?: WidgetT["storage"];
    backendId?: string;
  };

export const createDashboardWidget = (
  widget: SelectedWidget,
  widgetType: string,
): WidgetT | null => {
  switch (widgetType) {
    case "file":
      if (!(widget.url && widget.extension)) return null;
      return {
        id: uuidv4(),
        endpoint: { url: widget.url, method: "GET" },
        type: getFileWidgetType(widget.extension),
        external: true,
        category: widget.category ?? "Others",
        subCategory: widget.subCategory,
        widgetId: `file-${widget.id}` as const,
        dataKey: widget.dataKey ?? undefined,
        description: widget.description,
        name: widget.name,
        gridData: { w: 20, h: widget.extension === "pdf" ? 20 : 10 },
        data: { dataKey: widget.dataKey ?? undefined },
        source: widget.source ?? undefined,
        connectionType: "file" as const,
      };
    case "website":
      return {
        id: uuidv4(),
        widgetId: `iframe-${widget.id}`,
        name: widget.name,
        description: widget.description,
        category: widget.category ?? "Others",
        subCategory: widget.subCategory,
        source: widget.source ?? undefined,
        external: true,
        storage: widget.storage,
        connectionType: "widgetMetadata" as const,
        type: "iframe",
        data: {},
      };
    case "html":
      return {
        id: uuidv4(),
        widgetId: `html-${widget.id}`,
        name: widget.name,
        description: widget.description,
        category: widget.category ?? "Others",
        subCategory: widget.subCategory,
        connectionType: "widgetMetadata" as const,
        source: widget.source ?? undefined,
        storage: widget.storage,
        data: {},
        type: "html",
      };
    case "backend": {
      const { type, ...backendWidget } = widget;
      if (!isWidgetVizType(type)) return null;
      // The widget is a definition the backend returned, which has nulls where a widget has nothing
      return {
        ...backendWidget,
        type,
        widgetType: "backend",
        id: uuidv4(),
        external: true,
        sourceId: widget.backendId,
      } as WidgetT;
    }
    default:
      return null;
  }
};

export const findSelectedWidgets = (
  allElems: ElementType[],
  selectedWidgets: Set<string>,
) => {
  const foundWidgets: SelectedWidget[] = [];

  allElems.forEach((elem) => {
    elem.items.forEach((item: WidgetCardItem & { widgets?: WidgetCardItem[] }) => {
      if (elem.type === "backend" && item.widgets?.length === 0) {
        // means backend couldnt connect to see the widgets so we want to select only backend not the widgets inside
        foundWidgets.push({
          ...item,
          type: elem.type,
        });
      } else if ("widgets" in item && item.widgets) {
        item.widgets.forEach((widget) => {
          if (selectedWidgets.has(widget.selectionId)) {
            foundWidgets.push({
              ...widget,
              widgetType: elem.type,
              parentName: item.name,
            });
          }
        });
      } else if (item.selectionId && selectedWidgets.has(item.selectionId)) {
        foundWidgets.push({
          ...item,
          widgetType: elem.type,
        });
      }
    });
  });

  return foundWidgets;
};

/** The widgets that are selected and that a user can delete: not shared, and not the backends, which the Apps page manages. */
export const findDeletableWidgets = (
  allElems: ElementType[],
  selectedWidgets: Set<string>,
) =>
  findSelectedWidgets(allElems, selectedWidgets).filter(
    (elem) => !(elem.shared || elem.selectionId.startsWith("backend,")),
  );

export const FILE_TYPES = {
  pdf: ["pdf"],
  text: ["txt", "md", "docx", "html"],
};

export type StoredFileWidget = {
  selectionId: string;
  id: string;
  name: string;
  description?: string;
  widgets?: (StoredFile & { widgetId: string })[];
};

export type ElementType<T extends POSSIBLE_SOURCES = POSSIBLE_SOURCES> = {
  type: T;
  items: ItemType<T>[];
  hideWhenEmpty?: boolean;
};

type SelectedWidgetsContextType = {
  selectedWidgets: Set<string>;
  toggleWidget: (id: string) => void;
  toggleGroup: (ids: string[]) => void;
  toggleAll: (ids: string[]) => void;
  isSelected: (id: string) => boolean;
  isGroupSelected: (ids: string[]) => "indeterminate" | boolean;
  allElems: ElementType[];
  handleAddToDashboard: (dashboards: string[] | "new", id?: string) => void;
  isLoading: boolean;
};

function formatType(type: string): string {
  return type.toUpperCase();
}

const formattedFileTypes = Object.keys(FILE_TYPES).map((key) => formatType(key));

export function isFileRoot(type: string) {
  return formattedFileTypes.includes(type);
}

function formatFile(files: StoredFile[]): StoredFileWidget[] {
  const results: StoredFileWidget[] = [];
  for (const key of Object.keys(FILE_TYPES) as (keyof typeof FILE_TYPES)[]) {
    const filtered: StoredFile[] = files.filter((file) =>
      FILE_TYPES[key].includes(file.extension),
    );
    const widgets = filtered.map((item) => ({
      ...item,
      widgetId: item.id ?? item.uuid,
      selectionId: `file,${key},${item.id ?? item.uuid}`,
    }));
    const description = `${formatType(key)} file uploads.`;
    if (filtered.length > 0) {
      results.push({
        id: key,
        name: `${formatType(key)}`,
        description,
        widgets,
        selectionId: `file,${key}`,
      });
    }
  }
  return results;
}

function formatBackendWidgets(source: Source): BackendItem["widgets"] {
  if (source.id === "root") {
    return Object.values(WIDGETS) as unknown as BackendItem["widgets"];
  }

  return convertAdvancedBackend(source).map((widget) => {
    return {
      ...widget,
      backendId: source.id,
      selectionId: `backend,${source.id},${widget.widgetId}`,
    };
  }) as unknown as BackendItem["widgets"];
}

const MyDataConnectorsContext = createContext<SelectedWidgetsContextType | null>(null);

export function createAllElements(params: {
  storedFiles: StoredFile[];
  apiSources: Source[];
  widgetMetadata?: WidgetMetadataItem[];
  rolePermissionsData?: UserResourcePermissionsT;
  withOthers?: boolean;
}): ElementType[] {
  const {
    storedFiles,
    apiSources,
    widgetMetadata,
    rolePermissionsData,
    withOthers = true,
  } = params;

  const fileIds = storedFiles?.reduce(
    (acc, file) => {
      acc[file.uuid] = true;
      return acc;
    },
    {} as Record<string, boolean>,
  );

  const ownedBackends = apiSources.filter((item) => item.status === "success");

  const ownedBackendIds = ownedBackends.reduce(
    (acc, backend) => {
      if (backend.uuid) acc[backend.uuid] = true;
      return acc;
    },
    {} as Record<string, boolean>,
  );

  const sharedFileIds = rolePermissionsData?.files?.reduce(
    (acc, file) => {
      acc[file.uuid] = true;
      return acc;
    },
    {} as Record<string, boolean>,
  );

  const sharedBackendIds = rolePermissionsData?.backends?.reduce(
    (acc, backend) => {
      if (backend.uuid) acc[backend.uuid] = true;
      return acc;
    },
    {} as Record<string, boolean>,
  );

  const sharedBackends = (rolePermissionsData?.backends ?? [])
    .filter((item) => !ownedBackendIds?.[item.uuid] && item.status === "success")
    .map((item) => ({
      ...item,
      isSharedSource: true,
      widgets: Object.values(item.widgets ?? {}).map((widget) => ({
        ...widget,
        backendId: item.id,
        selectionId: `backend,${item.id},${widget.widgetId}`,
        isSharedWidget: true,
        shared: true,
      })),
      selectionId: `backend,${item.uuid}`,
      shared: true,
    }));

  return [
    {
      type: "backend",
      items: [
        ...apiSources
          .filter((item) => item.status === "success")
          .map((item) => ({
            ...item,
            widgets: formatBackendWidgets(item),
            selectionId: `backend,${item.uuid ?? item.id}`,
            shared: (item.uuid && sharedBackendIds?.[item.uuid]) || false,
          })),
        ...sharedBackends,
      ],
    },
    {
      type: "file",
      items: formatFile([
        ...(storedFiles?.map((file) => ({
          ...(file as unknown as StoredFile),
          shared: sharedFileIds?.[file.uuid] ?? false,
        })) ?? []),
        ...(rolePermissionsData?.files
          ?.filter((file) => !fileIds?.[file.uuid])
          ?.map((file) => ({
            ...(file as unknown as StoredFile),
            isSharedWidget: true,
            shared: true,
          })) ?? []),
      ]),
    },
    {
      type: "others",
      items: withOthers
        ? [
            {
              type: "website",
              name: "Iframes",
              widgets: widgetMetadata
                ?.filter((item) => item.widgetType === "iframe")
                ?.map((item) => ({
                  ...item,
                  id: item.widgetId,
                  selectionId: `website,${item.widgetId}`,
                })),
            },
          ].filter(Boolean)
        : [],
    },
    {
      type: "ai_artifacts",
      items: [
        {
          type: "html",
          name: "HTML",
          widgets: widgetMetadata
            ?.filter((item) => item.widgetType === "html")
            ?.map((item) => ({
              ...item,
              id: item.widgetId,
              selectionId: `html,${item.widgetId}`,
            })),
          hideWhenEmpty: true,
        },
      ],
    },
  ].filter(Boolean) as ElementType[];
}

export function getTypeToUse(type: string, selectionId: string, parentType?: string) {
  const splitType = ["others", "ai_artifacts"].some((t) => type === t);

  return splitType ? selectionId.split(",")[0] : (parentType ?? type);
}

export function MyDataConnectorsProvider({ children }: { children: ReactNode }) {
  const {
    data: rolePermissionsData,
    isLoading: isLoadingPermissions,
    error,
  } = useUserResourcePermissions();

  const { storedFiles, apiSources, widgetMetadata, isLoadingBackends } =
    useShallowBackendConnectorStore((s) => ({
      storedFiles: s.storedFiles,
      apiSources: s.apiSources,
      widgetMetadata: s.widgetMetadata,
      isLoadingBackends: s.isLoadingBackends,
    }));
  const isLoading = isLoadingPermissions || isLoadingBackends;
  const [selectedWidgets, setSelectedWidgets] = useState<Set<string>>(new Set());

  const navigate = useNavigate();

  const allElems = useMemo(
    () =>
      createAllElements({
        storedFiles,
        apiSources,
        widgetMetadata,
        rolePermissionsData,
      }),
    [storedFiles, apiSources, widgetMetadata, rolePermissionsData],
  );

  const handleAddToDashboard = useCallback(
    (dashboards: string[] | "new", individualWidgetId?: string) => {
      const foundWidgets = findSelectedWidgets(
        allElems,
        individualWidgetId ? new Set([individualWidgetId]) : selectedWidgets,
      );
      const isNewDashboard = dashboards === "new";

      const dashboardWidgets = [] as WidgetT[];

      for (const widget of foundWidgets) {
        if (!widget?.widgetType) continue;
        // we need to do something like this because Category of these widgets are now "Others"
        const typeToUse = getTypeToUse(widget.widgetType, widget.selectionId);

        const dashboardWidget = createDashboardWidget(widget, typeToUse);
        if (dashboardWidget) {
          dashboardWidgets.push(dashboardWidget);
        }
      }

      let dashId = "";

      if (isNewDashboard) {
        const newDashboardId = uuidv4();
        dashId = newDashboardId;
        useAppStore.getState().addTab({
          index: newDashboardId,
          data: {
            name: generateRandomName(),
            type: "custom",
            widgets: dashboardWidgets,
          },
        });
      } else {
        dashId = dashboards[0];
        useAppStore.getState().addWidgetsToTabs(dashboards, dashboardWidgets);
      }

      if (dashboardWidgets.length === 0) {
        toast.error("No widgets found", {
          description: "No valid widgets found to add to the dashboard",
        });
        return;
      }

      toast.success(`Added ${dashboardWidgets.length} widgets to selected dashboards`, {
        description: "Navigate to the dashboard to view the widgets",
        action: {
          label: "See Dashboard",
          onClick: () => navigate(`/app/${dashId}`),
        },
      });
    },
    [allElems, selectedWidgets, navigate],
  );

  const toggleWidget = useCallback((id: string) => {
    setSelectedWidgets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleGroup = useCallback((ids: string[]) => {
    setSelectedWidgets((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  }, []);

  const toggleAll = (ids: string[]) => {
    setSelectedWidgets((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  };

  const isSelected = useCallback(
    (id: string) => selectedWidgets.has(id),
    [selectedWidgets],
  );

  const isGroupSelected = useCallback(
    (ids: string[]) => {
      const selectedCount = ids.filter((id) => selectedWidgets.has(id)).length;
      if (selectedCount === 0) return false;
      if (selectedCount === ids.length) return true;
      return "indeterminate";
    },
    [selectedWidgets],
  );

  return (
    <MyDataConnectorsContext.Provider
      value={{
        selectedWidgets,
        toggleWidget,
        toggleGroup,
        toggleAll,
        isSelected,
        isGroupSelected,
        allElems,
        handleAddToDashboard,
        isLoading,
      }}
    >
      {children}
    </MyDataConnectorsContext.Provider>
  );
}

export const useMyDataConnectors = () => {
  const context = useContext(MyDataConnectorsContext);
  if (!context) {
    throw new Error("useMyDataConnectors must be used within MyDataConnectorsProvider");
  }
  return context;
};
