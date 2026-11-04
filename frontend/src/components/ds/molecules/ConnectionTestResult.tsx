import Icon from "~/components/Icon";
import type { IconId } from "~/components/Icon.types";
import { cn } from "../utils";

type ConnectionTestStatus = "success" | "error";

const STATUS_STYLES: Record<
  ConnectionTestStatus,
  { box: string; accent: string; iconId: IconId; defaultTitle: string }
> = {
  success: {
    box: "bg-success-100/15 border-success-100/25",
    accent: "text-alert-success",
    iconId: "check-circle",
    defaultTitle: "Test successful",
  },
  error: {
    box: "bg-error-100/15 border-error-100/25",
    accent: "text-alert-error",
    iconId: "warning-icon",
    defaultTitle: "Error",
  },
};

interface ConnectionTestResultProps {
  status: ConnectionTestStatus;
  message: string;
  title?: string;
  className?: string;
}

export function ConnectionTestResult({
  status,
  message,
  title,
  className,
}: ConnectionTestResultProps) {
  const style = STATUS_STYLES[status];

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded border-2 p-4",
        style.box,
        className,
      )}
    >
      <Icon id={style.iconId} className={cn("h-5 w-5 flex-shrink-0", style.accent)} />
      <div className="flex flex-col gap-0.5">
        <p className="body-sm-medium text-ds-text-title">
          {title ?? style.defaultTitle}
        </p>
        <p className="body-xs-regular text-ds-text-body">{message}</p>
      </div>
    </div>
  );
}
