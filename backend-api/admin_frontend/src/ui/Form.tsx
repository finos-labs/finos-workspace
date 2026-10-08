import { type ComponentPropsWithoutRef, forwardRef, useId, useState } from "react";
import { Controller, FormProvider, useFormContext } from "react-hook-form";

/** Shares a react-hook-form instance with the fields below it. */
export const Form = FormProvider;

/** Connects a field to the form: `render` gets the `field` props to spread onto an input. */
export const FormField = Controller;

const labelClass = "block text-xs text-ds-text-subtitle";
const controlClass =
  "h-9 w-full rounded border bg-general-bg-secondary px-3 text-xs text-ds-text-body " +
  "placeholder:text-general-label-disabled focus:outline-none focus:ring-1 focus:ring-link-color";

function useFieldError(name: string | undefined): string | undefined {
  const { getFieldState, formState } = useFormContext();
  return name ? getFieldState(name, formState).error?.message : undefined;
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? <p className="text-xs text-red-500">{message}</p> : null;
}

interface FormInputProps extends ComponentPropsWithoutRef<"input"> {
  label: string;
}

export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(function FormInput(
  { label, className, value, type, ...props },
  ref,
) {
  const id = useId();
  const error = useFieldError(props.name);
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          ref={ref}
          type={isPassword && revealed ? "text" : type}
          value={value ?? ""}
          aria-invalid={error ? true : undefined}
          className={`${controlClass} ${error ? "border-red-500" : "border-general-border-primary"} ${isPassword ? "pr-14" : ""} ${className ?? ""}`}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={revealed ? "Hide password" : "Show password"}
            onClick={() => setRevealed((shown) => !shown)}
            className="absolute inset-y-0 right-0 px-3 text-xs text-ds-text-subtitle hover:text-general-label-hover"
          >
            {revealed ? "Hide" : "Show"}
          </button>
        )}
      </div>
      <FieldError message={error} />
    </div>
  );
});

interface SelectOption {
  value: string;
  label: string;
}

interface FormSelectProps extends Omit<ComponentPropsWithoutRef<"select">, "children"> {
  label: string;
  options: SelectOption[];
  placeholder?: string;
}

export const FormSelect = forwardRef<HTMLSelectElement, FormSelectProps>(
  function FormSelect({ label, options, placeholder, className, value, ...props }, ref) {
    const id = useId();
    const error = useFieldError(props.name);
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
        <select
          id={id}
          ref={ref}
          value={value ?? ""}
          aria-invalid={error ? true : undefined}
          className={`${controlClass} ${error ? "border-red-500" : "border-general-border-primary"} ${className ?? ""}`}
          {...props}
        >
          <option value="" disabled>
            {placeholder ?? ""}
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <FieldError message={error} />
      </div>
    );
  },
);

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
        className="size-4 accent-link-color"
      />
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
    </div>
  );
}
