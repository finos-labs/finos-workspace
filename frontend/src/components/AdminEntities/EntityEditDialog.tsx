import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { type FieldErrors, useForm } from "react-hook-form";
import { toast } from "sonner";
import { patchEntityEntitlement, updateEntity } from "~/api/entities.api";
import { errorMessage } from "~/api/errors";
import { Checkbox } from "~/components/ds/atoms/Checkbox";
import { Form } from "~/components/ds/molecules/Form";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ds/molecules/Tabs";
import { entityAdminKeys, useEntityEntitlement } from "~/hooks/useEntityAdmin";
import type { Entity, EntityType } from "~/types/entity.type";
import { EntityBaseFields, EntityEntitlementFields } from "./EntityFields";
import { EntityPluginsLine } from "./EntityPluginsLine";
import {
  type EditEntityFormValues,
  editEntityFormSchema,
  entitlementBody,
  entitlementFormDefaults,
  entitlementFormSchema,
  entityBody,
  entityFormDefaults,
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
  const [tab, setTab] = useState("base");
  const [updateAllUsers, setUpdateAllUsers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entitlementQuery = useEntityEntitlement(entity.uuid);

  const form = useForm<EditEntityFormValues>({
    resolver: zodResolver(editEntityFormSchema),
    defaultValues: {
      ...entityFormDefaults(entity),
      ...entitlementFormDefaults(undefined),
    },
  });

  // The entitlements arrive after the dialog opens; they replace the placeholders
  const entitlement = entitlementQuery.data;
  const { reset, getValues } = form;
  useEffect(() => {
    if (entitlement) reset({ ...getValues(), ...entitlementFormDefaults(entitlement) });
  }, [entitlement, reset, getValues]);

  const entityTypeOptions = useMemo(
    () => entityTypes.map((type) => ({ value: type.uuid, label: type.entity_type })),
    [entityTypes],
  );

  /** Shows the tab that holds the first field that is not valid. */
  function showInvalidTab(errors: FieldErrors<EditEntityFormValues>) {
    const entitlementFields = Object.keys(entitlementFormSchema.shape);
    const firstInvalid = Object.keys(errors)[0];
    setTab(
      firstInvalid && entitlementFields.includes(firstInvalid)
        ? "entitlements"
        : "base",
    );
  }

  async function submit(values: EditEntityFormValues) {
    setError(null);
    try {
      await updateEntity(entity.uuid, entityBody(values));
      // Entitlements that never loaded are left as they are, not replaced by placeholders
      if (entitlement) {
        await patchEntityEntitlement(
          entity.uuid,
          entitlementBody(values),
          updateAllUsers,
        );
      }
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
        onSubmit={form.handleSubmit(submit, showInvalidTab)}
        submitLabel="Save"
        isSubmitting={form.formState.isSubmitting || entitlementQuery.isLoading}
        error={error}
      >
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="base">Base</TabsTrigger>
            <TabsTrigger value="entitlements">Entitlements</TabsTrigger>
          </TabsList>
          <TabsContent value="base" className="space-y-6">
            <EntityBaseFields entityTypeOptions={entityTypeOptions} />
            <EntityPluginsLine entityUuid={entity.uuid} />
          </TabsContent>
          <TabsContent value="entitlements" className="space-y-6">
            {entitlementQuery.isError ? (
              <p className="text-alert-error body-xs-regular">
                The entitlements of this entity could not be loaded.
              </p>
            ) : (
              <>
                <EntityEntitlementFields />
                <Checkbox
                  label="Apply to all users of this entity"
                  labelClassName="max-w-none whitespace-nowrap ml-1"
                  checked={updateAllUsers}
                  onCheckedChange={(checked) => setUpdateAllUsers(checked === true)}
                />
              </>
            )}
          </TabsContent>
        </Tabs>
      </FormDialog>
    </Form>
  );
}
