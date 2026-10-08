import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { createEntityType, updateEntityType } from "~/api/entities.api";
import { errorMessage } from "~/api/errors";
import { Checkbox } from "~/components/ds/atoms/Checkbox";
import { FormInput } from "~/components/ds/atoms/Input";
import { Form, FormField } from "~/components/ds/molecules/Form";
import { entityAdminKeys } from "~/hooks/useEntityAdmin";
import type { EntityType } from "~/types/entity.type";
import { FormDialog } from "./FormDialog";

export const entityTypeFormSchema = z.object({
  entityType: z.string().trim().min(1, "This field is required"),
  code: z
    .string()
    .trim()
    .min(1, "This field is required")
    .max(3, "At most 3 characters"),
  permissionHierarchy: z.string().trim().regex(/^\d+$/, "Enter a whole number"),
  active: z.boolean(),
});

type EntityTypeFormValues = z.infer<typeof entityTypeFormSchema>;

export function EntityTypeDialog({
  entityType,
  onClose,
}: {
  /** The type to edit; without one the dialog adds a type. */
  entityType?: EntityType;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<EntityTypeFormValues>({
    resolver: zodResolver(entityTypeFormSchema),
    defaultValues: {
      entityType: entityType?.entity_type ?? "",
      code: entityType?.code ?? "",
      permissionHierarchy: String(entityType?.permission_hierarchy ?? 0),
      active: entityType?.active ?? true,
    },
  });

  async function submit(values: EntityTypeFormValues) {
    setError(null);
    const body = {
      entity_type: values.entityType,
      code: values.code,
      active: values.active,
      permission_hierarchy: Number(values.permissionHierarchy),
    };
    try {
      if (entityType) await updateEntityType(entityType.uuid, body);
      else await createEntityType(body);
    } catch (e) {
      const message = errorMessage(e, "Unable to save the entity type");
      setError(message);
      toast.error(message);
      return;
    }
    toast.success(entityType ? "Entity type updated" : "Entity type added");
    await queryClient.invalidateQueries({ queryKey: entityAdminKeys.root });
    onClose();
  }

  return (
    <Form {...form}>
      <FormDialog
        title={entityType ? "Edit entity type" : "Add entity type"}
        onClose={onClose}
        onSubmit={form.handleSubmit(submit)}
        submitLabel={entityType ? "Save" : "Add entity type"}
        isSubmitting={form.formState.isSubmitting}
        error={error}
      >
        <FormField
          name="entityType"
          control={form.control}
          render={({ field }) => <FormInput label="Entity type" {...field} />}
        />
        <FormField
          name="code"
          control={form.control}
          render={({ field }) => <FormInput label="Code" {...field} />}
        />
        <FormField
          name="permissionHierarchy"
          control={form.control}
          render={({ field }) => (
            <FormInput type="number" label="Permission hierarchy" {...field} />
          )}
        />
        <FormField
          name="active"
          control={form.control}
          render={({ field }) => (
            <Checkbox
              label="Active"
              labelClassName="max-w-none whitespace-nowrap ml-1"
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </FormDialog>
    </Form>
  );
}
