import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  deleteEntityRole,
  patchEntityRole,
  postEntityRole,
} from "~/api/entity_roles.api";
import type { SharingLevel } from "~/lib/state/access";
import { Button } from "../ds/atoms/Button";
import { Checkbox } from "../ds/atoms/Checkbox";
import { FormInput, Input } from "../ds/atoms/Input";
import { FormSelect } from "../ds/atoms/Select";
import { Tag } from "../ds/atoms/Tag";
import { FormTextarea } from "../ds/atoms/TextArea";
import { BaseDialog } from "../ds/dialogs/BaseDialog";
import { ConfirmDialog } from "../ds/dialogs/ConfirmDialog";
import { DialogFooter, DialogTitle } from "../ds/dialogs/Dialog";
import { Form, FormField } from "../ds/molecules/Form";
import { cn } from "../ds/utils";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import AddUsersSelect, { colorForEmail, getUserInitials } from "./AddUsersSelect";
import { useUsers } from "./adminUseQueries";
import type { RoleSettings, RoleT } from "./types";

interface User {
  name: string;
  email: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  initialData?: RoleT;
  roles: string[];
}

const SHARING_OPTIONS: { value: SharingLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "receive", label: "Receive only" },
  { value: "share", label: "Can share" },
];

// A daily limit: none, or the whole number the admin typed
const limit = z
  .object({ none: z.boolean(), value: z.string().trim() })
  .refine((l) => l.none || /^\d+$/.test(l.value), {
    message: "Enter a whole number",
    path: ["value"],
  });

const createRoleSchema = (initialData: RoleT | undefined, roles: string[]) =>
  z
    .object({
      name: z.string().min(1, "Name is required"),
      description: z.string().optional(),
      users: z.array(z.string()).optional(),
      sharing: z.enum(["none", "receive", "share"]),
      copilot_calls_day: limit,
      copilot_tokens_day: limit,
      upload_size_gb: limit,
      excel_add_in: z.boolean(),
    })
    .refine(
      (data) => {
        if (
          (initialData &&
            data.name !== initialData.name &&
            roles.includes(data.name)) ||
          (!initialData && roles.includes(data.name))
        ) {
          return false;
        }
        return true;
      },
      {
        message: "Role name already exists",
        path: ["name"],
      },
    );

type RoleForm = z.infer<ReturnType<typeof createRoleSchema>>;

type LimitForm = RoleForm["copilot_calls_day"];

const limitForm = (value: number | null | undefined): LimitForm =>
  value == null ? { none: true, value: "" } : { none: false, value: String(value) };
const limitValue = (limit: LimitForm) => (limit.none ? null : Number(limit.value));

/**
 * The form for `role`. A new role shares nothing and has no limits: its members may use
 * whatever the admin grants it.
 */
function roleFormValues(role: RoleT | undefined): RoleForm {
  return {
    name: role?.name ?? "",
    description: role?.description ?? "",
    users: role?.users ?? [],
    sharing: role?.sharing ?? "none",
    copilot_calls_day: limitForm(role?.copilot_calls_day),
    copilot_tokens_day: limitForm(role?.copilot_tokens_day),
    upload_size_gb: limitForm(role?.upload_size_gb),
    excel_add_in: role?.excel_add_in ?? false,
  };
}

function roleSettings(values: RoleForm): RoleSettings {
  return {
    sharing: values.sharing,
    copilot_calls_day: limitValue(values.copilot_calls_day),
    copilot_tokens_day: limitValue(values.copilot_tokens_day),
    upload_size_gb: limitValue(values.upload_size_gb),
    excel_add_in: values.excel_add_in,
  };
}

const LIMIT_FIELDS = [
  { name: "copilot_calls_day", label: "Agent calls per day" },
  { name: "copilot_tokens_day", label: "Agent tokens per day" },
  { name: "upload_size_gb", label: "Upload size (GB)" },
] as const;

export function RoleDialog(props: Props) {
  const { open, onClose, mode, initialData, roles } = props;
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const { data: usersData = [], isLoading: isLoadingUsers, refetch } = useUsers();
  const [entityUsers, setEntityUsers] = useState<User[]>([]);

  useEffect(() => {
    if (usersData.length === 0) return;
    const transformedUsers = usersData
      .filter((user) => user.permissions_uuid)
      .map((user) => ({
        name: user.fullName || `${user.first_name} ${user.last_name}`,
        email: user.email,
      }));
    setEntityUsers(transformedUsers);
  }, [usersData]);

  useEffect(() => {
    if (open) refetch();
  }, [open, refetch]);

  const resolver = useMemo(
    () => zodResolver(createRoleSchema(initialData, roles)),
    [initialData, roles],
  );

  const form = useForm<RoleForm>({
    resolver,
    mode: "onChange",
    defaultValues: roleFormValues(initialData),
  });

  useEffect(() => {
    if (mode === "edit" && initialData) {
      form.reset(roleFormValues(initialData));
      // Settle isValid on mount for prefilled edit forms.
      form.trigger();
    } else if (mode === "create") {
      form.reset(roleFormValues(undefined));
    }
  }, [mode, initialData, open, form]);

  const createMutation = useMutation({
    mutationFn: postEntityRole,
    onSuccess: (_data, variables) => {
      queryClient.refetchQueries({ queryKey: ["roles"] });
      form.reset(roleFormValues(variables));
      toast.success("Role created");
      onClose();
    },
    onError: () => toast.error("Failed to create role"),
  });

  const updateMutation = useMutation({
    mutationFn: patchEntityRole,
    onSuccess: (_data, variables) => {
      queryClient.refetchQueries({ queryKey: ["roles"] });
      form.reset(roleFormValues(variables));
      toast.success("Role updated");
      onClose();
    },
    onError: () => toast.error("Failed to update role"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteEntityRole,
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ["roles"] });
      toast.success("Role deleted");
      onClose();
    },
    onError: () => toast.error("Failed to delete role"),
  });

  const handleSubmit = useCallback(
    async (data: RoleForm) => {
      const role = {
        name: data.name,
        description: data.description ?? "",
        users: data.users ?? [],
        ...roleSettings(data),
      };
      if (mode === "edit" && initialData) {
        await updateMutation.mutateAsync({ ...initialData, ...role });
      } else {
        await createMutation.mutateAsync({
          ...role,
          uuid: crypto.randomUUID(),
          createdAt: Date.now(),
        });
      }
    },
    [mode, initialData, updateMutation.mutateAsync, createMutation.mutateAsync],
  );

  const handleDelete = useCallback(async () => {
    if (initialData) {
      await deleteMutation.mutateAsync(initialData.uuid);
    }
    setDeleteConfirmOpen(false);
  }, [deleteMutation.mutateAsync, initialData]);

  const users = form.watch("users") ?? [];

  // Track the AddUsersSelect dropdown's open state. Close intents fired while
  // the dropdown is open (or in the same event window where the dropdown is
  // closing) are dismiss-dropdown clicks — not Dialog-close intents — so we
  // swallow them here. Without this, clicking the Dialog backdrop to dismiss
  // the dropdown also tries to close the Dialog and pops the discard confirm.
  const dropdownStateRef = useRef({ isOpen: false, closedAt: 0 });

  const handleAddUsersOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen && dropdownStateRef.current.isOpen) {
      dropdownStateRef.current.closedAt = Date.now();
    }
    dropdownStateRef.current.isOpen = isOpen;
  }, []);

  const requestClose = useCallback(() => {
    if (
      dropdownStateRef.current.isOpen ||
      Date.now() - dropdownStateRef.current.closedAt < 150
    ) {
      return;
    }
    if (form.formState.isDirty) {
      setDiscardConfirmOpen(true);
    } else {
      onClose();
    }
  }, [form, onClose]);

  const handleDiscard = useCallback(() => {
    form.reset(roleFormValues(initialData));
    setDiscardConfirmOpen(false);
    onClose();
  }, [form, initialData, onClose]);

  // Memoised member list for the dialog body — avoids O(n·m) .find on each
  // re-render now that every checkbox tick re-renders the parent.
  const filteredUsersList = useMemo(() => {
    return users
      .map((userEmail) => {
        const userInfo = entityUsers.find((user) => user.email === userEmail);
        if (!userInfo) return null;
        const matchesSearch =
          userInfo.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
          userInfo.name.toLowerCase().includes(searchQuery.toLowerCase());
        if (!matchesSearch) return null;
        return {
          email: userEmail,
          name: userInfo.name,
          initials: getUserInitials(userInfo.name),
          color: colorForEmail(userEmail),
        };
      })
      .filter(Boolean) as Array<{
      email: string;
      name: string;
      initials: string;
      color: string;
    }>;
  }, [users, entityUsers, searchQuery]);

  const isSaving =
    createMutation.isPending || updateMutation.isPending || form.formState.isSubmitting;

  const title = mode === "create" ? "Create role" : "Edit role";
  const saveLabel = isSaving
    ? "Saving…"
    : mode === "create"
      ? "Create role"
      : "Save changes";

  return (
    <>
      <BaseDialog
        open={open}
        onClose={requestClose}
        onPointerDownOutside={(e) => e.preventDefault()}
        className="max-w-md lg:max-w-3xl xl:max-w-5xl max-h-[760px] overflow-y-auto"
      >
        <div className="flex items-center gap-2">
          <DialogTitle
            className={cn({
              "pr-0": form.formState.isDirty,
            })}
          >
            {title}
          </DialogTitle>
          {form.formState.isDirty && (
            <Tag color="grey" className="shrink-0">
              Unsaved
            </Tag>
          )}
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="mb-4 flex flex-col gap-2">
              <FormField
                name="name"
                control={form.control}
                render={({ field }) => (
                  <FormInput
                    label="Name"
                    className="h-8"
                    placeholder="Enter name"
                    error={!!form.formState.errors.name}
                    message={form.formState.errors.name?.message}
                    {...field}
                  />
                )}
              />

              <FormField
                name="description"
                control={form.control}
                render={({ field }) => (
                  <FormTextarea
                    label={
                      <p>
                        Description
                        <span className="text-ds-text-caption italic"> (optional)</span>
                      </p>
                    }
                    placeholder="Describe the purpose of this role"
                    {...field}
                  />
                )}
              />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-4 gap-y-2">
                <FormField
                  name="sharing"
                  control={form.control}
                  render={({ field }) => (
                    <FormSelect label="Sharing" options={SHARING_OPTIONS} {...field} />
                  )}
                />
                {LIMIT_FIELDS.map(({ name, label }) => {
                  const none = form.watch(`${name}.none`);
                  return (
                    <div key={name} className="flex flex-col gap-1">
                      <FormField
                        name={`${name}.value`}
                        control={form.control}
                        render={({ field }) => (
                          <FormInput
                            type="number"
                            label={label}
                            className="h-8"
                            disabled={none}
                            placeholder={none ? "No limit" : "Enter a whole number"}
                            error={!none && !!form.formState.errors[name]?.value}
                            message={
                              none
                                ? undefined
                                : form.formState.errors[name]?.value?.message
                            }
                            {...field}
                            value={none ? "" : field.value}
                          />
                        )}
                      />
                      <FormField
                        name={`${name}.none`}
                        control={form.control}
                        render={({ field }) => (
                          <Checkbox
                            label="No limit"
                            aria-label={`${label}: no limit`}
                            labelClassName="max-w-none whitespace-nowrap ml-1"
                            checked={field.value}
                            onCheckedChange={(checked) => {
                              field.onChange(checked === true);
                              form.trigger(name);
                            }}
                          />
                        )}
                      />
                    </div>
                  );
                })}
              </div>

              <FormField
                name="excel_add_in"
                control={form.control}
                render={({ field }) => (
                  <Checkbox
                    label="Excel add-in"
                    labelClassName="max-w-none whitespace-nowrap ml-1"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                )}
              />

              <div className="space-y-2.5">
                <FormField
                  name="users"
                  control={form.control}
                  render={({ field }) => (
                    <AddUsersSelect
                      value={field.value}
                      onChange={field.onChange}
                      entityUsers={entityUsers}
                      isLoading={isLoadingUsers}
                      onOpenChange={handleAddUsersOpenChange}
                    />
                  )}
                />
                <div
                  className={cn(
                    "flex flex-col h-[260px] gap-2 bg-general-bg-secondary p-2.5 rounded",
                    {
                      "items-center justify-center": users.length === 0,
                    },
                  )}
                >
                  {users.length > 0 && (
                    <Input
                      placeholder="Search members"
                      value={searchQuery}
                      prefix={<Icon id="search" />}
                      onChange={(value) => setSearchQuery(value.toString())}
                    />
                  )}
                  {users.length === 0 ? (
                    <p className="body-xs-regular text-ds-text-caption">
                      No members added yet
                    </p>
                  ) : (
                    <div className="flex flex-col h-full">
                      <p className="mb-2.5 text-2xs text-ds-text-caption uppercase tracking-wide">
                        MEMBERS ({users.length})
                      </p>
                      <hr />
                      <div className="flex flex-col gap-2.5 mt-2.5 text-2xs max-h-[calc(260px-100px)] overflow-y-auto">
                        {filteredUsersList.length === 0 && searchQuery ? (
                          <p
                            role="status"
                            className="text-ds-text-caption body-xs-regular py-2"
                          >
                            No members match "{searchQuery}"
                          </p>
                        ) : (
                          filteredUsersList.map((user) => (
                            <div
                              key={user.email}
                              className="flex items-center gap-2.5 justify-between"
                            >
                              <div className="flex items-center gap-2.5 flex-1">
                                <div
                                  className="ws-avatar-user"
                                  style={{
                                    backgroundColor: user.color,
                                  }}
                                >
                                  {user.initials}
                                </div>
                                <div className="flex flex-col">
                                  <span className="font-medium text-general-label">
                                    {user.name}
                                  </span>
                                  <span className="text-ds-text-caption">
                                    {user.email}
                                  </span>
                                </div>
                              </div>
                              <Tooltip position="top" message="Remove user from role">
                                <button
                                  className="mr-3"
                                  type="button"
                                  aria-label={`Remove ${user.name || user.email} from role`}
                                  onClick={() => {
                                    const newUsers = users.filter(
                                      (email) => email !== user.email,
                                    );
                                    form.setValue("users", newUsers, {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                    });
                                  }}
                                >
                                  <Icon
                                    id="trash-02"
                                    className="text-ds-text-caption"
                                  />
                                </button>
                              </Tooltip>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter>
              {mode === "edit" && (
                <Button
                  variant="danger"
                  size="sm"
                  type="button"
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="mr-auto"
                  disabled={isSaving}
                >
                  Delete role
                </Button>
              )}
              <Button
                variant="outlined"
                size="sm"
                type="button"
                onClick={requestClose}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  !form.formState.isValid || !form.formState.isDirty || isSaving
                }
                size="sm"
                type="submit"
              >
                {saveLabel}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </BaseDialog>

      <ConfirmDialog
        open={discardConfirmOpen}
        onClose={() => setDiscardConfirmOpen(false)}
        title="Discard changes?"
        description="Any unsaved changes will be lost."
        confirmButton={
          <Button variant="danger" size="sm" onClick={handleDiscard}>
            Discard
          </Button>
        }
        cancelText="Keep editing"
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete role"
        description="Are you sure you want to continue? This role will be permanently deleted."
        confirmButton={
          <Button variant="danger" size="sm" onClick={handleDelete}>
            Yes, Delete
          </Button>
        }
        cancelText="Cancel"
      />
    </>
  );
}
