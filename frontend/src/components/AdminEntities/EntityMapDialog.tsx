import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { createEntityMap, updateEntityMap } from "~/api/entities.api";
import { errorMessage } from "~/api/errors";
import { FormSelect } from "~/components/ds/atoms/Select";
import { Form, FormField } from "~/components/ds/molecules/Form";
import { entityAdminKeys } from "~/hooks/useEntityAdmin";
import { type Entity, type EntityMapItem, USER_TYPES } from "~/types/entity.type";
import { FormDialog } from "./FormDialog";

export const mapFormSchema = z.object({
  entityUuid: z.uuid("Choose an entity"),
  name: z.enum(USER_TYPES, "Choose a user type"),
});

type MapFormValues = z.infer<typeof mapFormSchema>;

export function EntityMapDialog({
  map,
  entities,
  onClose,
}: {
  map?: EntityMapItem;
  entities: Entity[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<MapFormValues>({
    resolver: zodResolver(mapFormSchema),
    defaultValues: { entityUuid: map?.entity.uuid ?? "", name: map?.name },
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
          render={({ field }) => (
            <FormSelect
              label="User type"
              placeholder="Select a user type"
              options={USER_TYPES}
              {...field}
            />
          )}
        />
      </FormDialog>
    </Form>
  );
}
