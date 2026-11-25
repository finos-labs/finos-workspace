import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { restoreEntity } from "~/api/entities.api";
import { errorMessage } from "~/api/errors";
import { FormInput } from "~/components/ds/atoms/Input";
import { Form, FormField } from "~/components/ds/molecules/Form";
import { entityAdminKeys } from "~/hooks/useEntityAdmin";
import type { Entity } from "~/types/entity.type";
import { FormDialog } from "./FormDialog";

const restoreFormSchema = z.object({
  name: z.string().trim().min(1, "This field is required").max(100),
});

type RestoreFormValues = z.infer<typeof restoreFormSchema>;

export function EntityRestoreDialog({
  entity,
  onClose,
}: {
  entity: Entity;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<RestoreFormValues>({
    resolver: zodResolver(restoreFormSchema),
    defaultValues: { name: entity.name },
  });

  async function submit(values: RestoreFormValues) {
    setError(null);
    try {
      await restoreEntity(entity.uuid, values.name);
    } catch (e) {
      const message = errorMessage(e, "Unable to restore the entity");
      setError(message);
      toast.error(message);
      return;
    }
    toast.success("Entity restored");
    await queryClient.invalidateQueries({ queryKey: entityAdminKeys.root });
    onClose();
  }

  return (
    <Form {...form}>
      <FormDialog
        title="Restore entity"
        onClose={onClose}
        onSubmit={form.handleSubmit(submit)}
        submitLabel="Restore"
        isSubmitting={form.formState.isSubmitting}
        error={error}
      >
        <FormField
          name="name"
          control={form.control}
          render={({ field }) => <FormInput label="Name" {...field} />}
        />
        <p className="body-xs-regular text-ds-text-caption">
          The entity comes back with its permission maps, roles, settings and backends.
          Change the name if another entity has it now.
        </p>
      </FormDialog>
    </Form>
  );
}
