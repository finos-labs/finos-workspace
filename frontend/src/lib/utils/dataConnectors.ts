import { toast } from "sonner";
import { v4 as uuid } from "uuid";
import type { WidgetJsonT, WidgetT } from "~/components/types";
import { generateRandomName } from "~/lib/utils";
import type { WidgetType } from "~/utils/zodForms";
import { useAppStore } from "../state/app";

export function handleConnectionAdded<
  T extends WidgetT | WidgetType | WidgetJsonT = WidgetT,
>(
  dashboardId: string | undefined,
  widgets: T[],
  navigate: (path: string) => void,
  isEdit = false,
) {
  const widgetCount = widgets.length;

  let description = `The widget${widgetCount > 1 ? "s have" : " has"} been added to the widget menu (accessible via Ctrl + K).`;
  let successMessage = `${widgetCount} widget${widgetCount > 1 ? "s" : ""} added to widget menu`;

  if (isEdit) {
    description = `The widget${widgetCount > 1 ? "s have" : " has"} been updated on the widget menu (accessible via Ctrl + K).`;
    successMessage = `${widgetCount} widget${widgetCount > 1 ? "s" : ""} updated on the widget menu`;
  }

  if (widgetCount > 10) {
    toast.success(`${widgetCount} widgets added to widget menu`, {
      description,
    });
    return;
  }
  if (dashboardId) {
    useAppStore.getState().addWidgets(dashboardId, widgets as WidgetT[]);
    toast.success(
      `${widgetCount} widget${widgetCount > 1 ? "s" : ""} added to dashboard`,
      {
        description: `The widget${widgetCount > 1 ? "s have" : " has"} been added to the current dashboard.`,
      },
    );
  } else {
    toast.success(successMessage, {
      className: "_toast-success",
      description,
      action: {
        label: "Add to new dashboard",
        onClick: () => {
          const newDashboardId = uuid();
          useAppStore.getState().addTab({
            index: newDashboardId,
            data: {
              name: generateRandomName(),
              type: "custom",
              widgets: widgets as WidgetT[],
            },
          });
          navigate(`/app/${newDashboardId}`);
        },
      },
    });
  }
}
