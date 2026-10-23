import { z } from "zod";

export const WorkspaceWidgetManifestSchema = z.object({
  widgetId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  dataType: z.enum(["table", "markdown"]),
});

export const WorkspaceParamDefSchema = z.object({
  paramName: z.string(),
  label: z.string().optional(),
  type: z.enum(["text", "number", "date", "boolean"]),
  description: z.string().optional(),
  value: z.string().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
});

export const WorkspaceConnectMessageSchema = z.object({
  type: z.literal("workspace-connect"),
  widgets: z.array(WorkspaceWidgetManifestSchema),
  params: z.array(WorkspaceParamDefSchema).optional(),
});

export const WorkspaceDataMessageSchema = z.object({
  type: z.literal("workspace-data"),
  widgetId: z.string(),
  dataType: z.enum(["table", "markdown"]),
  data: z.union([z.array(z.record(z.string(), z.unknown())), z.string()]),
  columns: z.array(z.string()).optional(),
});

export const WorkspaceErrorMessageSchema = z.object({
  type: z.literal("workspace-error"),
  widgetId: z.string(),
  error: z.string(),
});

const WorkspaceWidgetParamPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const WorkspaceWidgetParamValueSchema = z.union([
  WorkspaceWidgetParamPrimitiveSchema,
  z.array(WorkspaceWidgetParamPrimitiveSchema),
]);

export const WIDGET_PARAM_MESSAGE_TYPES = [
  "workspace:widget-params:update",
  "workspace:params:update",
] as const;

export type WidgetParamMessageType = (typeof WIDGET_PARAM_MESSAGE_TYPES)[number];

export const WorkspaceWidgetParamsUpdateMessageSchema = z.object({
  type: z.enum(WIDGET_PARAM_MESSAGE_TYPES),
  params: z.record(z.string(), WorkspaceWidgetParamValueSchema).optional(),
  paramName: z.string().optional(),
  value: WorkspaceWidgetParamValueSchema.optional(),
});

export type WorkspaceWidgetManifest = z.infer<typeof WorkspaceWidgetManifestSchema>;
export type WorkspaceParamDef = z.infer<typeof WorkspaceParamDefSchema>;
export type WorkspaceConnectMessage = z.infer<typeof WorkspaceConnectMessageSchema>;
export type WorkspaceDataMessage = z.infer<typeof WorkspaceDataMessageSchema>;
export type WorkspaceErrorMessage = z.infer<typeof WorkspaceErrorMessageSchema>;
export type WorkspaceWidgetParamValue = z.infer<typeof WorkspaceWidgetParamValueSchema>;
export type WorkspaceWidgetParamsUpdateMessage = z.infer<
  typeof WorkspaceWidgetParamsUpdateMessageSchema
>;

export interface WorkspaceParamsUpdateMessage {
  type: "workspace-params-update";
  params: Record<string, string>;
}

export interface WorkspaceAuthMessage {
  type: "workspace-auth";
  headers: Record<string, string>;
}

export interface WorkspaceRequestMessage {
  type: "workspace-request";
  widgetId: string | null;
}

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
