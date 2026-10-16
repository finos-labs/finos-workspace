import { zodResolver } from "@hookform/resolvers/zod";
import { Checkbox, FormField, FormInput, FormSelect } from "ui/Form";
import { useForm } from "react-hook-form";
import { ManagerForm } from "components/formItems";
import type { SubmitFormProps } from "components/managers/Base";
import { handleRequest } from "components/managers/helpers";
import { type JSX, useEffect, useState } from "react";

import {
  type BaseEntity,
  type Entity,
  type EntityType,
  type PostEntity,
  addEntity,
  addUser,
  editEntity,
} from "utils/requests";
import { z } from "zod";
import { toast } from "sonner";

interface FormData {
  entityTypes: EntityType[];
}

const entitySchema = z.object({
  entityName: z.string().min(1, "This field is required"),
  code: z.string().uuid().min(1, "This field is required"),
  email: z.string().min(1, "This field is required").email("Invalid email address"),
  companyType: z.string().min(1, "This field is required"),
  organizationSize: z.string().min(1, "This field is required"),
  aum: z.coerce.number(),
  country: z.string().min(1, "This field is required"),
  sharingEnabled: z.boolean(),
});

const adminSchema = z.object({
  adminFirstName: z.string().min(1, "This field is required"),
  adminLastName: z.string().min(1, "This field is required"),
  adminEmail: z.string().email().min(1, "This field is required"),
});

const adminFormSchema = entitySchema.merge(adminSchema);
type TFormSchema = z.infer<typeof entitySchema>;
type TAdminSchema = z.infer<typeof adminFormSchema>;

function isAdminSchema(data: TFormSchema | TAdminSchema): data is TAdminSchema {
  return "adminEmail" in data;
}

export function EntitySubmitForm({
  setShowAdd,
  retrieveItems,
  data,
  item,
  setItem,
  editType,
}: SubmitFormProps<Entity, FormData>): JSX.Element {
  const [warning, setWarning] = useState("");
  const extras = item ? {} : { adminFirstName: "", adminLastName: "", adminEmail: "" };

  const formSchema = editType === "Add" ? adminFormSchema : entitySchema;

  const form = useForm<TFormSchema | TAdminSchema>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      entityName: item?.name || "",
      code: item?.entity_type.uuid ?? "",
      email: item?.email ?? "",
      companyType: item?.company_type ?? "",
      organizationSize: item?.organization_size ?? "",
      aum: item?.aum ?? 0,
      country: item?.country ?? "",
      sharingEnabled: item?.sharing_enabled ?? true,
      ...extras,
    },
  });

  useEffect(() => {
    if (form.formState.errors && Object.keys(form.formState.errors).length > 0) {
      setWarning(`Form validation errors: ${JSON.stringify(form.formState.errors)}`);
    }
  }, [form.formState]);

  const handleSubmit = async (values: TFormSchema | TAdminSchema): Promise<void> => {
    let postData: PostEntity | undefined = undefined;
    const putData: BaseEntity = {
      name: values.entityName,
      entity_code: values.code,
      email: values.email,
      company_type: values.companyType,
      organization_size: values.organizationSize,
      aum: values.aum,
      country: values.country,
      sharing_enabled: values.sharingEnabled,
    };
    if (item === undefined && editType === "Add" && isAdminSchema(values)) {
      postData = {
        ...putData,
        admin_email: values.adminEmail,
      };
    }

    if (item !== undefined) {
      const response = await editEntity(item.uuid, putData);
      if (response.success) {
        toast.success("Entity updated successfully");
      } else {
        toast.error(response.message);
      }
      await handleRequest(response, setWarning, setShowAdd, retrieveItems);
    } else if (editType === "Add" && postData !== undefined) {
      let extraWarning = "";
      let response = await addEntity(postData);
      if (response.success) {
        toast.success("Entity added successfully");
      } else {
        toast.error(response.message);
        await handleRequest(response, setWarning, setShowAdd, retrieveItems, extraWarning);
        return;
      }

      if (
        response.data !== undefined &&
        "adminEmail" in values &&
        typeof values.adminEmail === "string" &&
        "adminFirstName" in values &&
        typeof values.adminFirstName === "string" &&
        "adminLastName" in values &&
        typeof values.adminLastName === "string"
      ) {
        const addUserResponse = await addUser(
          values.adminEmail,
          response.data.permission_map_uuid,
          values.adminFirstName,
          values.adminLastName,
        );
        if (addUserResponse.success) {
          toast.success("Admin added successfully");
        } else {
          toast.error(addUserResponse.message);
        }

        if (!addUserResponse.success) {
          extraWarning = addUserResponse.message ?? "";
        }
      }

      await handleRequest(response, setWarning, setShowAdd, retrieveItems, extraWarning);
    }
  };

  const codeOptions = data.entityTypes.map((obj) => ({
    value: obj.uuid,
    label: obj.code,
  }));

  return (
    <ManagerForm form={form} onSubmit={handleSubmit} warning={warning}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto">
        <FormField
          name="entityName"
          control={form.control}
          render={({ field }) => {
            return <FormInput label="Name" placeholder="Workspace" {...field} />;
          }}
        />
        <FormField
          name="code"
          control={form.control}
          render={({ field }) => (
            <FormSelect
              label="Code"
              options={codeOptions}
              placeholder="Select a role"
              {...field}
            />
          )}
        />
        <FormField
          name="email"
          control={form.control}
          render={({ field }) => {
            return <FormInput label="Business Email" {...field} />;
          }}
        />
        <FormField
          name="companyType"
          control={form.control}
          render={({ field }) => {
            return <FormInput label="Company Type" {...field} />;
          }}
        />
        <FormField
          name="organizationSize"
          control={form.control}
          render={({ field }) => {
            return <FormInput label="Organization Size" {...field} />;
          }}
        />
        <FormField
          name="aum"
          control={form.control}
          render={({ field }) => {
            return <FormInput type="number" label="AUM" {...field} />;
          }}
        />
        <FormField
          name="country"
          control={form.control}
          render={({ field }) => {
            return <FormInput label="Country" {...field} />;
          }}
        />
        <FormField
          name="sharingEnabled"
          control={form.control}
          render={({ field }) => {
            return (
              <Checkbox
                label="Sharing enabled"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            );
          }}
        />
        {item === undefined ? (
          <>
            <FormField
              name="adminFirstName"
              control={form.control}
              render={({ field }) => {
                return <FormInput label="Admin First Name" {...field} />;
              }}
            />
            <FormField
              name="adminLastName"
              control={form.control}
              render={({ field }) => {
                return <FormInput label="Admin Last Name" {...field} />;
              }}
            />
            <FormField
              name="adminEmail"
              control={form.control}
              render={({ field }) => {
                return <FormInput label="Admin Email" {...field} />;
              }}
            />
          </>
        ) : (
          <></>
        )}
      </div>
      <button type="submit" className="ws-btn-blue mt-2">Submit</button>
    </ManagerForm>
  );
}
