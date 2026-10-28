import { z } from "zod";

export const BridgeErrorCode = z.enum([
  "invalid_request",
  "unauthorized",
  "unavailable",
  "timeout",
  "command_failed",
  "unknown",
]);
export type BridgeErrorCode = z.infer<typeof BridgeErrorCode>;

export const BridgeErrorSchema = z.object({
  code: BridgeErrorCode,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
  retryable: z.boolean().default(false),
});
export type BridgeError = z.infer<typeof BridgeErrorSchema>;

export const BrowserSessionStartRequestSchema = z.object({
  client_name: z.string().default("workspace-ui"),
  current_dashboard_id: z.string().nullable().optional(),
  current_tab_id: z.string().nullable().optional(),
});
export type BrowserSessionStartRequest = z.infer<
  typeof BrowserSessionStartRequestSchema
>;

export const BrowserSessionContextSchema = z.object({
  current_dashboard_id: z.string().nullable().optional(),
  current_tab_id: z.string().nullable().optional(),
});
export type BrowserSessionContext = z.infer<typeof BrowserSessionContextSchema>;

export const BrowserSessionSchema = z.object({
  session_id: z.string(),
  token: z.string(),
  client_name: z.string(),
  current_dashboard_id: z.string().nullable().optional(),
  current_tab_id: z.string().nullable().optional(),
});
export type BrowserSession = z.infer<typeof BrowserSessionSchema>;

export const BrowserSessionStartResponseSchema = z.object({
  session: BrowserSessionSchema,
  websocket_url: z.string(),
});
export type BrowserSessionStartResponse = z.infer<
  typeof BrowserSessionStartResponseSchema
>;

export const BrowserPingSchema = z.object({
  type: z.literal("ping"),
});

export const BrowserCommandResultMessageSchema = z.object({
  type: z.literal("command_result"),
  result: z.unknown(),
});

export const BrowserSessionContextChangedMessageSchema = z.object({
  type: z.literal("session_context_changed"),
  session: BrowserSessionContextSchema,
});

export const BrowserMessageSchema = z.discriminatedUnion("type", [
  BrowserPingSchema,
  BrowserCommandResultMessageSchema,
  BrowserSessionContextChangedMessageSchema,
]);
export type BrowserMessage = z.infer<typeof BrowserMessageSchema>;

export const SessionReadyEventSchema = z.object({
  type: z.literal("session_ready"),
  session: BrowserSessionSchema,
});

export const CommandRequestEventSchema = z.object({
  type: z.literal("command_request"),
  command: z.unknown(),
});

export const ErrorEventSchema = z.object({
  type: z.literal("error"),
  error: BridgeErrorSchema,
});

export const ServerEventSchema = z.discriminatedUnion("type", [
  SessionReadyEventSchema,
  CommandRequestEventSchema,
  ErrorEventSchema,
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
