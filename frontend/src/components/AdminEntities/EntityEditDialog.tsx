import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { updateEntity } from "~/api/entities.api";
import { errorMessage } from "~/api/errors";
import { Form } from "~/components/ds/molecules/Form";
import { entityAdminKeys } from "~/hooks/useEntityAdmin";
import type { Entity, EntityType } from "~/types/entity.type";
import { EntityBaseFields } from "./EntityFields";
import {
  type EntityFormValues,
  entityBody,
  entityFormDefaults,
  entityFormSchema,
} from "./entityForms";
import { FormDialog } from "./FormDialog";

export function EntityEditDialog({
  entity,
  entityTypes,
  onClose,
}: {
  entity: Entity;
  entityTypes: EntityType[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<EntityFormValues>({
    resolver: zodResolver(entityFormSchema),
    defaultValues: entityFormDefaults(entity),
  });

  const entityTypeOptions = useMemo(
    () => entityTypes.map((type) => ({ value: type.uuid, label: type.entity_type })),
    [entityTypes],
  );

  async function submit(values: EntityFormValues) {
    setError(null);
    try {
      await updateEntity(entity.uuid, entityBody(values));
    } catch (e) {
      const message = errorMessage(e, "Unable to save the entity");
      setError(message);
      toast.error(message);
      return;
    }
    toast.success("Entity updated");
    await queryClient.invalidateQueries({ queryKey: entityAdminKeys.root });
    onClose();
  }

  return (
    <Form {...form}>
      <FormDialog
        title="Edit entity"
        onClose={onClose}
        onSubmit={form.handleSubmit(submit)}
        submitLabel="Save"
        isSubmitting={form.formState.isSubmitting}
        error={error}
      >
        <EntityBaseFields entityTypeOptions={entityTypeOptions} />
      </FormDialog>
    </Form>
  );
}
