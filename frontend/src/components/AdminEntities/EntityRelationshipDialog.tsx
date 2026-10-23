import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  createEntityRelationship,
  type EntityRelationship,
  updateEntityRelationship,
} from "~/api/entities.api";
import { errorMessage } from "~/api/errors";
import { FormSelect } from "~/components/ds/atoms/Select";
import { Form, FormField } from "~/components/ds/molecules/Form";
import { entityAdminKeys } from "~/hooks/useEntityAdmin";
import type { Entity } from "~/types/entity.type";
import { FormDialog } from "./FormDialog";

export const relationshipFormSchema = z
  .object({
    parent: z.uuid("Choose an entity"),
    child: z.uuid("Choose an entity"),
  })
  .refine((values) => values.parent !== values.child, {
    message: "An entity cannot be its own child",
    path: ["child"],
  });

type RelationshipFormValues = z.infer<typeof relationshipFormSchema>;

export function EntityRelationshipDialog({
  relationship,
  entities,
  onClose,
}: {
  relationship?: EntityRelationship;
  entities: Entity[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<RelationshipFormValues>({
    resolver: zodResolver(relationshipFormSchema),
    defaultValues: {
      parent: relationship?.parent.uuid ?? "",
      child: relationship?.child.uuid ?? "",
    },
  });

  const options = useMemo(
    () => entities.map((entity) => ({ value: entity.uuid, label: entity.name })),
    [entities],
  );

  async function submit(values: RelationshipFormValues) {
    setError(null);
    try {
      if (relationship) {
        await updateEntityRelationship(relationship.uuid, values.parent, values.child);
      } else {
        await createEntityRelationship(values.parent, values.child);
      }
    } catch (e) {
      const message = errorMessage(e, "Unable to save the relationship");
      setError(message);
      toast.error(message);
      return;
    }
    toast.success(relationship ? "Relationship updated" : "Relationship added");
    await queryClient.invalidateQueries({ queryKey: entityAdminKeys.root });
    onClose();
  }

  return (
    <Form {...form}>
      <FormDialog
        title={relationship ? "Edit relationship" : "Add relationship"}
        onClose={onClose}
        onSubmit={form.handleSubmit(submit)}
        submitLabel={relationship ? "Save" : "Add relationship"}
        isSubmitting={form.formState.isSubmitting}
        error={error}
      >
        <FormField
          name="parent"
          control={form.control}
          render={({ field }) => (
            <FormSelect
              label="Parent"
              placeholder="Select the parent entity"
              options={options}
              {...field}
            />
          )}
        />
        <FormField
          name="child"
          control={form.control}
          render={({ field }) => (
            <FormSelect
              label="Child"
              placeholder="Select the child entity"
              options={options}
              {...field}
            />
          )}
        />
      </FormDialog>
    </Form>
  );
}
