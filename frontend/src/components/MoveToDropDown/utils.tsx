import { useAppStore } from "~/lib/state/app";
import { convertToReadableLabel } from "~/lib/utils/format";
import { NotificationId, showNotificationWithRememberMe } from "~/lib/utils/toast";
import type { ExportFns, MoveToOnSelectProps } from "./types";

export function getExportFns(exportFns?: ExportFns) {
  const exportFunctions = [
    { value: "CSV", fn: exportFns?.csvFunction },
    { value: "PNG", fn: exportFns?.pngFunction },
    { value: "PDF", fn: exportFns?.pdfFunction },
    { value: "TXT", fn: exportFns?.txtFunction },
  ];

  return exportFunctions.filter(({ fn }) => fn !== undefined && fn !== null);
}

export async function ScrollToWidget() {
  const element =
    document.getElementsByClassName("react-grid-layout")?.[0].lastElementChild;
  element?.scrollIntoView();
}

export async function AddWidgetOnSelect(props: MoveToOnSelectProps) {
  const { widget, tab, activeDashboardId, navigate } = props;
  const innerTab = convertToReadableLabel(widget.innerTab);

  const copiedTo = innerTab
    ? `${tab.data.name} in ${innerTab} tab`
    : `new dashboard named ${tab?.data.name}`;

  useAppStore.getState().duplicateWidget(tab.index, widget);

  const queryParam = widget.innerTab ? `?tab=${widget.innerTab}` : "";

  let action = { label: "Scroll to widget", onClick: ScrollToWidget };
  if (activeDashboardId !== tab.index || widget.innerTab !== tab.data.currentTab) {
    action = {
      label: "Go to dashboard",
      onClick: async () => {
        navigate(`/app/${tab.index}${queryParam}`);
        setTimeout(ScrollToWidget, 500);
      },
    };
  }

  showNotificationWithRememberMe({
    id: NotificationId.WidgetMoved,
    message: "Widget copied",
    description: `Widget ${widget.name} copied to ${copiedTo}`,
    action,
    toastType: "success",
  });

  if (!action) ScrollToWidget();
}
