import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { moveEntityUser } from "~/api/entities.api";
import { errorMessage } from "~/api/errors";
import { FormSelect } from "~/components/ds/atoms/Select";
import { Form, FormField } from "~/components/ds/molecules/Form";
import { entityAdminKeys } from "~/hooks/useEntityAdmin";
import { type EntityMapItem, type EntityUser, USER_TYPES } from "~/types/entity.type";
import { FormDialog } from "./FormDialog";

export const moveFormSchema = z.object({
  entityUuid: z.uuid("Choose an entity"),
  name: z.string().min(1, "Choose a user type"),
});

type MoveFormValues = z.infer<typeof moveFormSchema>;

export function UserMoveDialog({
  user,
  maps,
  onClose,
}: {
  user: EntityUser;
  maps: EntityMapItem[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<MoveFormValues>({
    resolver: zodResolver(moveFormSchema),
    defaultValues: {
      entityUuid: user.permissions?.entity.uuid ?? "",
      name: user.permissions?.name ?? "",
    },
  });
  const entityUuid = form.watch("entityUuid");

  const entityOptions = useMemo(() => {
    const names = new Map(maps.map((map) => [map.entity.uuid, map.entity.name]));
    return [...names]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [maps]);

  const typeOptions = useMemo(
    () =>
      USER_TYPES.filter((type) =>
        maps.some((map) => map.entity.uuid === entityUuid && map.name === type),
      ),
    [maps, entityUuid],
  );

  useEffect(() => {
    const name = form.getValues("name");
    if (name && !typeOptions.some((type) => type === name)) form.setValue("name", "");
  }, [form, typeOptions]);

  async function submit(values: MoveFormValues) {
    setError(null);
    const target = maps.find(
      (map) => map.entity.uuid === values.entityUuid && map.name === values.name,
    );
    if (!target) {
      setError("Choose a user type of the entity");
      return;
    }
    if (target.uuid === user.permissions?.uuid) {
      onClose();
      return;
    }
    try {
      await moveEntityUser(user.uuid, target.uuid);
    } catch (e) {
      const message = errorMessage(e, "Unable to move the user");
      setError(message);
      toast.error(message);
      return;
    }
    toast.success("User moved");
    await queryClient.invalidateQueries({ queryKey: entityAdminKeys.root });
    onClose();
  }

  return (
    <Form {...form}>
      <FormDialog
        title="Move user"
        onClose={onClose}
        onSubmit={form.handleSubmit(submit)}
        submitLabel="Move"
        isSubmitting={form.formState.isSubmitting}
        error={error}
      >
        <p className="body-xs-regular text-ds-text-body">{user.email}</p>
        <FormField
          name="entityUuid"
          control={form.control}
          render={({ field }) => (
            <FormSelect
              label="Entity"
              placeholder="Select an entity"
              options={entityOptions}
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
              options={typeOptions}
              {...field}
            />
          )}
        />
        <p className="body-xs-regular text-ds-text-caption">
          In another entity the user leaves the roles of this one and gets that entity's
          Agent User. Their sessions end.
        </p>
      </FormDialog>
    </Form>
  );
}
