import type { MutableRefObject } from "react";
import type { Layout } from "react-grid-layout";
import type { InnerTab } from "~/lib/state/app";
import type { ArtifactT, Citation, QuoteBoundingBox } from "~/lib/state/copilot";
import type { EditorLanguage, WidgetVizType } from "~/lib/types/app";
import type { DateModifierValue } from "~/lib/utils/widgetParams";
import type { ConnectionType } from "../lib/state/backendConnector";
import { useGetAppWidgets } from "./AI/hooks/useGetAppWidgets";
import type { WidgetId } from "./Widgets";

export type GridData = Partial<Layout> & {
  i?: string; // Unique identifier for the widget.
  x?: number; // Horizontal grid position.
  y?: number; // Vertical grid position.
  w?: number; // Width for the widget in the grid.
  h?: number; // Height for the widget in the grid.
  minH?: number; //
  minW?: number; //
  maxH?: number; //
  maxW?: number; //
  originalMinH?: number; // Original minimum height before minimization.
  mobileH?: number; // Height for mobile view.
  moved?: boolean; // Indicates if the widget has been moved.
  static?: boolean; // Indicates if the widget is static and cannot be moved.
  isDraggable?: boolean; // Specifies if the widget can be dragged.
};

type GridInnerTab<T = string> = T;

export type GridLayout = {
  [key: GridInnerTab]: GridData[];
};

export type GroupTypes = "ticker" | "endpointParam" | "param";

interface GroupBase<T> {
  type: T;
  id: string;
  name: string;
  color: string;
  groupById: unknown;
}

export type EndpointParam = {
  label: string;
  paramName: string;
  value: string;
};

interface LinkedParamGroup extends GroupBase<"param"> {
  type: "param";
  groupById: string;
  /** Null until a widget in the group has a value for the parameter. */
  value: StoredParamValue;
}

interface TickerGroup extends GroupBase<"ticker"> {
  type: "ticker";
  value: Ticker | null;
  acceptAssetClasses?: string[];
}

interface EndpointParamGroup extends GroupBase<"endpointParam"> {
  type: "endpointParam";
  groupById: string;
  value: StoredParamValue;
}

export type Group = TickerGroup | EndpointParamGroup | LinkedParamGroup;
export type GroupTypeT<T extends GroupTypes> = Extract<Group, { type: T }>;

export type TickerCategory =
  | "crypto"
  | "equity"
  | "forex"
  | "index"
  | "futures"
  | "derivative"
  | "country"
  | "etf";

export type Ticker = {
  id: string;
  symbol: string;
  category: TickerCategory;
  color?: string;
  type: "index" | "etf" | "economic" | "stock" | "indices" | "country";
  name?: string;
  exchange?: string;
  currency?: string | null;
  industry?: string | null;
  sector?: string | null;
  country?: string | null;
  cik?: string | null;
  isin?: string | null;
  cusip?: string | null;
  has_options?: boolean;
};

/** A parameter's value: what the widget's param controls and the grouping hold. */
export type StoredParamValue =
  | string
  | number
  | boolean
  | null
  | (string | number | boolean | null)[];

/** What a widget keeps with itself, on top of its definition. */
export type WidgetStorage = {
  params?: Record<string, StoredParamValue>;
  tabs?: InnerTab[];
  /** Iframe-only: pre-set MCP server URL from widgets.json — auto-connects on mount */
  mcpUrl?: string;
  /** ISO datetime a static artifact (file/AI artifact) was added. */
  createdAt?: string;
  html?: string;
  text?: string;
  scale?: number;
  page?: number;
  citations?: Citation[];
  artifacts?: ArtifactT[];
  quoteBoundingBoxes?: QuoteBoundingBox[][];
  rawDataView?: boolean;
  disableAI?: boolean;
  selectedGroup?: string;
  userAppId?: string;
  iframeParams?: Record<string, StoredParamValue>;
  /** Anything else a widget keeps, such as what an iframe stores for itself. */
  [key: string]: unknown;
};

export type Widget = {
  // 🔹 Core Identity & Classification
  id: string; // Unique identifier for the widget.
  name: string; // Name of the widget in the list the user sees. Displayed on top left of widget
  type: WidgetVizType; // Main widget type
  widgetId?: WidgetId; // Identifier for the specific widget instance. Used to map to the widgets of the backend
  description?: string; // description to show to user on the info button and on the search/add widget menu
  category?: string; // Category for the widget. Used to group widgets in the widget list
  subCategory?: string; // Subcategory for the widget. Used to group widgets in the widget list
  // biome-ignore format: off
  widgetType?: "backend" | "file" | "html"; // Type of widget
  raw?: boolean; // Indicates if the widget supports raw data toggle.
  /** Backend widgets that front an MCP tool declare which one, so a call to that tool can cite the widget. */
  mcp_tool?: { mcp_server?: string; tool_id?: string };
  imgUrl?: string; // Image URL for the widget - will show on preview when hovering in search/add widget menu
  innerTab?: string; // if it's from a template it may have a tab assigned. e.g., equity template
  /** @internal only available before widget {@link useGetAppWidgets | creation} */
  readonly defaultViz?: WidgetVizType; // Default visualization for the widget. (backward compatibility)

  // 🔹 Layout / Grouping
  gridData?: GridData; // Grid data for the widget.
  showTitle?: boolean; // Indicates if the widget title should be shown.
  exportable?: boolean; // Whether this widget can be exported. Defaults to true.
  /** @internal **/
  groupId?: string | null; // Identifier for a widget group.
  /** @internal **/
  groupById?: string;
  /** @internal **/
  paramGroups?: { [key: string]: string }; // Param groups for the widget.

  // 🔹 Supported Context - only used for Internal Widgets
  supportedAssetClasses?: string[];
  defaultAssetClass?: string;

  // 🔹 Data Model
  data?: {
    /** ### Main ticker information.
     * - Displayed on top left after the widget name.
     * - Normally can be changed on this dropdown
     */
    mainTicker?: Ticker;
    /** Nested reference to the data used in the widget. */
    dataKey?: string;
  };

  // 🔹 API / Data Fetching
  endpoint?: {
    // Endpoint or endpoints for the widget data.
    url: string; // URL for the endpoint.
    method: "GET" | "POST"; // Method for the endpoint.
  };
  endpointMethod?: "GET" | "POST"; // Endpoint method
  params?: ParamDef[]; // url params to send to endpoint

  // 🔹 External Integration
  external?: boolean; // Indicates if the widget is external, i.e., if data is loaded from outside Workspace API
  connectionType?: ConnectionType; // Connection type for the widget data.
  source?: string | string[]; // Source for the widget. Where the data for the widget is coming from.
  sourceId?: string; // Source id for the widget.
  sourceName?: string; // Source name for the widget for external widgets.

  // 🔹 Runtime / Storage
  storage?: WidgetStorage;

  // 🔹 Copilot & Experimental
  disableRetrievalForCopilot?: boolean; // Indicates if the widget can be used by Copilot.
  // Metadata to send to the copilot
  metadata?: { [key: string]: unknown };

  /**
   * @internal **Only available before widget {@link useGetAppWidgets | creation}**
   * @use `data.dataKey` on creation
   */
  readonly dataKey?: string; // Nested reference to the data.
  /**
   * The rows of a data backend's credentials, as its source holds them. Widgets never
   * carry these: they look up their source's credentials when they fetch
   * (lib/utils/endpointCredentials). */
  readonly endpointHeaders?: {
    key: string;
    value: string;
    location?: "headers" | "query";
  }[];
  /**
   * @internal **Only available before widget {@link useGetAppWidgets | creation}**
   */
  readonly extension?: string; // File extension for the widget. Used to identify the file type.
  /**
   *  @internal **Set to true on widget creation.**
   */
  isNew?: boolean; // Indicates if the widget is newly created. Set to false after the first save.
  dataUpdateDisplay?: string; // 5-field cron expression used to display the data update schedule.
};

type WidgetT = Widget & {
  disabled?: boolean;
  /** @internal updates queryKey to force a refresh of the widget */
  refreshQuery?: number;
  storage?: Widget["storage"];
  staleTime?: number; // Stale time in milliseconds for the widget data.
  refetchInterval?: number | false | string; // Refetch interval in milliseconds or as a 5-field cron expression.
  dataUpdateDisplay?: string; // 5-field cron expression used to display the data update schedule.
  runButton?: boolean; // Indicates if the widget has a run button.
  /** @internal saved when the widget is minimized */
  originalH?: number; // Original height before minimizing.
  /** @internal saved when the widget is minimized */
  isMinimized?: boolean; // Indicates if the widget is minimized.
  isSharedWidget?: boolean; // Indicates if the widget is shared.
  raw?: boolean; // Indicates if the widget supports raw data toggle.
};

export type NewWidgetT = WidgetT | ((prev: WidgetT) => WidgetT);
/** A widget that has not been added to a dashboard yet, so it may not have an id. */
export type NewWidget = Omit<WidgetT, "id"> & { id?: string };
export type WidgetJsonT = Omit<WidgetT, "id" | "endpoint"> & {
  id?: string;
  endpoint?: string;
};

export type WidgetContextType = {
  widget: WidgetT;
  widgetRef: MutableRefObject<WidgetT>;
  widgetFromJSON: Partial<Widget> | null;
  /** The dashboard the widget is on; empty for a widget outside of one (a preview). */
  activeDashboardId: string;
  isShared: boolean;
  isPreview: boolean;
  uuid: string;
  updateWidget: (newWidget: NewWidgetT, forceStoreUpdate?: boolean) => void;
  getWidget: () => WidgetT;
};

export interface WidgetProps {
  uuid?: string;
  isShared?: boolean;
  isPreview?: boolean;
  activeDashboardId?: string;
  contextOverride?: Partial<WidgetContextType>;
}
type ParamValueT<T extends ParamType> = Extract<ParamDef, { type: T }>["value"];
type ParamType =
  | "date"
  | "text"
  | "ticker"
  | "number"
  | "boolean"
  | "endpoint"
  | "button"
  | "form"
  | "tabs";
type ParamValue = string | number | boolean | undefined;
type ParamOptionValue = string | number | boolean;

interface BaseParamDef<PT extends ParamType = "text"> {
  type: PT;
  paramName: string; // query param name as it appears in the url
  value?: ParamValue; // default value
  label?: string; // label to show in the UI
  show?: boolean; // show in the UI
  description?: string; // description to show on hover
  options?: { label: string; value: ParamOptionValue }[]; // options for dropdowns
  multiSelect?: boolean; // allow multiple selections
  placeholder?: string;
  row?: number;
  style?: { popupWidth?: number };
  roles?: string[]; // defines custom roles for the param, like "fileSelector" for a file switcher
  multiple?: boolean;
  language?: EditorLanguage; // language of a code-valued param
  hidden?: boolean; // hide the param in the UI
}

interface TextParamDef extends BaseParamDef<"text"> {
  type: "text";
  value?: string;
}

interface DateParamDef extends BaseParamDef<"date"> {
  type: "date";
  value?: DateModifierValue;
}
interface TickerParamDef extends BaseParamDef<"ticker"> {
  type: "ticker";
  value?: Ticker["symbol"];
}

interface NumberParamDef extends BaseParamDef<"number"> {
  type: "number";
  value?: number;
}

interface BooleanParamDef extends BaseParamDef<"boolean"> {
  type: "boolean";
  value?: boolean;
}

interface EndpointParamDef extends BaseParamDef<"endpoint"> {
  type: "endpoint";
  optionsEndpoint?: string;
  optionsParams?: Record<string, string>;
  groupById?: string; // enables grouping other widgets by this endpoint param
}

interface FormButton extends BaseParamDef<"button"> {
  type: "button";
  label: string;
  value?: string | number | boolean;
}

interface TabsParamDef extends BaseParamDef<"tabs"> {
  type: "tabs";
  value?: string;
  options: { label: string; value: string }[];
}

type FormInputType = "date" | "boolean" | "endpoint" | "number" | "text" | "button";
export type FormInputParamDef = Exclude<ParamDef, { type: "form" | "ticker" | "tabs" }>;

export type FormInputParamDefT<T extends FormInputType = FormInputType> = Extract<
  FormInputParamDef,
  { type: T }
>;

interface FormParamDef extends BaseParamDef<"form"> {
  type: "form";
  endpoint: string;
  method: "POST" | "PUT";
  inputParams: FormInputParamDef[];
}

// biome-ignore format: on
export type ParamDef = TextParamDef | TickerParamDef | DateParamDef | NumberParamDef | BooleanParamDef | EndpointParamDef | FormParamDef | FormButton | TabsParamDef;
export type ParamDefT<T extends ParamType> = Extract<ParamDef, { type: T }>;

export type {
  GridData as GridDataT,
  GridLayout as GridLayoutT,
  Group as GroupT,
  Ticker as TickerT,
  WidgetT,
};
