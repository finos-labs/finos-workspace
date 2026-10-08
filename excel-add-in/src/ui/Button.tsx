import { type ComponentPropsWithoutRef, forwardRef } from "react";

export const Button = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button">
>(function Button({ className, ...props }, ref) {
  // No default `type`: inside a form a button submits it, as a native button does
  return (
    <button
      ref={ref}
      className={`_btn-tertiary ${className ?? ""}`}
      {...props}
    />
  );
});
