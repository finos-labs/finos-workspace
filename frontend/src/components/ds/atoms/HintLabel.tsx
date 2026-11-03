import React, { type ReactNode } from "react";
import Tooltip from "~/components/Tooltip";
import { cn } from "../utils";

interface HintLabelProps {
  children: ReactNode;
  tooltip: string | ReactNode;
  disabled?: boolean;
  tooltipClassName?: string;
  tooltipPosition?: "top" | "bottom" | "left" | "right";
  tooltipAlign?: "start" | "center" | "end";
  tooltipSideOffset?: number;
  className?: string;
}

export const HintLabel = React.forwardRef<HTMLSpanElement, HintLabelProps>(
  (
    {
      children,
      tooltip,
      disabled,
      tooltipClassName,
      tooltipPosition,
      tooltipAlign,
      tooltipSideOffset,
      className,
    },
    ref,
  ) => {
    return (
      <Tooltip
        message={tooltip}
        className={tooltipClassName}
        position={tooltipPosition}
        align={tooltipAlign}
        sideOffset={tooltipSideOffset}
      >
        <span
          ref={ref}
          aria-disabled={disabled || undefined}
          className={cn(
            "select-none",
            disabled
              ? "text-general-label-disabled"
              : "text-general-label underline decoration-dotted underline-offset-2 decoration-general-border-primary",
            className,
          )}
        >
          {children}
        </span>
      </Tooltip>
    );
  },
);
HintLabel.displayName = "HintLabel";
