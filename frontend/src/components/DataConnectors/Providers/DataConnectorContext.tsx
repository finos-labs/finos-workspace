import { createContext, useContext } from "react";

export type DcTabT = "backend" | "file" | "website" | "rss";

type DataConnectorContextType = {
  inDashboard: boolean;
  open: boolean;
  pendingNavigate: (path: string) => void;
  dcTab: DcTabT;
  setTab: (dcTab: DcTabT) => void;
  mode: "create" | "edit" | "add-widget";
  id?: string;
  widgetId?: string;
  setOpen: (
    open: boolean,
    options?: {
      dcTab: DcTabT;
      mode: "create" | "edit" | "add-widget";
      id?: string;
      widgetId?: string;
    },
  ) => void;
  onWidgetAdded?: () => void;
};

export const DataConnectorContext = createContext<DataConnectorContextType | undefined>(
  undefined,
);

DataConnectorContext.displayName = "DataConnectorContext";

export function useDataConnectorContext() {
  const context = useContext(DataConnectorContext);
  if (!context) {
    throw new Error(
      "useDataConnectorContext must be used within a DataConnectorProvider",
    );
  }
  return context;
}
