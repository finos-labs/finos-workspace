import { z } from "zod";
import type { EntityBody } from "~/api/entities.api";
import type { Entity } from "~/types/entity.type";

const required = z.string().trim().min(1, "This field is required");
const wholeNumber = z.string().trim().regex(/^\d+$/, "Enter a whole number");

/*
 * Number fields are kept as the text that was typed: the inputs hand back text, and
 * `entityBody` turns it into numbers once it has been validated.
 */
export const entityFormSchema = z.object({
  name: required,
  entityTypeUuid: z.uuid("Choose an entity type"),
  email: z.email("Invalid email address"),
  companyType: required,
  organizationSize: required,
  aum: wholeNumber,
  country: required,
  sharingEnabled: z.boolean(),
});

/** A new entity also names its first administrator. */
export const newEntityFormSchema = entityFormSchema.extend({
  adminFirstName: required,
  adminLastName: required,
  adminEmail: z.email("Invalid email address"),
});

export type EntityFormValues = z.infer<typeof entityFormSchema>;
export type NewEntityFormValues = z.infer<typeof newEntityFormSchema>;

export function entityFormDefaults(entity: Entity | undefined): EntityFormValues {
  return {
    name: entity?.name ?? "",
    entityTypeUuid: entity?.entity_type.uuid ?? "",
    email: entity?.email ?? "",
    companyType: entity?.company_type ?? "",
    organizationSize: entity?.organization_size ?? "",
    aum: String(entity?.aum ?? 0),
    country: entity?.country ?? "",
    sharingEnabled: entity?.sharing_enabled ?? true,
  };
}

export function newEntityFormDefaults(): NewEntityFormValues {
  return {
    ...entityFormDefaults(undefined),
    adminFirstName: "",
    adminLastName: "",
    adminEmail: "",
  };
}

export function entityBody(values: EntityFormValues): EntityBody {
  return {
    name: values.name,
    entity_code: values.entityTypeUuid,
    email: values.email,
    company_type: values.companyType,
    organization_size: values.organizationSize,
    aum: Number(values.aum),
    country: values.country,
    sharing_enabled: values.sharingEnabled,
  };
}
