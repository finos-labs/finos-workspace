import type { PropsWithChildren } from "react";
import { cn } from "~/lib/utils";
import LocalIcon from "../Icon";
import Tooltip from "../Tooltip";

interface FeatureLockProps extends PropsWithChildren {
  isLocked: boolean;
  tooltipPosition?: "top" | "right" | "bottom" | "left";
  message?: string;
  className?: string;
}

export default function FeatureLock({
  children,
  isLocked,
  tooltipPosition = "right",
  message = "This feature is not available on your current plan.",
  className,
}: FeatureLockProps) {
  if (!isLocked) {
    return <>{children}</>;
  }

  return (
    <Tooltip
      message={message}
      position={tooltipPosition}
      className={cn("max-w-[157px]", className)}
    >
      <div className={cn("opacity-50 relative")}>
        <div className="pointer-events-none">{children}</div>
        <LocalIcon
          id="locker"
          data-testid="locker"
          className="text-brand-lighter absolute top-1/2 right-0 -translate-y-1/2"
        />
      </div>
    </Tooltip>
  );
}
