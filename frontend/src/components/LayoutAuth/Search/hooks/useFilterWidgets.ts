import { useMemo } from "react";
import { CORE_WIDGET_IDS } from "~/lib/utils/widget";
import type { SearchDialogState } from "../SearchDialog";
import type { WidgetItem } from "../WidgetMenu";

export function useFilterWidgets(widgets: WidgetItem[], state: SearchDialogState) {
  const widgetsMemo = useMemo(
    () =>
      widgets.map((widget) => {
        const category =
          widget.category?.toLowerCase() === "others" && widget.external
            ? "my data"
            : widget?.category
              ? widget?.category.toLocaleLowerCase()
              : "my data";

        return { ...widget, category };
      }),
    [widgets],
  );

  const widgetsArray = useMemo(() => {
    const { selectedOption, selectedCategory } = state;
    const showAll = selectedOption === "all";

    const filteredWidgets = widgetsMemo
      .filter((widget) => {
        if (widget?.external && (selectedOption === "external" || showAll)) return true;

        if (widget?.plugin && showAll) return true;

        if (
          (selectedOption === "shared" || showAll) &&
          ["shared files", "shared backends"].includes(widget?.category?.toLowerCase())
        )
          return true;

        const realWidgetId = widget?.widgetId?.split("-")?.[0] || widget?.widgetId;
        return !!realWidgetId && CORE_WIDGET_IDS.includes(realWidgetId) && showAll;
      })
      .filter(
        (widget) =>
          selectedCategory === "All" ||
          widget.category.toLowerCase() === selectedCategory.toLowerCase() ||
          (selectedCategory?.toLowerCase() === "others" &&
            widget?.category === "my data"),
      )
      .sort((a, b) => {
        if (a.category.toLowerCase() !== b.category.toLowerCase()) {
          return a.category.toLowerCase().localeCompare(b.category.toLowerCase());
        }
        if (a.subCategory !== b.subCategory) {
          return (a.subCategory || "").localeCompare(b.subCategory || "");
        }
        return a.name.localeCompare(b.name);
      });

    return filteredWidgets;
  }, [widgetsMemo, state.selectedOption, state.selectedCategory]);

  return widgetsArray;
}
