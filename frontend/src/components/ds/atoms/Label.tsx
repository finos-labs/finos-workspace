import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";
import React from "react";
import { cn } from "../utils";

const labelVariants = cva([
  "body-xs-regular mb-1 inline-block text-ds-text-caption",
  "group-aria-disabled:cursor-not-allowed group-aria-disabled:text-general-label-disabled",
  "peer-disabled:cursor-not-allowed peer-disabled:text-general-label-disabled",
]);

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => {
  if (!props.children) {
    return null;
  }
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(labelVariants(), className)}
      {...props}
    />
  );
});
Label.displayName = LabelPrimitive.Root.displayName;

interface MessageProps {
  className?: string;
  children?: React.ReactNode;
  error?: boolean;
}

export const Message = React.forwardRef<HTMLDivElement, MessageProps>(
  ({ className, error, ...props }, ref) => {
    if (!props.children) {
      return null;
    }
    return (
      <div
        ref={ref}
        className={cn(
          "body-xs-regular mt-1",
          error && "body-xs-medium text-alert-error",
          className,
        )}
        {...props}
      />
    );
  },
);
Message.displayName = "Message";
