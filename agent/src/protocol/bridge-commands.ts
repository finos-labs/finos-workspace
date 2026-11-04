import { z } from "zod";


const widgetConfigSchema = z
  .object({
    data_args: z.record(z.string(), z.unknown()).nullable().optional().describe("The values of the widget's data parameters."),
    ui_args: z.record(z.string(), z.unknown()).nullable().optional().describe("The values of the widget's interface settings."),
  })
  .describe(
    "Widget config split into data_args (data inputs) and ui_args (UI inputs). " +
      "Layout fields belong on update_dashboard_layout, not here.",
  );

const backendEndpointHeaderSchema = z.object({
  key: z.string().describe("The name of the header or of the query parameter."),
  value: z.string().describe("The value that the backend's endpoints receive."),
  location: z.enum(["headers", "query"]).optional().describe("Whether it goes in the headers or in the query. The default is headers."),
});

const DASHBOARD_ID_DESCRIPTION =
  "Target dashboard UUID. Omit to target the current FINOS Workspace route.";

const optionalDashboardId = z
  .string()
  .optional()
  .describe(DASHBOARD_ID_DESCRIPTION);

const getWorkspaceSnapshotInputSchema = z.object({});

export const listAvailableWidgetsInputSchema = z.object({
  origin: z
    .string()
    .optional()
    .describe(
      "Friendly catalog label (e.g. 'Options Activity Monitor'). Matches exactly.",
    ),
  backend_id: z
    .string()
    .optional()
    .describe("Optional backend UUID returned by manage_backends."),
});

const getWidgetSchemaInputSchema = z.object({
  origin: z
    .string()
    .min(1)
    .describe("Friendly catalog label from list_available_widgets."),
  widget_id: z
    .string()
    .min(1)
    .describe("Widget id from list_available_widgets."),
});

const getParamsOptionsInputSchema = z.object({
  param_options_queries: z
    .array(
      z.object({
        origin: z.string().describe("The origin of the widget."),
        widget_id: z.string().describe("The widget type id."),
        param_name: z.string().describe("The name of the parameter to resolve."),
        data_args: z.record(z.string(), z.unknown()).optional().describe("The values that the lookup needs."),
      }),
    )
    .describe(
      "One entry per param to resolve. Use only after get_widget_schema marks " +
        "the param with requires_options_lookup=true.",
    ),
});

const readWidgetInputSchema = z.object({
  widget_uuid: z
    .string()
    .optional()
    .describe(
      "Canonical instance identifier from a workspace snapshot. Preferred over widget_id.",
    ),
  widget_id: z
    .string()
    .optional()
    .describe("Fallback widget type identifier when uuid is unknown."),
  dashboard_id: optionalDashboardId,
});

export const createWidgetInputSchema = z.object({
  origin: z
    .string()
    .min(1)
    .describe(
      "Friendly catalog label returned by list_available_widgets. Required.",
    ),
  widget_id: z
    .string()
    .min(1)
    .describe("Widget id from list_available_widgets. Required."),
  dashboard_id: optionalDashboardId,
  config: widgetConfigSchema.optional(),
});

const updateWidgetInputSchema = z.object({
  widget_uuid: z
    .string()
    .optional()
    .describe(
      "Canonical widget instance identifier from a workspace snapshot.",
    ),
  widget_id: z
    .string()
    .optional()
    .describe("Fallback widget type identifier when uuid is unknown."),
  dashboard_id: optionalDashboardId,
  config: widgetConfigSchema.optional(),
});

const deleteWidgetInputSchema = z.object({
  widget_uuid: z
    .string()
    .optional()
    .describe("Canonical instance identifier from a workspace snapshot."),
  widget_id: z
    .string()
    .optional()
    .describe("Fallback widget type identifier when uuid is unknown."),
  dashboard_id: optionalDashboardId,
});

const manageDashboardInputSchema = z.object({
  operation: z
    .enum(["create", "read", "update"])
    .describe("Operation to perform on the dashboard."),
  dashboard_id: optionalDashboardId.describe(
    "Dashboard UUID. Omit on read to target the current FINOS Workspace route. Required for update.",
  ),
  name: z
    .string()
    .optional()
    .describe("Dashboard display name. Required for create and update."),
  activate: z
    .boolean()
    .optional()
    .describe(
      "On create, whether to activate the new dashboard route. Defaults true.",
    ),
});

const updateDashboardLayoutInputSchema = z.object({
  x: z.number().describe("Grid column position (0-based)."),
  y: z.number().describe("Grid row position (0-based)."),
  w: z.number().describe("Grid width. 40 = full row."),
  h: z.number().describe("Grid height in rows."),
  widget_uuid: z
    .string()
    .optional()
    .describe(
      "Canonical widget instance identifier from a workspace snapshot.",
    ),
  widget_id: z
    .string()
    .optional()
    .describe("Fallback widget type identifier when uuid is unknown."),
  dashboard_id: optionalDashboardId,
  tab_id: z
    .string()
    .optional()
    .describe("Inner tab id to place the widget on. Omit to keep current tab."),
  min_w: z.number().optional().describe("Minimum width."),
  min_h: z.number().optional().describe("Minimum height."),
  max_w: z.number().optional().describe("Maximum width."),
  max_h: z.number().optional().describe("Maximum height."),
});

const manageNavigationBarInputSchema = z.object({
  operation: z
    .enum(["create", "add_tabs", "remove_tabs", "rename_tabs"])
    .describe("Operation: create | add_tabs | remove_tabs | rename_tabs."),
  dashboard_id: optionalDashboardId.describe(
    "Dashboard UUID. Omit to target the current FINOS Workspace route.",
  ),
  tabs: z
    .array(z.object({ name: z.string().describe("The name of the tab.") }))
    .optional()
    .describe(
      "Tab objects, e.g. [{name:'Quarterly Review'}]. Required for create, add_tabs, remove_tabs. " +
        "Do not pass tab_id; it is generated as the slug of name.",
    ),
  rename_map: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Map of {oldTabId: newName} for rename_tabs operation.",
    ),
});

const addGenerativeWidgetInputSchema = z.object({
  widget_type: z
    .enum(["note", "html"])
    .describe("Generative widget kind: a markdown note or an HTML widget (tables and charts are HTML)."),
  dashboard_id: optionalDashboardId,
  data: z
    .string()
    .nullable()
    .optional()
    .describe("Widget content as a plain string: markdown for a note, an HTML document for html."),
  name: z.string().optional().describe("Widget display name."),
  description: z.string().optional().describe("Widget short description."),
  inner_tab: z
    .string()
    .optional()
    .describe(
      "Existing inner tab id to place the widget on. Does NOT create a tab.",
    ),
});

const assignTasksToAgentsInputSchema = z.object({
  task_requests: z
    .array(
      z.object({
        id: z.string().describe("The id of the task."),
        description: z.string().describe("What the agent has to do."),
        assigned_holder_url: z.string().optional().describe("The URL of the agent's holder."),
        assigned_agent_id: z.string().optional().describe("The id of the agent."),
      }),
    )
    .describe(
      "Tasks shaped like {id, description, assigned_holder_url, assigned_agent_id}.",
    ),
});

const navigateWorkspaceInputSchema = z.object({
  operation: z
    .enum(["dashboard", "tab"])
    .describe(
      "Navigation target: 'dashboard' (full route) or 'tab' (inner tab).",
    ),
  dashboard_id: optionalDashboardId.describe(
    "Dashboard UUID. Required when operation='dashboard'.",
  ),
  tab_id: z
    .string()
    .optional()
    .describe(
      "Tab id (slug-form, e.g. 'quarterly-review'). Required when operation='tab'.",
    ),
});

const manageBackendsInputSchema = z.object({
  operation: z
    .enum(["list", "add", "update", "refresh", "remove"])
    .describe("Operation to perform on backends."),
  backend_id: z
    .string()
    .optional()
    .describe("Backend UUID. Required for update/refresh/remove."),
  name: z.string().optional().describe("Backend display name."),
  url: z.string().optional().describe("Backend base URL."),
  endpoint_headers: z
    .array(backendEndpointHeaderSchema)
    .optional()
    .describe(
      "Endpoint headers. location is 'headers' (default) or 'query'.",
    ),
  validate_widgets: z
    .boolean()
    .optional()
    .describe(
      "Whether to surface a warning if widgets fail to load. Defaults true on add.",
    ),
});

const manageAppsInputSchema = z.object({
  operation: z
    .enum(["list", "read", "instantiate"])
    .describe("Operation: list | read | instantiate."),
  backend_id: z
    .string()
    .describe(
      "Backend UUID. Required. Use manage_backends operation='list' to discover.",
    ),
  app_name: z
    .string()
    .optional()
    .describe(
      "App display name. Provide app_name or template_id for read/instantiate.",
    ),
  template_id: z
    .string()
    .optional()
    .describe(
      "Template UUID. Provide app_name or template_id for read/instantiate.",
    ),
  dashboard_name: z
    .string()
    .optional()
    .describe(
      "Override dashboard name on instantiate (defaults to app's name).",
    ),
  activate: z
    .boolean()
    .optional()
    .describe(
      "On instantiate, route the browser to the new dashboard. Defaults true.",
    ),
});


export interface WorkspaceBridgeCommandSpec {
  name: string;
  description: string;
  inputSchema: z.ZodObject<Record<string, z.ZodTypeAny>>;
}

export const WORKSPACE_BRIDGE_COMMANDS: readonly WorkspaceBridgeCommandSpec[] = [
  {
    name: "get_workspace_snapshot",
    description:
      "Request a fresh FINOS Workspace snapshot from the connected browser. " +
      "Call first when you need current dashboard state, dashboard identifiers, or skill identifiers. " +
      "Use list_available_widgets, get_widget_schema, and manage_dashboard for deeper follow-up inspection.",
    inputSchema: getWorkspaceSnapshotInputSchema,
  },
  {
    name: "list_available_widgets",
    description:
      "List widgets available to the current FINOS Workspace session. " +
      "Returns deterministic widget identities for later get_widget_schema and create_widget calls. " +
      "origin matches the friendly catalog label exactly; backend_id is optional and must be an exact backend UUID from manage_backends. " +
      "Without filters the entire catalog is returned (hundreds of widgets) — prefer a filter when you know the source. " +
      "Generative-only note widgets like rich_note are excluded; use add_generative_widget for those.",
    inputSchema: listAvailableWidgetsInputSchema,
  },
  {
    name: "get_widget_schema",
    description:
      "Fetch the exact schema for one available widget. " +
      "Returns deterministic params and UI inputs to use in subsequent create_widget / update_widget calls. " +
      "Requires origin and widget_id from list_available_widgets — caller must select before calling.",
    inputSchema: getWidgetSchemaInputSchema,
  },
  {
    name: "get_params_options",
    description:
      "Fetch parameter options for one or more widget input queries. " +
      "Use only after get_widget_schema marks a param with requires_options_lookup=true.",
    inputSchema: getParamsOptionsInputSchema,
  },
  {
    name: "read_widget",
    description:
      "Read one widget from the active dashboard. " +
      "widget_uuid is the canonical instance identifier; widget_id is a fallback when only the type is known.",
    inputSchema: readWidgetInputSchema,
  },
  {
    name: "add_widget_to_dashboard",
    description:
      "Create one widget on a target dashboard. Requires origin and widget_id. " +
      "Omit dashboard_id for the current dashboard. " +
      "Creates on the current tab; navigate_workspace to the desired tab first for tab-scoped placement. " +
      "Use list_available_widgets and get_widget_schema when you need catalog identities or config params. " +
      "Do not use this for rich_note; use add_generative_widget with widget_type='note'.",
    inputSchema: createWidgetInputSchema,
  },
  {
    name: "update_widget_in_dashboard",
    description:
      "Update one widget's config on a target dashboard. " +
      "Handles 'update/set/change <param> to <value>' requests; the user may name a target widget by display name. " +
      "Call only after identifying the target widget instances and confirming they expose the parameter being changed. " +
      "Do not guess enum/dropdown values; call get_widget_schema and get_params_options when needed, then pass option values, not labels. " +
      "For plain string values, preserve the user's literal casing unless schema/options require otherwise. " +
      "Layout fields (x/y/w/h/grid_data/inner_tab/etc.) are rejected — use update_dashboard_layout for those.",
    inputSchema: updateWidgetInputSchema,
  },
  {
    name: "delete_widget",
    description:
      "Delete a FINOS Workspace widget from a dashboard. " +
      "Provide widget_uuid (preferred) or widget_id. dashboard_id defaults to the current route.",
    inputSchema: deleteWidgetInputSchema,
  },
  {
    name: "manage_dashboard",
    description:
      "Create, read, or update one FINOS Workspace dashboard. " +
      "create requires name. read uses current route if dashboard_id omitted. update requires dashboard_id and name.",
    inputSchema: manageDashboardInputSchema,
  },
  {
    name: "update_dashboard_layout",
    description:
      "Move or resize one widget on the active dashboard. " +
      "Requires x/y/w/h grid coordinates. Optional min_w/min_h/max_w/max_h size constraints.",
    inputSchema: updateDashboardLayoutInputSchema,
  },
  {
    name: "manage_navigation_bar",
    description:
      "Create or mutate the FINOS Workspace navigation bar (tabs). " +
      "create / add_tabs / remove_tabs use tabs:[{name}]. rename_tabs uses rename_map:{oldId:newName}. " +
      "tab_id is generated as the slug of name; navigate to that slug after add_tabs before placing content.",
    inputSchema: manageNavigationBarInputSchema,
  },
  {
    name: "add_generative_widget",
    description:
      "Create a generative widget (note or html) with inline content on a dashboard. " +
      "The FINOS Workspace has no table or chart widget: draw a table or chart as an html widget " +
      "(follow the `html-table` / `html-chart` skills).",
    inputSchema: addGenerativeWidgetInputSchema,
  },
  {
    name: "assign_tasks_to_agents",
    description:
      "Assign tasks to configured external FINOS Workspace agents. " +
      "task_requests items shaped like {id, description, assigned_holder_url, assigned_agent_id}.",
    inputSchema: assignTasksToAgentsInputSchema,
  },
  {
    name: "navigate_workspace",
    description:
      "Navigate the FINOS Workspace browser to an existing dashboard or inner tab. " +
      "operation='dashboard' requires dashboard_id; operation='tab' requires tab_id.",
    inputSchema: navigateWorkspaceInputSchema,
  },
  {
    name: "manage_backends",
    description:
      "Manage FINOS Workspace data backends (the connections that power widgets). " +
      "list / add / update / refresh / remove. add requires name and url. update/refresh/remove require backend_id.",
    inputSchema: manageBackendsInputSchema,
  },
  {
    name: "manage_apps",
    description:
      "List, read, or instantiate apps from a FINOS Workspace data backend. Requires backend_id. " +
      "read/instantiate require app_name or template_id. instantiate creates a fresh dashboard from the app template.",
    inputSchema: manageAppsInputSchema,
  },
] as const;

export const WORKSPACE_BRIDGE_COMMAND_NAMES: ReadonlySet<string> = new Set(
  WORKSPACE_BRIDGE_COMMANDS.map((c) => c.name),
);

export const BRIDGE_MOUNT_EXTRA_NAMES: ReadonlySet<string> = new Set([
  "update_widget_layout",
  "update_widget",
  "create_widget",
  "get_widget_data",
  "get_skill_content",
]);

export function isWorkspaceBridgeCommand(name: string): boolean {
  return WORKSPACE_BRIDGE_COMMAND_NAMES.has(name);
}
