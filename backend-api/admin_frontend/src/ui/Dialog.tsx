import { type ReactNode, useEffect, useRef } from "react";

interface BaseDialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** A modal on the browser's own `<dialog>`: it traps focus, closes on Escape and dims the page. */
export function BaseDialog({ open, onClose, children }: BaseDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog itself, not on its content
        if (event.target === ref.current) onClose();
      }}
      className="m-auto w-full max-w-lg rounded-lg border border-general-border-primary bg-general-bg-primary p-0 text-ds-text-body shadow-lg backdrop:bg-black/60"
    >
      <div className="relative space-y-4 p-5">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-3 top-3 text-general-label hover:text-general-label-hover"
        >
          ×
        </button>
        {children}
      </div>
    </dialog>
  );
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold text-ds-text-heading">{children}</h2>;
}
