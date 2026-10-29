import type { FormEventHandler, ReactNode } from "react";
import AdminDialogFooter from "~/components/AdminUsers/common/AdminDialogFooter";
import { BaseDialog } from "~/components/ds/dialogs/BaseDialog";
import { DialogHeader, DialogTitle } from "~/components/ds/dialogs/Dialog";

interface FormDialogProps {
  title: string;
  onClose: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  submitLabel: string;
  isSubmitting: boolean;
  error: string | null;
  children: ReactNode;
}

export function FormDialog({
  title,
  onClose,
  onSubmit,
  submitLabel,
  isSubmitting,
  error,
  children,
}: FormDialogProps) {
  return (
    <BaseDialog
      open={true}
      onClose={onClose}
      className="max-w-xs lg:max-w-xl"
      modal={true}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate={true}>
        <div className="space-y-6 pb-2 max-h-[65vh] overflow-y-auto pr-1">
          {children}
        </div>
        {error && (
          <p role="alert" className="text-alert-error body-xs-regular pt-3">
            {error}
          </p>
        )}
        <AdminDialogFooter
          primaryButtonName={submitLabel}
          primaryButtonDisabled={isSubmitting}
          className="pt-4"
        />
      </form>
    </BaseDialog>
  );
}
