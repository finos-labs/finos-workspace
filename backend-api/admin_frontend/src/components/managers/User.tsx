import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormSelect } from "ui/Form";
import { useForm } from "react-hook-form";
import { ManagerForm } from "components/formItems";
import type { SubmitFormProps } from "components/managers/Base";
import { handleRequest } from "components/managers/helpers";
import type React from "react";
import { useEffect, useState } from "react";
import { type FullUser, type PermissionMap, addUser, editUser } from "utils/requests";
import { z } from "zod";
import { toast } from "sonner";

interface FormData {
  permissionMaps: PermissionMap[];
}

const userSchema = z.object({
  email: z.string().email().min(1, "This field is required"),
  permissions: z.string().uuid().min(1, "This field is required"),
});
type TUserSchema = z.infer<typeof userSchema>;

export function UserSubmitForm({
  setShowAdd,
  retrieveItems,
  data,
  item,
  setItem,
  editType,
}: SubmitFormProps<FullUser, FormData>): JSX.Element {
  const [warning, setWarning] = useState("");

  const form = useForm<TUserSchema>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      email: item?.email ?? "",
      permissions: item?.permissions?.uuid ?? "",
    },
  });

  useEffect(() => {
    if (form.formState.errors && Object.keys(form.formState.errors).length > 0) {
      setWarning(`Form validation errors: ${JSON.stringify(form.formState.errors)}`);
    }
  }, [form.formState]);

  const handleSubmit = async (values: TUserSchema): Promise<void> => {
    if (item !== undefined) {
      const response = await editUser(item.uuid, values.permissions);
      if (response.success) {
        toast.success("User updated successfully");
      } else {
        toast.error(response.message);
      }
      await handleRequest(response, setWarning, setShowAdd, retrieveItems);
    } else {
      const response = await addUser(
        values.email,
        values.permissions,
        null,
        null,
      );
      if (response.success) {
        toast.success("User added successfully");
      } else {
        toast.error(response.message);
      }
      await handleRequest(response, setWarning, setShowAdd, retrieveItems);
    }
  };

  function getOptions(): { value: string; label: string }[] {
    const options = data.permissionMaps.map((obj) => ({
      value: obj.uuid,
      label: `${obj?.entity?.name}-${obj?.name}`,
    }));
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }

  return (
    <ManagerForm form={form} onSubmit={handleSubmit} warning={warning}>
      <FormField
        name="email"
        control={form.control}
        render={({ field }) => {
          return <FormInput label="email" {...field} />;
        }}
      />
      <FormField
        name="permissions"
        control={form.control}
        render={({ field }) => (
          <FormSelect label="Permissions" options={getOptions()} {...field} />
        )}
      />
      <button type="submit" className="ws-btn-blue mt-2">Submit</button>
    </ManagerForm>
  );
}

export function UserSearchBar({
  retrieveItems,
}: { retrieveItems: (email?: string) => Promise<void> }): JSX.Element {
  const [email, setEmail] = useState("");

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await retrieveItems(email);
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="text"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
        }}
        className="h-8 rounded border border-general-border-primary bg-input-bg px-3 text-xs text-ds-text-body focus:outline-none"
        placeholder="Search by user email"
      />
      <button type="submit" className="ws-btn">Search</button>
    </form>
  );
}
