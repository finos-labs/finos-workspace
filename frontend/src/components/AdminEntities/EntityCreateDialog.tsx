import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { createEntity, registerEntityAdmin } from "~/api/entities.api";
import { errorMessage } from "~/api/errors";
import { Form } from "~/components/ds/molecules/Form";
import { entityAdminKeys } from "~/hooks/useEntityAdmin";
import type { EntityType } from "~/types/entity.type";
import { EntityAdminFields, EntityBaseFields } from "./EntityFields";
import {
  entityBody,
  type NewEntityFormValues,
  newEntityFormDefaults,
  newEntityFormSchema,
} from "./entityForms";
import { FormDialog } from "./FormDialog";

export function EntityCreateDialog({
  entityTypes,
  onClose,
}: {
  entityTypes: EntityType[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<NewEntityFormValues>({
    resolver: zodResolver(newEntityFormSchema),
    defaultValues: newEntityFormDefaults(),
  });

  const entityTypeOptions = useMemo(
    () => entityTypes.map((type) => ({ value: type.uuid, label: type.entity_type })),
    [entityTypes],
  );

  async function submit(values: NewEntityFormValues) {
    setError(null);
    let created: Awaited<ReturnType<typeof createEntity>>;
    try {
      created = await createEntity({
        ...entityBody(values),
        admin_email: values.adminEmail,
      });
    } catch (e) {
      const message = errorMessage(e, "Unable to add the entity");
      setError(message);
      toast.error(message);
      return;
    }

    toast.success("Entity added");
    try {
      await registerEntityAdmin({
        email: values.adminEmail,
        permissions_uuid: created.permission_map_uuid,
        first_name: values.adminFirstName,
        last_name: values.adminLastName,
      });
      toast.success("Administrator added");
    } catch (e) {
      toast.error(
        `The entity was added, but its administrator was not: ${errorMessage(e, "Unable to add the administrator")}`,
      );
    }
    await queryClient.invalidateQueries({ queryKey: entityAdminKeys.root });
    onClose();
  }

  return (
    <Form {...form}>
      <FormDialog
        title="Add entity"
        onClose={onClose}
        onSubmit={form.handleSubmit(submit)}
        submitLabel="Add entity"
        isSubmitting={form.formState.isSubmitting}
        error={error}
      >
        <EntityBaseFields entityTypeOptions={entityTypeOptions} />
        <EntityAdminFields />
      </FormDialog>
    </Form>
  );
}
