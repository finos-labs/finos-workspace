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

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} role="alert" className="text-xs text-ds-text-danger">
      {message}
    </p>
  ) : null;
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
  const errorId = `${id}-error`;
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  const borderClass = error ? "border-red-500" : "border-general-border-primary";
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div
        className={
          isPassword
            ? `flex h-9 items-center rounded border bg-general-bg-secondary focus-within:ring-1 focus-within:ring-link-color ${borderClass}`
            : undefined
        }
      >
        <input
          id={id}
          ref={ref}
          type={isPassword && revealed ? "text" : type}
          value={value ?? ""}
          className={
            isPassword
              ? `h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-xs text-ds-text-body outline-none placeholder:text-general-label-disabled ${className ?? ""}`
              : `${controlClass} ${borderClass} ${className ?? ""}`
          }
          {...props}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {isPassword && (
          <button
            type="button"
            aria-label={revealed ? "Hide password" : "Show password"}
            onClick={() => setRevealed((shown) => !shown)}
            className="shrink-0 rounded px-3 text-xs font-medium text-ds-text-body hover:text-general-label-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link-color"
          >
            {revealed ? "Hide" : "Show"}
          </button>
        )}
      </div>
      <FieldError id={errorId} message={error} />
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
    const errorId = `${id}-error`;
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
        <select
          id={id}
          ref={ref}
          value={value ?? ""}
          className={`${controlClass} ${error ? "border-red-500" : "border-general-border-primary"} ${className ?? ""}`}
          {...props}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
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
        <FieldError id={errorId} message={error} />
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
