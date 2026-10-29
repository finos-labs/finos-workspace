import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { deleteUserAppShare, syncUserApps } from "~/api/auth.api";
import type { WidgetJsonT } from "~/components/types";
import { canReceiveShares, useShallowAccessStore } from "~/lib/state/access";
import { useShallowAuthStore } from "~/lib/state/auth";
import { duplicateTabItem } from "~/lib/utils";
import {
  createCustomTemplateTab,
  getUntouchedAppTabInfo,
} from "~/lib/utils/createTemplates";
import type { AppMcpServer } from "~/types/appMcpServer";
import { useShallowAppStore } from "../lib/state/app";
import {
  getTemplateWidgetsMetadata,
  type Source,
  useShallowBackendConnectorStore,
} from "../lib/state/backendConnector";
import { type SharedUser, useShallowUserAppsStore } from "../lib/state/userApps";
import { useSharedTemplates } from "./useSharedTemplates";

export type TemplateType = "user" | "shared" | "generated";

export interface UnifiedTemplate {
  id: string;
  name: string;
  description: string;
  type: TemplateType;
  selected_agent?: string;
  widgets:
    | Partial<WidgetJsonT>[]
    | { name: string; description?: string; count?: number }[];
  totalWidgets?: number;
  prompts: string[];
  mcpServers?: AppMcpServer[];
  img?: string;
  img_dark?: string;
  img_light?: string;
  onClick: () => void;
  onOpen?: () => void;
  onDelete?: () => Promise<void>;
  onAfterDelete?: () => void;
  source?: Source;
  isShared?: boolean;
  createdBy?: string;
  creator?: boolean;
  sharedWith?: SharedUser[];
}

export function useAllTemplates(isLoadingApiSources = false) {
  const userEmail = useShallowAuthStore((state) => state.user?.email || "");
  const mayReceive = useShallowAccessStore((state) => canReceiveShares(state.access));
  const { data: sharedTemplatesData = [] } = useSharedTemplates({
    enabled: !isLoadingApiSources,
  });
  const apiSources = useShallowBackendConnectorStore((state) => state.apiSources);
  const { userGeneratedApps, userSharedApps, removeUserApp } = useShallowUserAppsStore(
    (state) => ({
      userGeneratedApps: state.getAllUserApps(),
      userSharedApps: state.getAllSharedUserApps(),
      removeUserApp: state.removeUserApp,
    }),
  );

  const { getTabById, addTab, items } = useShallowAppStore((state) => ({
    getTabById: state.getTabById,
    addTab: state.addTab,
    items: state.items,
  }));
  const navigate = useNavigate();
  const { id: currentDashboard } = useParams();

  const allTemplates = useMemo<UnifiedTemplate[]>(() => {
    const sharedTemplateIds = new Set(
      sharedTemplatesData.map((template) => template.id),
    );

    const userTemplates = apiSources
      .filter((source) => source.templates && source.templates.length > 0)
      .flatMap((source) =>
        (source.templates || []).map((template) => {
          const { widgets, totalWidgets } = getTemplateWidgetsMetadata(
            template,
            source,
          );

          return {
            id: template.id,
            name: template.name,
            description: template.description,
            type: "user",
            totalWidgets,
            widgets,
            prompts: template.prompts || [],
            mcpServers: template.mcpServers,
            selected_agent: template.selected_agent,
            img: template.img,
            img_dark: template.img_dark,
            img_light: template.img_light,
            onClick: () => {
              createCustomTemplateTab({
                addTab,
                navigate,
                items,
                template,
                source,
                currentDashboard,
              });
            },
            source,
            isShared: sharedTemplateIds.has(template.id),
          } as UnifiedTemplate;
        }),
      );

    const userTemplateIds = new Set(userTemplates.map((template) => template.id));

    const sharedTemplates = sharedTemplatesData
      .filter((template) => !(template.id && userTemplateIds.has(template.id)))
      .map((template) => {
        const { widgets, totalWidgets } = getTemplateWidgetsMetadata(
          template,
          template.source,
        );

        return {
          id: template.templateId,
          name: template.name,
          description: template.description,
          type: "shared",
          totalWidgets,
          widgets,
          prompts: template.prompts,
          img: template.img,
          img_dark: template.img_dark,
          img_light: template.img_light,
          createdBy: template.createdBy,
          onClick: () => {
            if (!template.source) return;
            createCustomTemplateTab({
              addTab,
              navigate,
              items,
              template,
              source: template.source,
              currentDashboard,
            });
          },
          source: template.source,
        } as UnifiedTemplate;
      });

    const generatedAppTemplates = [
      ...userGeneratedApps,
      ...(mayReceive ? userSharedApps : []),
    ].map((app) => {
      const widgets = app.widgets
        .filter((w) => w.widgetId && w.name)
        .map((w) => ({
          name: w.name || w.widgetId,
          count: 1,
        }));

      const uniqueWidgets = widgets.reduce(
        (acc, widget) => {
          const existing = acc.find((w) => w.name === widget.name);
          if (existing) {
            existing.count += 1;
          } else {
            acc.push({ ...widget });
          }
          return acc;
        },
        [] as typeof widgets,
      );

      return {
        id: app.uuid,
        name: app.name,
        description: app.description,
        type: "generated",
        totalWidgets: app.widgets.length,
        widgets: uniqueWidgets,
        prompts: app.prompts || [],
        selected_agent: app.selected_agent,
        img: app.img,
        img_dark: app.img_dark,
        img_light: app.img_light,
        isShared: app.isShared,
        createdBy: app.createdBy,
        creator: app.creator,
        sharedWith: app.sharedWith,
        onClick: () => {
          const templateId = `custom-${app.uuid}` as const;
          const { tabName, navigateTo } = getUntouchedAppTabInfo(
            templateId,
            app.name,
            items,
          );
          if (navigateTo) {
            if (navigate) navigate(navigateTo);
            return;
          }

          const tabData = {
            name: tabName,
            type: "custom",
            templateId,
            widgets: app.widgets,
            groups: app.groups || [],
            gridLayout: app.gridLayout || {},
          } as const;

          const newTab = duplicateTabItem(
            {
              index: "",
              children: [],
              data: { ...tabData, name: tabName ?? app.name },
            },
            undefined,
            false,
          );
          const index = newTab.index;

          addTab(newTab, true);

          if (navigate) {
            setTimeout(() => {
              const tab = getTabById(index);
              if (!tab) return;
              navigate(`/app/${index}`);
            }, 100);
          }
        },
        onDelete: async () => {
          if (!app.uuid) throw new Error("The app has no uuid");
          if (app.creator) return await removeUserApp(app.uuid);
          if (userEmail) {
            const data = await deleteUserAppShare(app.uuid, [userEmail]);
            if (!data?.success)
              throw new Error(data?.detail || "Failed to delete app share");

            await syncUserApps();
            toast.success("App share deleted successfully", {
              id: "delete-app-share",
              description: "You have successfully removed your access to this app.",
            });
          }
        },
        source: {
          id: `generated-${app.uuid}`,
          name: app.name,
          createdDate: app.createdDate,
        } as Partial<Source>,
      } as UnifiedTemplate;
    });

    return [
      ...sharedTemplates,
      ...userTemplates,
      ...generatedAppTemplates,
    ] as UnifiedTemplate[];
  }, [
    apiSources,
    sharedTemplatesData,
    userGeneratedApps,
    userSharedApps,
    mayReceive,
    addTab,
    navigate,
    items,
    currentDashboard,
    removeUserApp,
    getTabById,
  ]);

  return allTemplates;
}
