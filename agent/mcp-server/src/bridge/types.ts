import { z } from "zod";

const BridgeErrorCode = z.enum([
  "invalid_request",
  "unauthorized",
  "unavailable",
  "timeout",
  "command_failed",
  "unknown",
]);

export const BridgeErrorSchema = z.object({
  code: BridgeErrorCode,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
  retryable: z.boolean().default(false),
});

export const BrowserSessionStartRequestSchema = z.object({
  client_name: z.string().default("workspace-ui"),
  current_dashboard_id: z.string().nullable().optional(),
  current_tab_id: z.string().nullable().optional(),
});

const BrowserSessionContextSchema = z.object({
  current_dashboard_id: z.string().nullable().optional(),
  current_tab_id: z.string().nullable().optional(),
});
export type BrowserSessionContext = z.infer<typeof BrowserSessionContextSchema>;

const BrowserSessionSchema = z.object({
  session_id: z.string(),
  token: z.string(),
  client_name: z.string(),
  current_dashboard_id: z.string().nullable().optional(),
  current_tab_id: z.string().nullable().optional(),
});
export type BrowserSession = z.infer<typeof BrowserSessionSchema>;

const BrowserSessionStartResponseSchema = z.object({
  session: BrowserSessionSchema,
  websocket_url: z.string(),
});
export type BrowserSessionStartResponse = z.infer<
  typeof BrowserSessionStartResponseSchema
>;

const BrowserPingSchema = z.object({
  type: z.literal("ping"),
});

const BrowserCommandResultMessageSchema = z.object({
  type: z.literal("command_result"),
  result: z.unknown(),
});

const BrowserSessionContextChangedMessageSchema = z.object({
  type: z.literal("session_context_changed"),
  session: BrowserSessionContextSchema,
});

export const BrowserMessageSchema = z.discriminatedUnion("type", [
  BrowserPingSchema,
  BrowserCommandResultMessageSchema,
  BrowserSessionContextChangedMessageSchema,
]);
