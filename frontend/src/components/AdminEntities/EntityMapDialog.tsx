import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { createEntityMap, updateEntityMap } from "~/api/entities.api";
import { errorMessage } from "~/api/errors";
import { FormInput } from "~/components/ds/atoms/Input";
import { FormSelect } from "~/components/ds/atoms/Select";
import { Form, FormField } from "~/components/ds/molecules/Form";
import { entityAdminKeys } from "~/hooks/useEntityAdmin";
import type { Entity, EntityMapItem } from "~/types/entity.type";
import { FormDialog } from "./FormDialog";

export const mapFormSchema = z.object({
  entityUuid: z.uuid("Choose an entity"),
  name: z.string().trim().min(1, "This field is required"),
});

type MapFormValues = z.infer<typeof mapFormSchema>;

export function EntityMapDialog({
  map,
  entities,
  onClose,
}: {
  /** The permission map to edit; without one the dialog adds a map. */
  map?: EntityMapItem;
  entities: Entity[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<MapFormValues>({
    resolver: zodResolver(mapFormSchema),
    defaultValues: { entityUuid: map?.entity.uuid ?? "", name: map?.name ?? "" },
  });

  const options = useMemo(
    () => entities.map((entity) => ({ value: entity.uuid, label: entity.name })),
    [entities],
  );

  async function submit(values: MapFormValues) {
    setError(null);
    try {
      if (map) await updateEntityMap(map.uuid, values.entityUuid, values.name);
      else await createEntityMap(values.entityUuid, values.name);
    } catch (e) {
      const message = errorMessage(e, "Unable to save the permission map");
      setError(message);
      toast.error(message);
      return;
    }
    toast.success(map ? "Permission map updated" : "Permission map added");
    await queryClient.invalidateQueries({ queryKey: entityAdminKeys.root });
    onClose();
  }

  return (
    <Form {...form}>
      <FormDialog
        title={map ? "Edit permission map" : "Add permission map"}
        onClose={onClose}
        onSubmit={form.handleSubmit(submit)}
        submitLabel={map ? "Save" : "Add permission map"}
        isSubmitting={form.formState.isSubmitting}
        error={error}
      >
        <FormField
          name="entityUuid"
          control={form.control}
          render={({ field }) => (
            <FormSelect
              label="Entity"
              placeholder="Select an entity"
              options={options}
              {...field}
            />
          )}
        />
        <FormField
          name="name"
          control={form.control}
          render={({ field }) => <FormInput label="Name" {...field} />}
        />
      </FormDialog>
    </Form>
  );
}
