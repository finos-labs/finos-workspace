import { zodResolver } from "@hookform/resolvers/zod";
import { Checkbox, FormField, FormInput, FormSelect } from "ui/Form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/Tabs";
import { useForm } from "react-hook-form";
import { ManagerForm } from "components/formItems";
import type { SubmitFormProps } from "components/managers/Base";
import { handleRequest } from "components/managers/helpers";
import type React from "react";
import { useEffect, useState } from "react";
import {
  type EntitlementBase,
  type FullUser,
  type PermissionMap,
  addUser,
  editUser,
  getAdminUserEntitlement,
  patchAdminUserEntitlement,
} from "utils/requests";
import { z } from "zod";
import { toast } from "sonner";

interface FormData {
  permissionMaps: PermissionMap[];
}

const userSchema = z.object({
  email: z.string().email().min(1, "This field is required"),
  permissions: z.string().uuid().min(1, "This field is required"),
  // Entitlement fields
  tier: z.enum(["full", "basic"]).optional(),
  number_copilot_calls_day: z.coerce.number().optional(),
  number_copilot_tokens_day: z
    .preprocess(
      (value) => (value === "" || value == null ? null : Number(value)),
      z.number().int().min(0).nullable(),
    )
    .optional(), // empty: no token limit
  total_file_upload_size_gb: z.coerce.number().optional(),
  share_widgets: z.enum(["public", "private"]).optional(),
  bring_your_own_data: z.boolean().optional(),
  bring_your_own_copilot: z.boolean().optional(),
  admin_access: z.boolean().optional(),
  support: z.boolean().optional(),
  excel_add_in: z.boolean().optional(),
  data_add_ons_redistribution: z.boolean().optional(),
  bundle_name: z
    .enum(["Default", "Equity Research"])
    .nullable()
    .optional(),
});
type TUserSchema = z.infer<typeof userSchema>;

export function UserSubmitForm({
  user,
  setShowAdd,
  retrieveItems,
  data,
  item,
  setItem,
  editType,
}: SubmitFormProps<FullUser, FormData>): JSX.Element {
  const [warning, setWarning] = useState("");
  const [entitlements, setEntitlements] = useState<Partial<EntitlementBase>>({});
  const [activeTab, setActiveTab] = useState("base");

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

  useEffect(() => {
    const fetchEntitlements = async () => {
      if (item) {
        const result = await getAdminUserEntitlement(item.uuid, user.accessToken);
        setEntitlements(result);
      }
    };
    fetchEntitlements();
  }, [item, user.accessToken]);

  useEffect(() => {
    if (Object.keys(entitlements).length > 0) {
      form.reset({
        ...form.getValues(),
        ...entitlements,
      });
    }
  }, [entitlements, form]);

  const handleSubmit = async (values: TUserSchema): Promise<void> => {
    if (item !== undefined) {
      if (activeTab === "base") {
        const response = await editUser(
          item.uuid,
          values.permissions,
          user.accessToken,
        );
        if (response.success) {
          toast.success("User updated successfully");
        } else {
          toast.error(response.message);
        }
        await handleRequest(response, setWarning, setShowAdd, retrieveItems);
      } else if (activeTab === "entitlements") {
        const entitlement: EntitlementBase = {
          tier: values.tier,
          number_copilot_calls_day: values.number_copilot_calls_day,
          number_copilot_tokens_day: values.number_copilot_tokens_day,
          total_file_upload_size_gb: values.total_file_upload_size_gb,
          share_widgets: values.share_widgets,
          bring_your_own_data: values.bring_your_own_data,
          bring_your_own_copilot: values.bring_your_own_copilot,
          admin_access: values.admin_access,
          support: values.support,
          excel_add_in: values.excel_add_in,
          data_add_ons_redistribution: values.data_add_ons_redistribution,
          bundle_name: values.bundle_name,
        };
        const entitlementResponse = await patchAdminUserEntitlement(
          item.uuid,
          entitlement,
          user.accessToken,
        );
        if (entitlementResponse.success) {
          toast.success("User entitlements updated successfully");
        } else {
          toast.error(entitlementResponse.message);
        }
        await handleRequest(entitlementResponse, setWarning, setShowAdd, retrieveItems);
      }
    } else {
      const response = await addUser(
        values.email,
        values.permissions,
        null,
        null,
        user.accessToken,
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
    <Tabs defaultValue="base" onValueChange={setActiveTab}>
      <TabsList className="mb-2 flex w-full gap-2 rounded border border-general-border-primary bg-general-bg-secondary p-1">
        <TabsTrigger value="base" className="px-3 py-1 text-xs">
          Base
        </TabsTrigger>
        {editType === "Edit" && (
          <TabsTrigger value="entitlements" className="px-3 py-1 text-xs">
            Entitlements
          </TabsTrigger>
        )}
      </TabsList>
      <ManagerForm form={form} onSubmit={handleSubmit} warning={warning}>
        <TabsContent value="base">
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
        </TabsContent>
        {editType === "Edit" ? (
          <TabsContent value="entitlements">
            <FormField
              name="tier"
              control={form.control}
              render={({ field }) => {
                return (
                  <FormSelect
                    options={[
                      { value: "full", label: "Full" },
                      { value: "basic", label: "Basic" },
                    ]}
                    label="Tier"
                    {...field}
                  />
                );
              }}
            />
            <FormField
              name="number_copilot_calls_day"
              control={form.control}
              render={({ field }) => {
                return (
                  <FormInput
                    type="number"
                    label="Number of Copilot Calls per Day"
                    {...field}
                  />
                );
              }}
            />
            <FormField
              name="number_copilot_tokens_day"
              control={form.control}
              render={({ field }) => {
                return (
                  <FormInput
                    type="number"
                    label="Number of Copilot Tokens per Day (empty for no limit)"
                    {...field}
                    value={field.value ?? ""}
                  />
                );
              }}
            />
            <FormField
              name="total_file_upload_size_gb"
              control={form.control}
              render={({ field }) => {
                return (
                  <FormInput
                    type="number"
                    label="Total File Upload Size (GB)"
                    {...field}
                  />
                );
              }}
            />
            <FormField
              name="share_widgets"
              control={form.control}
              render={({ field }) => {
                return (
                  <FormSelect
                    options={[
                      { value: "public", label: "Public" },
                      { value: "private", label: "Private" },
                    ]}
                    label="Share Widgets"
                    {...field}
                  />
                );
              }}
            />
            <FormField
              name="bring_your_own_data"
              control={form.control}
              render={({ field }) => {
                return (
                  <Checkbox
                    label="Bring Your Own Data"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                );
              }}
            />
            <FormField
              name="bring_your_own_copilot"
              control={form.control}
              render={({ field }) => {
                return (
                  <Checkbox
                    label="Bring Your Own Copilot"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                );
              }}
            />
            <FormField
              name="admin_access"
              control={form.control}
              render={({ field }) => {
                return (
                  <Checkbox
                    label="Admin Access"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                );
              }}
            />
            <FormField
              name="support"
              control={form.control}
              render={({ field }) => {
                return (
                  <Checkbox
                    label="Support"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                );
              }}
            />
            <FormField
              name="excel_add_in"
              control={form.control}
              render={({ field }) => {
                return (
                  <Checkbox
                    label="Excel Add-In"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                );
              }}
            />
            <FormField
              name="data_add_ons_redistribution"
              control={form.control}
              render={({ field }) => {
                return (
                  <Checkbox
                    label="Data Add-Ons Redistribution"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                );
              }}
            />
            <FormField
              name="bundle_name"
              control={form.control}
              render={({ field }) => (
                <FormSelect
                  options={[
                    { value: "Default", label: "Default" },
                    { value: "Equity Research", label: "Equity Research" },
                  ]}
                  label="Bundle Name"
                  {...field}
                  value={field.value ?? undefined}
                />
              )}
            />
          </TabsContent>
        ) : (
          <></>
        )}
        <button type="submit" className="ws-btn-blue mt-2">
          {activeTab === "base" ? "Submit Base Info" : "Submit Entitlements"}
        </button>
      </ManagerForm>
    </Tabs>
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

  const searchId = "user-email-search";
  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <label htmlFor={searchId} className="sr-only">
        Search by user email
      </label>
      <input
        id={searchId}
        type="search"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
        }}
        className="h-8 rounded border border-general-border-primary bg-input-bg px-3 text-xs text-ds-text-body focus:outline-none focus:ring-1 focus:ring-link-color"
        placeholder="Search by user email"
      />
      <button type="submit" className="ws-btn">Search</button>
    </form>
  );
}
