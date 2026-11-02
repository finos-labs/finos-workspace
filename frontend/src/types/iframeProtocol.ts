import { z } from "zod";

const WorkspaceWidgetManifestSchema = z.object({
  widgetId: z.string().describe("The id that the page gives the widget"),
  name: z.string().describe("The name that the Agent and the dashboard show"),
  description: z.string().optional().describe("What the widget shows"),
  category: z
    .string()
    .optional()
    .describe("The group that the catalog lists the widget under"),
  dataType: z
    .enum(["table", "markdown"])
    .describe("The kind of data that the widget answers with"),
});

const WorkspaceParamDefSchema = z.object({
  paramName: z.string().describe("The name of the parameter"),
  label: z.string().optional().describe("The label of the control"),
  type: z.enum(["text", "number", "date", "boolean"]).describe("The kind of control"),
  description: z.string().optional().describe("Help shown on hover"),
  value: z.string().optional().describe("The default value, as a string"),
  options: z
    .array(
      z.object({
        label: z.string().describe("The name that the choice shows"),
        value: z.string().describe("The value of the choice"),
      }),
    )
    .optional()
    .describe("The choices of a dropdown"),
  min: z.number().optional().describe("The lowest value of a number"),
  max: z.number().optional().describe("The highest value of a number"),
  step: z.number().optional().describe("The step of a number"),
});

export const WorkspaceConnectMessageSchema = z.object({
  type: z.literal("workspace-connect"),
  widgets: z
    .array(WorkspaceWidgetManifestSchema)
    .describe("The widgets that the page can supply"),
  params: z
    .array(WorkspaceParamDefSchema)
    .optional()
    .describe("The parameters that the page understands"),
});

export const WorkspaceDataMessageSchema = z.object({
  type: z.literal("workspace-data"),
  widgetId: z.string().describe("The id of the widget that the data belongs to"),
  dataType: z
    .enum(["table", "markdown"])
    .describe("The kind of data: `table` or `markdown`"),
  data: z
    .union([z.array(z.record(z.string(), z.unknown())), z.string()])
    .describe("For `table`, an array of row objects. For `markdown`, a string"),
  columns: z
    .array(z.string())
    .optional()
    .describe("The names of the columns of a table"),
});

export const WorkspaceErrorMessageSchema = z.object({
  type: z.literal("workspace-error"),
  widgetId: z.string().describe("The id of the widget that cannot answer"),
  error: z.string().describe("The message that the request fails with"),
});

const WorkspaceWidgetParamPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const WorkspaceWidgetParamValueSchema = z.union([
  WorkspaceWidgetParamPrimitiveSchema,
  z.array(WorkspaceWidgetParamPrimitiveSchema),
]);

export const WIDGET_PARAM_MESSAGE_TYPES = [
  "workspace:widget-params:update",
  "workspace:params:update",
] as const;

type WidgetParamMessageType = (typeof WIDGET_PARAM_MESSAGE_TYPES)[number];

export const WorkspaceWidgetParamsUpdateMessageSchema = z.object({
  type: z.enum(WIDGET_PARAM_MESSAGE_TYPES),
  params: z
    .record(z.string(), WorkspaceWidgetParamValueSchema)
    .optional()
    .describe("The new values, by parameter name"),
  paramName: z
    .string()
    .optional()
    .describe("The name of one parameter, together with `value`"),
  value: WorkspaceWidgetParamValueSchema.optional().describe(
    "The new value of the parameter that `paramName` names",
  ),
});

export const WorkspaceRequestMessageSchema = z.object({
  type: z.literal("workspace-request"),
  widgetId: z
    .string()
    .nullable()
    .describe("The id of the widget whose data the page should send"),
});

export const WorkspaceParamsUpdateMessageSchema = z.object({
  type: z.literal("workspace-params-update"),
  params: z
    .record(z.string(), z.string())
    .describe(
      "Every current parameter value, including `theme`, which is `light` or `dark`",
    ),
});

export const WorkspaceAuthMessageSchema = z.object({
  type: z.literal("workspace-auth"),
  headers: z
    .record(z.string(), z.string())
    .describe(
      "The headers that FINOS Workspace passes to the page, by header name. The only one is `X-Workspace-User`, the signed-in user's email address",
    ),
});

export interface IframeMessageDoc {
  direction: "page" | "host";
  schema: z.ZodType;
  meaning: string;
}

export const IFRAME_MESSAGES: IframeMessageDoc[] = [
  {
    direction: "page",
    schema: WorkspaceConnectMessageSchema,
    meaning:
      "The page announces the widgets that it supplies and the parameters that it understands",
  },
  {
    direction: "page",
    schema: WorkspaceDataMessageSchema,
    meaning: "The page answers a `workspace-request`",
  },
  {
    direction: "page",
    schema: WorkspaceErrorMessageSchema,
    meaning:
      "The page cannot answer a `workspace-request`, and the request fails with the message",
  },
  {
    direction: "page",
    schema: WorkspaceWidgetParamsUpdateMessageSchema,
    meaning:
      "The page changes parameter values. A message that has both `params` and `paramName` applies both",
  },
  {
    direction: "host",
    schema: WorkspaceRequestMessageSchema,
    meaning:
      "FINOS Workspace asks the page for the data of one widget, and the page should answer with `workspace-data` or `workspace-error`",
  },
  {
    direction: "host",
    schema: WorkspaceParamsUpdateMessageSchema,
    meaning:
      "A parameter value changed, so the page should update what it shows. FINOS Workspace also sends the message after the handshake, when the user changes a control, when a parameter that the widget shares in a group changes, and when the site's theme changes",
  },
  {
    direction: "host",
    schema: WorkspaceAuthMessageSchema,
    meaning:
      "The signed-in user's email address, in the header `X-Workspace-User`, which the page can attach to its own requests. FINOS Workspace sends it once after each `workspace-connect`, only when the deployment turns on `AUTHENTICATION_SEND_USER_EMAIL_AS_HEADER`, and only to a window whose origin equals the origin of the iframe's address",
  },
];

export type WorkspaceWidgetManifest = z.infer<typeof WorkspaceWidgetManifestSchema>;
export type WorkspaceParamDef = z.infer<typeof WorkspaceParamDefSchema>;

export type WorkspaceDataMessage = z.infer<typeof WorkspaceDataMessageSchema>;

export type WorkspaceWidgetParamValue = z.infer<typeof WorkspaceWidgetParamValueSchema>;

export type WorkspaceParamsUpdateMessage = z.infer<
  typeof WorkspaceParamsUpdateMessageSchema
>;

export type WorkspaceAuthMessage = z.infer<typeof WorkspaceAuthMessageSchema>;

export type WorkspaceRequestMessage = z.infer<typeof WorkspaceRequestMessageSchema>;

export function isWidgetParamMessageType(
  value: unknown,
): value is WidgetParamMessageType {
  return (
    typeof value === "string" &&
    (WIDGET_PARAM_MESSAGE_TYPES as readonly string[]).includes(value)
  );
}

export function parseIframeParamsMessage(
  data: unknown,
): Record<string, WorkspaceWidgetParamValue> | null {
  if (!data || typeof data !== "object") return null;
  if (!isWidgetParamMessageType((data as { type?: unknown }).type)) return null;

  const parsed = WorkspaceWidgetParamsUpdateMessageSchema.safeParse(data);
  if (!parsed.success) {
    console.warn(
      "[iframe-protocol] invalid widget params update message.",
      parsed.error.issues,
    );
    return null;
  }

  const result: Record<string, WorkspaceWidgetParamValue> = {};
  const msg = parsed.data;

  if (msg.params) {
    for (const [paramName, value] of Object.entries(msg.params)) {
      result[paramName] = value;
    }
  }

  if (msg.paramName) {
    result[msg.paramName] = msg.value ?? null;
  }

  return result;
}

export function stringifyParamValue(
  value: WorkspaceWidgetParamValue | undefined,
): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== null)
      .map((item) => String(item))
      .join(",");
  }
  return String(value);
}
