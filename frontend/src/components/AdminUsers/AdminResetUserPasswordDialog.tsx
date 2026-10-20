import { AxiosError } from "axios";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { type PasswordLinkAnswer, resetUserPassword } from "~/api/admin.api";
import { getErrorResponse } from "~/api/errors";
import AdminDialogFooter from "~/components/AdminUsers/common/AdminDialogFooter";
import PasswordLink from "~/components/AdminUsers/PasswordLink";
import { Button } from "~/components/ds/atoms/Button";
import { DialogFooter } from "~/components/ds/dialogs/Dialog";
import type { User } from "~/types/user.type";
import { BaseDialog, type ClosableDialogProps } from "../ds/dialogs/BaseDialog";

interface Props extends ClosableDialogProps {
  user: User;
  onConfirm: () => void;
}

export default function AdminResetUserPasswordDialog(props: Props) {
  const { open, onClose, user, onConfirm } = props;
  const [reset, setReset] = useState<PasswordLinkAnswer | null>(null);

  const handleSubmit = useCallback(async () => {
    try {
      const result = await resetUserPassword(user.uuid);

      if (result.success) {
        setReset(result);
        onConfirm();
      }
    } catch (error) {
      console.error(getErrorResponse(error).data);
      if (error instanceof AxiosError) {
        toast.error("Error resetting user password", {
          description: error.response?.data?.detail || error.message,
        });
      }
    }
  }, [user.uuid, onConfirm]);

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      modal={true}
      className="w-fit max-w-md bg-general-bg-primary p-6 text-ds-text-heading [&>.DialogXButton]:top-6 [&>button.absolute]:top-6"
    >
      <span className="body-sm-bold">Reset password</span>
      <div data-testid="reset-password-dialog" className="pr-5 body-xs-medium">
        {reset ? (
          <div className="flex flex-col gap-3">
            <p>
              The password of {user.email} no longer works, and every session of the
              account has ended.
            </p>
            <PasswordLink link={reset.link} expiresAt={reset.expires_at} />
          </div>
        ) : (
          <p>
            Are you sure you want to reset the password for this account {user.email}?
          </p>
        )}
      </div>
      {reset ? (
        <DialogFooter>
          <Button size="sm" variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      ) : (
        <AdminDialogFooter
          primaryButtonName="Yes, reset password"
          onPrimaryButtonClick={handleSubmit}
          primaryButtonVariant="danger"
        />
      )}
    </BaseDialog>
  );
}
