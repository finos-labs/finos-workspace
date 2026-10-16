import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormSelect } from "ui/Form";
import { useForm } from "react-hook-form";
import { ManagerForm } from "components/formItems";
import type { SubmitFormProps } from "components/managers/Base";
import { handleRequest } from "components/managers/helpers";
import React, { useState } from "react";
import {
  type Entity,
  type PermissionMap,
  USER_TYPES,
  addPermissionMap,
  editPermissionMap,
} from "utils/requests";
import { z } from "zod";

interface FormData {
  entities: Entity[];
}

const permissionsSchema = z.object({
  name: z.enum(USER_TYPES),
  entity: z.string().uuid().min(1, "This field is required"),
});
type TPermissionsSchema = z.infer<typeof permissionsSchema>;

export function PermissionsMapSubmitForm({
  setShowAdd,
  retrieveItems,
  data,
  item,
  setItem,
}: SubmitFormProps<PermissionMap, FormData>): JSX.Element {
  const [warning, setWarning] = useState("");

  const form = useForm<TPermissionsSchema>({
    resolver: zodResolver(permissionsSchema),
    defaultValues: {
      name: item?.name,
      entity: item?.entity.uuid ?? "",
    },
  });

  const handleSubmit = async (values: TPermissionsSchema): Promise<void> => {
    if (item !== undefined) {
      const response = await editPermissionMap(
        item.uuid,
        values.entity,
        values.name,
      );
      await handleRequest(response, setWarning, setShowAdd, retrieveItems);
    } else {
      const response = await addPermissionMap(values.entity, values.name);
      await handleRequest(response, setWarning, setShowAdd, retrieveItems);
    }
  };

  const entityOptions = data.entities.map((obj) => ({
    value: obj.uuid,
    label: obj.name,
  }));
  const typeOptions = USER_TYPES.map((type) => ({ value: type, label: type }));

  return (
    <ManagerForm onSubmit={handleSubmit} warning={warning} form={form}>
      <FormField
        name="entity"
        control={form.control}
        render={({ field }) => (
          <FormSelect label="Entity" options={entityOptions} {...field} />
        )}
      />
      <FormField
        name="name"
        control={form.control}
        render={({ field }) => (
          <FormSelect label="Name" options={typeOptions} {...field} />
        )}
      />
      <button type="submit" className="ws-btn-blue mt-2">Submit</button>
    </ManagerForm>
  );
}
