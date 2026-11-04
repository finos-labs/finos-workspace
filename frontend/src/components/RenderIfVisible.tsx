import { forwardRef, type ReactNode } from "react";
import { useIntersectionObserver } from "usehooks-ts";
import { useShallowThemeStore } from "~/lib/state/theme";
import { cn } from "~/lib/utils";
import BrandedLogo from "./General/BrandedLogo";
import { useWidgetContext } from "./Widget.context";

type Props = {
  initialVisible?: boolean;
  visibleOffset?: number;
  stayRendered?: boolean;
  rootElementClass?: string;
  children: ReactNode;
};

const InitialVisibleWidgetIds = ["navigation_bar", "market_indices"];

const RenderIfVisible = forwardRef<HTMLDivElement, Props>(
  (
    {
      initialVisible = false,
      visibleOffset = 400,
      stayRendered = true,
      rootElementClass = "widgetContent w-full h-full rounded bg-white text-xs shadow-xs dark:bg-dark-900",
      children,
    },
    _forwardedRef,
  ) => {
    const widgetId = useWidgetContext(true)?.widget?.widgetId;
    const isMinimized = useWidgetContext(true)?.widget?.isMinimized;

    const pendingExport = useShallowThemeStore((state) => state.pendingExport);

    initialVisible = initialVisible || pendingExport;

    const { ref, isIntersecting } = useIntersectionObserver({
      root: document.getElementById("workarea"),
      rootMargin: `${visibleOffset}px 0px ${visibleOffset}px 0px`,
      threshold: 0.5,
      freezeOnceVisible: stayRendered,
      initialIsIntersecting: Boolean(
        isMinimized ||
          (widgetId !== undefined && InitialVisibleWidgetIds.includes(widgetId)) ||
          initialVisible,
      ),
    });

    const renderChildren = isIntersecting || initialVisible;

    return (
      <div ref={ref} className={cn("renderIfVisible", rootElementClass)}>
        {renderChildren ? (
          children
        ) : (
          <div className="flex w-full h-full items-center justify-center overflow-hidden p-4">
            <BrandedLogo />
          </div>
        )}
      </div>
    );
  },
);

RenderIfVisible.displayName = "RenderIfVisible";

export default RenderIfVisible;
