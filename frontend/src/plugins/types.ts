import { z } from "zod";

/**
 * What `GET /app/widget-plugins` returns: the plugins this user may use, with their
 * widgets, effective permissions and effective CSP (docs/widget-plugins/DESIGN.md 7.1).
 * The server decides availability; the SPA only reads this.
 */

export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
export const VIZ_TYPE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;
const DIGEST_PATTERN = /^sha256-[A-Za-z0-9_-]{43}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export const PERMISSIONS = [
  "core:default",
  "core:data:read",
  "core:params:write",
  "core:state:write",
  "core:copilot:context",
  "core:export:provide",
  "core:ui:notify",
  "core:ui:open-link",
  "core:clipboard:write",
  "core:download:save",
  "core:proxy:call",
  "core:backend:call",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const TraitBindingSchema = z.object({
  bind: z.string().max(80),
  access: z.enum(["read", "readwrite"]).default("read"),
});

const SettingsPropertySchema = z.looseObject({
  type: z.enum(["string", "number", "integer", "boolean"]).optional(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  maxLength: z.number().optional(),
});

export const SettingsSchemaSchema = z.object({
  type: z.literal("object").optional(),
  properties: z.record(z.string(), SettingsPropertySchema).default({}),
  required: z.array(z.string()).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
});
export type SettingsSchema = z.infer<typeof SettingsSchemaSchema>;

const HandleSchema = z.object({
  type: z.string().regex(VIZ_TYPE_PATTERN),
  definition: z.record(z.string(), z.unknown()).nullish(),
  response: z
    .object({
      accepts: z.literal("json").default("json"),
      description: z.string().default(""),
      schema: z.record(z.string(), z.unknown()).nullish(),
    })
    .default({ accepts: "json", description: "" }),
});

export const PluginWidgetSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/),
  name: z.string(),
  description: z.string().default(""),
  category: z.string().nullish(),
  subCategory: z.string().nullish(),
  handles: z.array(HandleSchema).default([]),
  standalone: z.boolean().default(false),
  permissions: z.array(z.enum(PERMISSIONS)),
  /** The proxies the widget may call, when it has `core:proxy:call` (SERVER-SIDE.md 3). */
  proxies: z.array(z.string()).default([]),
  /** The backend routes the widget may call, when it has `core:backend:call` (SERVER-SIDE.md 5). */
  routes: z.array(z.string()).default([]),
  model: z
    .object({ traits: z.record(z.string(), TraitBindingSchema).default({}) })
    .nullish(),
  params: z.array(z.record(z.string(), z.unknown())).default([]),
  settings: z
    .object({
      schema: SettingsSchemaSchema.default({ properties: {} }),
      defaults: z.record(z.string(), z.unknown()).default({}),
    })
    .nullish(),
  grid: z
    .object({
      w: z.number(),
      h: z.number(),
      minW: z.number().nullish(),
      minH: z.number().nullish(),
    })
    .default({ w: 20, h: 12 }),
});
export type PluginWidgetDef = z.infer<typeof PluginWidgetSchema>;

const FileInfoSchema = z.object({
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(SHA256_HEX),
});

export const AvailablePluginSchema = z.object({
  id: z.string().regex(PLUGIN_ID_PATTERN),
  version: z.string(),
  name: z.string(),
  description: z.string().default(""),
  publisher: z.object({ name: z.string(), url: z.string().nullish() }).nullish(),
  digest: z.string().regex(DIGEST_PATTERN),
  entry: z.object({
    module: z.string(),
    styles: z.array(z.string()).default([]),
  }),
  files: z.record(z.string(), FileInfoSchema),
  csp: z.record(z.string(), z.array(z.string())),
  adminSettings: z.record(z.string(), z.unknown()).default({}),
  widgets: z.array(PluginWidgetSchema),
});
export type AvailablePlugin = z.infer<typeof AvailablePluginSchema>;

export const PluginListingSchema = z.object({
  enabled: z.boolean(),
  etag: z.string(),
  plugins: z.array(AvailablePluginSchema),
  vizHandlers: z
    .record(z.string(), z.object({ plugin: z.string(), widget: z.string() }))
    .default({}),
});
export type PluginListing = z.infer<typeof PluginListingSchema>;

/** A plugin widget as the host resolves it for one dashboard widget. */
export interface ResolvedPluginWidget {
  plugin: AvailablePlugin;
  widget: PluginWidgetDef;
  /** The viz type a backend widget declared, when the plugin renders one. */
  vizType?: string;
}

/** What a dashboard keeps for a plugin widget, in `storage.plugin`. */
export interface PluginInstanceStorage {
  state?: unknown;
  config?: Record<string, unknown>;
}

export const MAX_STATE_BYTES = 64 * 1024;
export const MAX_CONFIG_BYTES = 32 * 1024;
