import { createContext, type PropsWithChildren, useContext, useMemo } from "react";
import { useCreateRef } from "~/hooks/useRefHooks";
import type { NewWidgetT, WidgetContextType, WidgetProps, WidgetT } from "./types";
import { useWidgetSync } from "./Widget.hooks";

export interface WidgetStoreProps {
  widget: WidgetT;
  widgetFromJSON: WidgetT | null;
  activeDashboardId: string;
  isShared: boolean;
  uuid: string;
}

export interface WidgetState extends WidgetStoreProps {
  storageParams: NonNullable<WidgetT["storage"]>["params"];
  storage: WidgetT["storage"];
  needsUpdate: boolean;
  endpointParams: Record<string, string>;
  getParamName: (groupById: string) => string;
  updateWidget: (newWidget: NewWidgetT, forceStoreUpdate?: boolean) => void;
}

export const WidgetContext = createContext<Partial<WidgetContextType>>({
  widgetFromJSON: null,
  activeDashboardId: "",
  isShared: false,
  isPreview: false,
  uuid: "",
  updateWidget: (_prev) => {},
});

WidgetContext.displayName = "WidgetContext";

export function useWidgetContext(
  nullable: true,
  contextOverride?: Partial<WidgetContextType>,
): Partial<WidgetContextType>;
export function useWidgetContext(
  nullable?: false,
  contextOverride?: Partial<WidgetContextType>,
): WidgetContextType;
export function useWidgetContext(
  nullable = false,
  contextOverride?: Partial<WidgetContextType>,
) {
  const context = useContext(WidgetContext);
  if (!(context || nullable)) {
    throw new Error("useWidgetContext must be used within a WidgetProvider");
  }
  if (contextOverride) {
    return { ...context, ...contextOverride };
  }
  return context;
}

export function WidgetProvider(props: PropsWithChildren<WidgetProps>) {
  const { children, ...rest } = props;
  const { activeDashboardId, isShared, isPreview, uuid } = rest;
  const [updateWidget, widget, widgetFromJSON] = useWidgetSync(rest);

  const widgetRef = useCreateRef(widget);

  const getWidget = useMemo(() => () => widgetRef.current, [widgetRef]);

  const childrenMemo = useMemo(() => children, [children]);

  return (
    <WidgetContext.Provider
      value={{
        widget,
        widgetRef,
        widgetFromJSON,
        activeDashboardId: activeDashboardId ?? "",
        isShared: isShared ?? false,
        isPreview: isPreview ?? false,
        uuid: uuid ?? "",
        updateWidget,
        getWidget,
      }}
    >
      {childrenMemo}
    </WidgetContext.Provider>
  );
}

WidgetProvider.displayName = "WidgetProvider";
