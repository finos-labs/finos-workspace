import { z } from "zod";
import type {
  BundleName,
  EntityBody,
  EntityEntitlement,
  EntityTier,
  ShareWidgets,
} from "~/api/entities.api";
import type { Entity } from "~/types/entity.type";

export const TIER_OPTIONS: { value: EntityTier; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "basic", label: "Basic" },
];

export const SHARE_WIDGETS_OPTIONS: { value: ShareWidgets; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
];

export const BUNDLE_OPTIONS: { value: BundleName; label: string }[] = [
  { value: "Default", label: "Default" },
  { value: "Equity Research", label: "Equity Research" },
  { value: "On-Premise", label: "On-Premise" },
];

const MAX_SEATS = 10000;

const required = z.string().trim().min(1, "This field is required");
const wholeNumber = z.string().trim().regex(/^\d+$/, "Enter a whole number");

/*
 * Number fields are kept as the text that was typed: the inputs hand back text, and
 * `entityBody` / `entitlementBody` turn it into numbers once it has been validated.
 */
export const entityFormSchema = z.object({
  name: required,
  entityTypeUuid: z.uuid("Choose an entity type"),
  email: z.email("Invalid email address"),
  companyType: required,
  organizationSize: required,
  aum: wholeNumber,
  country: required,
  seats: wholeNumber.refine((value) => Number(value) <= MAX_SEATS, {
    message: `At most ${MAX_SEATS} seats`,
  }),
  expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD"),
});

/** A new entity also names its first administrator. */
export const newEntityFormSchema = entityFormSchema.extend({
  adminFirstName: required,
  adminLastName: required,
  adminEmail: z.email("Invalid email address"),
});

export type EntityFormValues = z.infer<typeof entityFormSchema>;
export type NewEntityFormValues = z.infer<typeof newEntityFormSchema>;

export const entitlementFormSchema = z.object({
  tier: z.enum(["full", "basic"]),
  number_copilot_calls_day: wholeNumber,
  // empty: no limit
  number_copilot_tokens_day: z
    .string()
    .trim()
    .regex(/^\d*$/, "Enter a whole number, or leave it empty for no limit"),
  total_file_upload_size_gb: wholeNumber,
  share_widgets: z.enum(["public", "private"]),
  bring_your_own_data: z.boolean(),
  bring_your_own_copilot: z.boolean(),
  admin_access: z.boolean(),
  support: z.boolean(),
  data_add_ons_redistribution: z.boolean(),
  allow_custom_backends: z.boolean(),
  search_web: z.boolean(),
  fetch_from_web: z.boolean(),
  bundle_name: z.enum(["Default", "Equity Research", "On-Premise"]),
});

export type EntitlementFormValues = z.infer<typeof entitlementFormSchema>;

function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** A year from `today`, which is what a new entity runs for unless told otherwise. */
export function oneYearFrom(today: Date): string {
  const date = new Date(today);
  date.setFullYear(date.getFullYear() + 1);
  return formatDate(date);
}

export function entityFormDefaults(
  entity: Entity | undefined,
  today = new Date(),
): EntityFormValues {
  return {
    name: entity?.name ?? "",
    entityTypeUuid: entity?.entity_type.uuid ?? "",
    email: entity?.email ?? "",
    companyType: entity?.company_type ?? "",
    organizationSize: entity?.organization_size ?? "",
    aum: String(entity?.aum ?? 0),
    country: entity?.country ?? "",
    seats: String(entity?.seats ?? 1),
    expirationDate: entity?.expiration_date
      ? formatDate(new Date(entity.expiration_date))
      : oneYearFrom(today),
  };
}

export function newEntityFormDefaults(today = new Date()): NewEntityFormValues {
  return {
    ...entityFormDefaults(undefined, today),
    adminFirstName: "",
    adminLastName: "",
    adminEmail: "",
  };
}

/** Editing an entity changes its fields and its entitlements in one go. */
export const editEntityFormSchema = entityFormSchema.extend(
  entitlementFormSchema.shape,
);

export type EditEntityFormValues = z.infer<typeof editEntityFormSchema>;

export function entityBody(values: EntityFormValues): EntityBody {
  return {
    name: values.name,
    entity_code: values.entityTypeUuid,
    email: values.email,
    company_type: values.companyType,
    organization_size: values.organizationSize,
    aum: Number(values.aum),
    country: values.country,
    seats: Number(values.seats),
    expiration_date: values.expirationDate,
  };
}

/** The entitlements as the form holds them; what the entity has not been given reads as off (the web tools and custom backends: as on). */
export function entitlementFormDefaults(
  entitlement: EntityEntitlement | undefined,
): EntitlementFormValues {
  return {
    tier: entitlement?.tier ?? "full",
    number_copilot_calls_day: String(entitlement?.number_copilot_calls_day ?? 0),
    number_copilot_tokens_day: String(entitlement?.number_copilot_tokens_day ?? ""),
    total_file_upload_size_gb: String(entitlement?.total_file_upload_size_gb ?? 0),
    share_widgets: entitlement?.share_widgets ?? "private",
    bring_your_own_data: entitlement?.bring_your_own_data ?? false,
    bring_your_own_copilot: entitlement?.bring_your_own_copilot ?? false,
    admin_access: entitlement?.admin_access ?? false,
    support: entitlement?.support ?? false,
    data_add_ons_redistribution: entitlement?.data_add_ons_redistribution ?? false,
    allow_custom_backends: entitlement?.allow_custom_backends ?? true,
    search_web: entitlement?.search_web ?? true,
    fetch_from_web: entitlement?.fetch_from_web ?? true,
    bundle_name: entitlement?.bundle_name ?? "Default",
  };
}

/**
 * The entitlement request takes exactly the entitlement fields. `values` may be a form that
 * holds more (the entity's own fields), which must not be sent along.
 */
export function entitlementBody(values: EntitlementFormValues): EntityEntitlement {
  return {
    tier: values.tier,
    share_widgets: values.share_widgets,
    bundle_name: values.bundle_name,
    bring_your_own_data: values.bring_your_own_data,
    bring_your_own_copilot: values.bring_your_own_copilot,
    admin_access: values.admin_access,
    support: values.support,
    data_add_ons_redistribution: values.data_add_ons_redistribution,
    allow_custom_backends: values.allow_custom_backends,
    search_web: values.search_web,
    fetch_from_web: values.fetch_from_web,
    number_copilot_calls_day: Number(values.number_copilot_calls_day),
    number_copilot_tokens_day:
      values.number_copilot_tokens_day === ""
        ? null
        : Number(values.number_copilot_tokens_day),
    total_file_upload_size_gb: Number(values.total_file_upload_size_gb),
  };
}
