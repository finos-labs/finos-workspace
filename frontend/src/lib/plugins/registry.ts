import { z } from "zod";

/**
 * Workspace's view of the BQ plugin registry (registry/plugins.json in the
 * bq-workspace-plugins repository): the zod schema for each plugin entry and its
 * settings, plus parsing and fetching. The registry holds trusted metadata and
 * routes only: never code, never full URLs.
 */

export const PLUGIN_STATUSES = ["active", "inactive", "deprecated"] as const;

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const PLUGIN_SETTING_TYPES = ["text", "url", "select"] as const;
/** Query parameters the plugin host itself reads; settings may not reuse them. */
export const RESERVED_SETTING_KEYS = ["theme"] as const;
const MAX_SETTINGS = 20;

const text = z.string().trim().min(1).max(500);

const PluginSettingOptionSchema = z.object({ value: text, label: text });

/**
 * A value the user sets per plugin instance (e.g. per dashboard widget). It is
 * passed to the plugin as the query parameter `key`; the plugin validates it.
 */
export const PluginSettingSchema = z
  .object({
    // camelCase, so a key is a plain query parameter name.
    key: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]*$/, "key must be camelCase")
      .refine(
        (key) => !(RESERVED_SETTING_KEYS as readonly string[]).includes(key),
        "key is reserved",
      ),
    label: text,
    type: z.enum(PLUGIN_SETTING_TYPES),
    description: z.string().trim().max(500).optional(),
    options: z.array(PluginSettingOptionSchema).min(1).optional(),
  })
  .superRefine((setting, ctx) => {
    if (setting.type === "select" && !setting.options) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: 'options are required for "select"',
      });
    }
    if (setting.type !== "select" && setting.options) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: 'options are only allowed for "select"',
      });
    }
    const values = setting.options?.map((option) => option.value) ?? [];
    if (new Set(values).size !== values.length) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "option values must be unique",
      });
    }
  });

const MAX_NETWORK_ORIGINS = 20;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** An origin only ("https://api.example.com"): https, or http on this machine. */
function isRequestableOrigin(value: string) {
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && LOCAL_HOSTNAMES.has(url.hostname)))
    );
  } catch {
    return false;
  }
}

/**
 * What a plugin asks to be allowed to do, shown to the administrator before they
 * enable it. A declaration, not a guarantee: Workspace does not judge or enforce it yet.
 */
export const PluginRequestsSchema = z.object({
  /** Origins the plugin calls from its frame (e.g. its data API). */
  network: z
    .array(
      z
        .string()
        .refine(
          isRequestableOrigin,
          "network entries must be origins (https, or http on localhost)",
        ),
    )
    .max(MAX_NETWORK_ORIGINS)
    .refine((origins) => new Set(origins).size === origins.length, {
      message: "network origins must be unique",
    })
    .default([]),
  /** Browser storage (localStorage, cookies) on the plugin's own origin. */
  storage: z.boolean().default(false),
  /** Saving files, e.g. a CSV export. */
  downloads: z.boolean().default(false),
  /** Opening new windows or tabs. */
  popups: z.boolean().default(false),
});

export const PluginMetadataSchema = z.object({
  id: z.string().regex(slug, "id must be lowercase kebab-case"),
  name: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(500),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "version must be semver"),
  category: z.string().trim().min(1).max(500),
  // One path segment under /plugins: no other origin, query, fragment or "..".
  route: z
    .string()
    .regex(/^\/plugins\/[a-z0-9]+(?:-[a-z0-9]+)*$/, 'route must be "/plugins/<slug>"'),
  status: z.enum(PLUGIN_STATUSES),
  /** Settings the plugin declares. Parsed so the registry format stays valid; Workspace does not collect them. */
  settings: z
    .array(PluginSettingSchema)
    .max(MAX_SETTINGS)
    .refine(
      (settings) => new Set(settings.map((s) => s.key)).size === settings.length,
      "setting keys must be unique",
    )
    .optional(),
  /** What the plugin asks for. Absent means the plugin has not declared it. */
  requests: PluginRequestsSchema.optional(),
});

export type PluginMetadata = z.infer<typeof PluginMetadataSchema>;
export type PluginSetting = z.infer<typeof PluginSettingSchema>;
export type PluginRequests = z.infer<typeof PluginRequestsSchema>;
export type PluginStatus = PluginMetadata["status"];

export type PluginRegistryErrorKind = "network" | "http" | "format";

export class PluginRegistryError extends Error {
  constructor(
    message: string,
    readonly kind: PluginRegistryErrorKind,
  ) {
    super(message);
    this.name = "PluginRegistryError";
  }
}

export interface ParsedRegistry {
  plugins: PluginMetadata[];
  /** Entries that were skipped. Valid entries are still returned. */
  errors: string[];
}

/**
 * Parses a registry document. A document that is not an array is rejected;
 * invalid or duplicate entries are skipped so one bad entry cannot hide the rest.
 */
export function parseRegistry(document: unknown): ParsedRegistry {
  if (!Array.isArray(document)) {
    throw new PluginRegistryError(
      "The plugin registry must be a JSON array.",
      "format",
    );
  }

  const plugins: PluginMetadata[] = [];
  const errors: string[] = [];
  const ids = new Set<string>();
  const routes = new Set<string>();

  document.forEach((entry, index) => {
    const result = PluginMetadataSchema.safeParse(entry);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => {
        const field = issue.path.join(".") || "entry";
        return `${field}: ${issue.message}`;
      });
      errors.push(`Entry ${index}: ${issues.join("; ")}`);
      return;
    }
    const plugin = result.data;
    if (ids.has(plugin.id) || routes.has(plugin.route)) {
      errors.push(
        `Entry ${index}: duplicate id or route ("${plugin.id}", "${plugin.route}")`,
      );
      return;
    }
    ids.add(plugin.id);
    routes.add(plugin.route);
    plugins.push(plugin);
  });

  return { plugins, errors };
}

/** Fetches and parses the registry the plugin host publishes. */
export async function fetchRegistry(
  registryUrl: string,
  options: { fetchFn?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ParsedRegistry> {
  const { fetchFn = fetch, signal } = options;

  let response: Response;
  try {
    response = await fetchFn(registryUrl, {
      headers: { Accept: "application/json" },
      // The registry is public metadata; never send Workspace cookies to the plugin host.
      credentials: "omit",
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new PluginRegistryError(
      `Could not reach the plugin host at ${new URL(registryUrl).origin}. Check that it is running and allows this origin (CORS).`,
      "network",
    );
  }

  if (!response.ok) {
    throw new PluginRegistryError(
      `The plugin registry returned ${response.status}.`,
      "http",
    );
  }

  let document: unknown;
  try {
    document = await response.json();
  } catch {
    throw new PluginRegistryError("The plugin registry is not valid JSON.", "format");
  }
  return parseRegistry(document);
}
