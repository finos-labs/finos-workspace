import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ds/atoms/Button";
import { BaseDialog } from "~/components/ds/dialogs/BaseDialog";
import { DialogTitle } from "~/components/ds/dialogs/Dialog";
import { useMcpToolsStore } from "~/lib/state/mcpTools";
import { useShallowThemeStore, useThemeStore } from "~/lib/state/theme";

const POPUP_POLL_MS = 500;
const CANCEL_GRACE_MS = 1000;

type Step = "confirm" | "waiting" | "blocked";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function cancelSignIn(url: string) {
  const server = useMcpToolsStore.getState().servers.find((s) => s.url === url);
  if (server) useMcpToolsStore.getState().disableServerAfterAuthCancel(server.id);
  useThemeStore.getState().setMcpAuthPopup(null);
}

export default function McpAuthPopup() {
  const mcpAuthPopup = useShallowThemeStore((s) => s.mcpAuthPopup);
  const [step, setStep] = useState<Step>("confirm");
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    setStep("confirm");
    popupRef.current = null;
  }, [mcpAuthPopup?.authUrl]);

  const openSignIn = useCallback(() => {
    if (!mcpAuthPopup) return;
    const { authUrl, popupFeatures, url } = mcpAuthPopup;
    const popup = window.open(
      "about:blank",
      `mcp_auth_${encodeURIComponent(url)}`,
      popupFeatures,
    );
    if (!popup) {
      setStep("blocked");
      return;
    }
    try {
      popup.opener = null;
    } catch {}
    popup.location.href = authUrl;
    popup.focus();
    popupRef.current = popup;
    setStep("waiting");
  }, [mcpAuthPopup]);

  useEffect(() => {
    if (step !== "waiting" || !mcpAuthPopup) return;
    const { url } = mcpAuthPopup;
    let graceTimer: number | undefined;
    const interval = window.setInterval(() => {
      if (!popupRef.current?.closed) return;
      window.clearInterval(interval);
      popupRef.current = null;
      graceTimer = window.setTimeout(() => {
        if (useThemeStore.getState().mcpAuthPopup?.url === url) cancelSignIn(url);
      }, CANCEL_GRACE_MS);
    }, POPUP_POLL_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(graceTimer);
    };
  }, [step, mcpAuthPopup]);

  const serverName = mcpAuthPopup?.serverName || "the MCP server";
  const onCancel = () => mcpAuthPopup && cancelSignIn(mcpAuthPopup.url);

  return (
    <BaseDialog open={!!mcpAuthPopup} onClose={onCancel}>
      <DialogTitle>Sign in to {serverName}</DialogTitle>
      {mcpAuthPopup && (
        <div className="flex flex-col gap-4 p-4">
          {step === "confirm" && (
            <p>
              {serverName} asks you to sign in at{" "}
              <strong className="break-all">{hostOf(mcpAuthPopup.authUrl)}</strong>.
              Continue only if you trust this address.
            </p>
          )}
          {step === "waiting" && (
            <p>
              Finish signing in in the window that opened. This closes when you are
              done.
            </p>
          )}
          {step === "blocked" && (
            <p>
              Your browser blocked the sign-in window. Open the sign-in page at{" "}
              <a
                href={mcpAuthPopup.authUrl}
                className="text-brand-main hover:text-brand-darker underline break-all"
                target="_blank"
                rel="noopener noreferrer"
              >
                {hostOf(mcpAuthPopup.authUrl)}
              </a>
              .
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="outlined" size="sm" type="button" onClick={onCancel}>
              Cancel
            </Button>
            {step !== "blocked" && (
              <Button variant="primary" size="sm" type="button" onClick={openSignIn}>
                {step === "waiting" ? "Open again" : "Sign in"}
              </Button>
            )}
          </div>
        </div>
      )}
    </BaseDialog>
  );
}
