import type { StoredParamValue } from "~/components/types";
import type { WidgetId } from "~/components/Widgets";

type WidgetState = {
  paramOrder?: string[];
  params?: Record<string, StoredParamValue>;
  storage?: {
    text?: string;
    html?: string;
    rawDataView?: boolean;
    /** A plugin widget's configuration, which its plugin's settings define */
    plugin?: { config?: Record<string, unknown> };
  };
};

export type TabLayout<Extra = {}> = {
  i: WidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
  state?: WidgetState;
  /** Whether the widget starts minimized. */
  minimized?: boolean;
} & Extra;
