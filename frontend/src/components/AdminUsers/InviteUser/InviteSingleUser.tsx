import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { createUser, inviteUser, type PasswordLinkAnswer } from "~/api/admin.api";
import { getEntityRoles } from "~/api/entity_roles.api";
import { getErrorResponse } from "~/api/errors";
import AdminDialogFooter from "~/components/AdminUsers/common/AdminDialogFooter";
import PasswordLink from "~/components/AdminUsers/PasswordLink";
import { Button } from "~/components/ds/atoms/Button";
import { Checkbox } from "~/components/ds/atoms/Checkbox";
import { FormInput } from "~/components/ds/atoms/Input";
import { FormSelect } from "~/components/ds/atoms/Select";
import { DialogFooter } from "~/components/ds/dialogs/Dialog";
import { Form, FormField } from "~/components/ds/molecules/Form";
import { TabsContent } from "~/components/ds/molecules/Tabs";
import Icon from "~/components/Icon";
import Tooltip from "~/components/Tooltip";
import type { CreateUserDTO } from "~/types/user.type";

const userFormSchemaBase = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email(),
  bypass_invitation: z.boolean(),
  role: z.string().nullish(),
});

export type TUserForm = z.infer<typeof userFormSchemaBase>;

export default function InviteSingleUser({
  permissions,
  onClose,
}: {
  permissions: string;
  onClose: () => void;
}) {
  const userFormRef = useRef<HTMLFormElement>(null);
  const [errorMessage, setErrorMessage] = useState<null | string>(null);
  // The user added without an invitation, and the link to give them
  const [added, setAdded] = useState<{
    name: string;
    answer: PasswordLinkAnswer;
  } | null>(null);

  const queryClient = useQueryClient();

  // Fetch roles from the API
  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ["roles"],
    enabled: true,
    queryFn: getEntityRoles,
    staleTime: 1000 * 60 * 5,
  });

  // Transform roles data for the dropdown
  const roleOptions = useMemo(
    () => roles.map((role) => ({ label: role.name, value: role.uuid })),
    [roles],
  );

  const userForm = useForm<TUserForm>({
    resolver: zodResolver(userFormSchemaBase),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      role: "",
      bypass_invitation: true,
    },
  });

  const handleSubmit = useCallback(
    async (values: TUserForm) => {
      const dto: CreateUserDTO = {
        first_name: values.first_name,
        last_name: values.last_name,
        email: values.email,
        permissions_uuid: permissions,
        role: values.role || null,
      };
      const name = `${values.first_name} ${values.last_name}`;
      const refetch = () => {
        queryClient.refetchQueries({ queryKey: ["admin", "users"] });
        queryClient.refetchQueries({ queryKey: ["roles"] });
      };
      try {
        if (values.bypass_invitation) {
          const answer = await createUser(dto);
          if (answer.success) {
            refetch();
            // The dialog shows the link until the admin is done with it
            setAdded({ name, answer });
          }
          return;
        }
        const res = await inviteUser(dto);
        if (res.success) {
          refetch();
          toast.success("User invited", {
            description: `User ${name} has been invited.`,
          });
          onClose();
        }
      } catch (error) {
        const data = getErrorResponse(error).data;
        setErrorMessage(String(data.detail || "Unable to register the user"));
        return;
      }
    },
    [onClose, permissions, queryClient.refetchQueries],
  );

  if (added) {
    return (
      <TabsContent value="single">
        <div
          data-testid="added-user"
          className="flex flex-col gap-3 pb-6 body-xs-medium"
        >
          <p>{added.name} has been added to the organization.</p>
          <PasswordLink link={added.answer.link} expiresAt={added.answer.expires_at} />
        </div>
        <DialogFooter className="pr-0">
          <Button size="sm" variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </TabsContent>
    );
  }

  return (
    <TabsContent value="single">
      <Form {...userForm}>
        <form ref={userFormRef} onSubmit={userForm.handleSubmit(handleSubmit)}>
          <div className="space-y-6 pb-2">
            <FormField
              name="first_name"
              control={userForm.control}
              render={({ field }) => <FormInput label="First name" {...field} />}
            />
            <FormField
              name="last_name"
              control={userForm.control}
              render={({ field }) => <FormInput label="Last name" {...field} />}
            />
            <FormField
              name="email"
              control={userForm.control}
              render={({ field }) => <FormInput label="Email address" {...field} />}
            />
            {roleOptions.length > 0 && (
              <FormField
                name="role"
                control={userForm.control}
                render={({ field }) => (
                  <FormSelect
                    label="Role (Optional)"
                    placeholder="Select a role"
                    options={roleOptions}
                    {...field}
                    value={field.value ?? undefined}
                  />
                )}
              />
            )}
            <FormField
              name="bypass_invitation"
              control={userForm.control}
              render={({ field }) => (
                <div className="flex items-center gap-1.5 pb-6">
                  <Checkbox
                    label="Bypass invitation"
                    className="text-ds-text-caption"
                    labelClassName="max-w-none whitespace-nowrap ml-1"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                  <Tooltip
                    message="By selecting this option, the user will be added to the organization without the need to accept an invitation."
                    position="top"
                  >
                    <button type="button" className="inline-flex">
                      <Icon id="help-outline-circle" className="text-ds-text-caption" />
                    </button>
                  </Tooltip>
                </div>
              )}
            />
          </div>
          {errorMessage && <p className="text-alert-error pb-6">{errorMessage}</p>}
          <AdminDialogFooter
            primaryButtonName={userForm.watch("bypass_invitation") ? "Add" : "Invite"}
            className="pr-0"
            primaryButtonDisabled={!userForm.formState.isValid}
          />
        </form>
      </Form>
    </TabsContent>
  );
}
