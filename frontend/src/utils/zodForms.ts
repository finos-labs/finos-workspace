import { z } from "zod";
import type { ParamDef } from "~/components/types";
import type { WidgetVizType } from "~/lib/types/app";
import type { WidgetBaseContractT } from "~/lib/types/widgetsContract";

const passwordRegex = /^(?=\S*[a-z])(?=\S*[A-Z])(?=\S*\d)(?=\S*[^\w\s])\S{8,}$/;
export const invalidPassword =
  "Password: min. 8 characters, including a number, uppercase, lowercase, and special character. Spaces are forbidden.";

export const zodPassword = z
  .string()
  .min(1, "This field is required")
  .regex(passwordRegex, invalidPassword);

export const zodEmail = z.email("Invalid email").min(1, "This field is required");

export const MetadataSchema = z.object({
  category: z.string().optional(),
  sub_category: z.string().optional(),
  subCategory: z.string().optional(),
  description: z.string().optional(),
});

export const totpSchema = z.object({
  totp: z
    .string()
    .length(6, "This field must be six characters")
    .regex(/^[0-9]{6}$/, { message: "Invalid code" }),
});

export type totpForm = z.infer<typeof totpSchema>;

function isAllowedIframeUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;

    return ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export const urlSchema = z.object({
  url: z
    .string()
    .transform((url) => {
      if (!/^https?:\/\//i.test(url)) {
        return `https://${url}`;
      }
      return url;
    })
    .refine(isAllowedIframeUrl, {
      message: "URL must start with https:// or local http://",
    })
    .refine(
      (url) => {
        try {
          new URL(url);
          return true;
        } catch {
          return false;
        }
      },
      {
        message: "Invalid URL",
      },
    ),
});

export type urlForm = z.infer<typeof urlSchema>;

export const resetSchema = z
  .object({
    password: zodPassword,
    confirm: zodPassword,
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

export type resetForm = z.infer<typeof resetSchema>;

export type WidgetType = Omit<WidgetBaseContractT, "params"> & {
  type: WidgetVizType;
  params?: ParamDef[];
  data?: { dataKey?: string; rawDataKey?: string; rawType?: string } & Record<
    string,
    unknown
  >;
  raw?: boolean;
  storage?: { mcpUrl?: string };
};
export type WidgetsType = {
  [key: string]: WidgetType & {
    widgetId?: string;
    disabled?: boolean;
    endpointHeaders?:
      | { key: string; value: string; location?: "headers" | "query" }[]
      | null;
  };
};

export interface UnrecognizedKeysEntry {
  name: string;
  keys: string[];
}

export interface UnrecognizedKeysReport {
  label: string;
  entries: UnrecognizedKeysEntry[];
}

export function detectUnrecognizedKeys(
  label: string,
  entries: unknown[],
  knownKeys: Set<string>,
): UnrecognizedKeysReport | null {
  const found: UnrecognizedKeysEntry[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const extraKeys = Object.keys(obj).filter((k) => !knownKeys.has(k));
    if (extraKeys.length > 0) {
      found.push({
        name: String(obj.name || obj.id || "Unknown"),
        keys: extraKeys,
      });
    }
  }

  return found.length > 0 ? { label, entries: found } : null;
}

export function formatUnrecognizedKeysAsText(
  reports: UnrecognizedKeysReport[],
): string {
  return reports
    .map((r) => {
      const lines = r.entries.map((e) => `• ${e.name}: ${e.keys.join(", ")}`);
      return `${r.label}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}
