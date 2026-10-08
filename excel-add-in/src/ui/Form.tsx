import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
  useId,
} from "react";
import { Controller, FormProvider, useFormContext } from "react-hook-form";

/** Shares a react-hook-form instance with the fields below it. */
export const Form = FormProvider;

/** Connects a field to the form of the surrounding `<Form>`. */
export const FormField = Controller;

export function FormItem({ children }: { children: ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

export function FormControl({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

interface InputProps extends ComponentPropsWithoutRef<"input"> {
  label: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, className, ...props },
  ref,
) {
  const id = useId();
  const { getFieldState, formState } = useFormContext();
  const error = props.name
    ? getFieldState(props.name, formState).error?.message
    : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs text-grey-400">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        className={`h-9 w-full rounded border bg-dark-800 px-3 text-xs text-grey-100 placeholder:text-grey-600 focus:outline-none focus:ring-1 focus:ring-light-blue-400 ${
          error ? "border-red-500" : "border-dark-400"
        } ${className ?? ""}`}
        {...props}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
});

interface CheckboxProps {
  label: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function Checkbox({ label, checked, onCheckedChange }: CheckboxProps) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked ?? false}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
        className="size-4 accent-light-blue-400"
      />
      <label htmlFor={id} className="text-xs text-grey-400">
        {label}
      </label>
    </div>
  );
}
