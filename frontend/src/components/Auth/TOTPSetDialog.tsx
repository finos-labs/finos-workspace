import { QRCodeSVG } from "qrcode.react";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { toast } from "sonner";
import { activateTotp, generateQRCode } from "~/api/auth.api";
import TOTPEnterForm from "~/components/Auth/TOTPEnterForm";
import { Button } from "../ds/atoms/Button";
import { BaseDialog } from "../ds/dialogs/BaseDialog";
import { DialogTitle } from "../ds/dialogs/Dialog";

export default function TOTPSetDialog({
  open,
  setOpen,
  onCancel,
  fromSettings = false,
  activate = activateTotp,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  onCancel: () => void;
  fromSettings?: boolean;
  activate?: (totp_token: number) => Promise<number>;
}) {
  const [token, setToken] = useState<{ uri: string; secret: string }>({
    uri: "",
    secret: "",
  });
  const [loading, setLoading] = useState(false);

  const onSubmitBegin = useCallback(
    async (e?: ReactMouseEvent) => {
      e?.preventDefault();
      setLoading(true);
      const data = await generateQRCode();
      if (data) {
        setToken(data);
      } else {
        toast.error("Failed to generate QR code.");
      }
      setLoading(false);
    },
    [setToken, setLoading],
  );

  useEffect(() => {
    if (!token.uri && open && fromSettings) onSubmitBegin();
  }, [fromSettings, open]);

  return (
    <BaseDialog open={open} className="[&>.DialogXButton]:hidden">
      <DialogTitle>Enter 2FA Code</DialogTitle>
      {token.uri ? (
        <>
          <p className="py-2">
            Scan the QR code below with your authenticator app to set up two factor
            authentication. If your app does not support QR codes, you can manually
            enter this secret <strong>{token.secret}</strong>.
          </p>
          <div className="flex flex-col items-center align-middle pb-4">
            <QRCodeSVG
              value={token.uri}
              size={256}
              level="H"
              marginSize={4}
              className="rounded-md"
            />
          </div>
          <TOTPEnterForm
            onCancel={onCancel}
            handleClose={() => setOpen(false)}
            handleSubmit={activate}
            isActive={false}
          />
        </>
      ) : (
        !fromSettings && (
          <div className="w-full mx-auto md:w-[408px]">
            <p className="py-2">
              Your company requires two factor authentication. Please click below to
              begin.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <Button
                variant="outlined"
                size="sm"
                disabled={loading}
                onClick={onCancel}
                type="button"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                size="sm"
                disabled={loading}
                onClick={onSubmitBegin}
              >
                Generate Token
              </Button>
            </div>
          </div>
        )
      )}
    </BaseDialog>
  );
}
