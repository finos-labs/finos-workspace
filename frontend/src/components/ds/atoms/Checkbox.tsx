import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import React from "react";
import Icon from "~/components/Icon";
import { cn } from "../utils";

interface CheckboxProps
  extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  label?: React.ReactNode;
  error?: boolean;
  checked?: boolean | "indeterminate";
  labelPosition?: "left" | "right";
  labelClassName?: string;
}

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>((props, ref) => {
  const {
    className,
    label,
    error,
    id: idProp,
    labelPosition = "right",
    labelClassName,
    ...rest
  } = props;
  const idHook = React.useId();

  const id = idProp || idHook;

  return (
    <div
      className={cn(
        "flex items-center gap-1",
        labelPosition === "left" && "flex-row-reverse",
      )}
    >
      <CheckboxPrimitive.Root
        ref={ref}
        className={cn(
          "BB-Checkbox group peer h-4 w-4 shrink-0 rounded-sm border",
          "transition",
          "disabled:cursor-not-allowed",

          "bg-general-bg-primary border-general-border-primary",
          "focus-visible:outline-hidden focus-visible:border-alert-informative",
          "disabled:bg-general-bg-primary-disabled disabled:border-general-border-primary",
          "data-error:border-alert-error!",

          "data-[state=checked]:bg-main-100 data-[state=checked]:border-main-100 data-[state=checked]:text-btn-primary-label",
          "data-[state=checked]:focus-visible:border-alert-informative",
          "data-[state=checked]:disabled:bg-general-bg-primary-disabled data-[state=checked]:disabled:border-general-border-primary data-[state=checked]:disabled:text-general-label-disabled",
          "data-[state=checked]:data-error:border-alert-error!",

          "data-[state=indeterminate]:bg-main-100 data-[state=indeterminate]:border-main-100 data-[state=indeterminate]:text-btn-primary-label",
          "data-[state=indeterminate]:focus-visible:border-alert-informative",
          "data-[state=indeterminate]:disabled:bg-general-bg-primary-disabled data-[state=indeterminate]:disabled:border-general-border-primary data-[state=indeterminate]:disabled:text-general-label-disabled",
          "data-[state=indeterminate]:data-error:border-alert-error!",

          className,
        )}
        id={id}
        data-error={error}
        {...rest}
      >
        <CheckboxPrimitive.Indicator
          className={cn("flex items-center justify-center text-current")}
        >
          <Icon
            id="check"
            className="hidden size-[12px] stroke-2 group-data-[state=checked]:block"
          />
          <Icon
            id="minus-icon"
            className="hidden size-[12px] stroke-2 group-data-[state=indeterminate]:block"
          />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label && (
        <label
          className={cn(
            "body-xs-regular cursor-pointer",
            "max-w-[calc(100%-1rem-0.5rem)]",
            "peer-disabled:cursor-not-allowed",
            "transition",
            "text-general-label",
            "peer-disabled:text-general-label-disabled",
            labelClassName,
          )}
          htmlFor={id}
        >
          {label}
        </label>
      )}
    </div>
  );
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
