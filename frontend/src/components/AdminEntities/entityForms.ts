import { z } from "zod";
import type { EntityBody } from "~/api/entities.api";
import type { Entity } from "~/types/entity.type";

const required = z.string().trim().min(1, "This field is required");

export const entityFormSchema = z.object({
  name: required,
  sharingEnabled: z.boolean(),
});

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
  return { name: values.name, sharing_enabled: values.sharingEnabled };
}
