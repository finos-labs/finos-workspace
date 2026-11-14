import { useId } from "react";
import { Checkbox } from "~/components/ds/atoms/Checkbox";
import { Input } from "~/components/ds/atoms/Input";
import { Label } from "~/components/ds/atoms/Label";
import { Select } from "~/components/ds/atoms/Select";
import { Textarea } from "~/components/ds/atoms/TextArea";
import { cn } from "~/components/ds/utils";
import Icon from "~/components/Icon";
import Tooltip from "~/components/Tooltip";
import { LIMITS } from "~/lib/types/widgetsContract";
import { MAX_SETTING_LENGTH, type SettingsSchema } from "./types";

function Heading({ label, hint }: { label: string; hint?: string }) {
  if (!hint) return label;
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Tooltip message={hint} position="top" align="start" className="max-w-xs">
        <button
          type="button"
          aria-label={`About ${label}`}
          className="inline-flex cursor-help text-ds-text-caption hover:text-general-label"
        >
          <Icon id="info-circled-icon" className="size-3.5" />
        </button>
      </Tooltip>
    </span>
  );
}

export function SettingsForm(props: {
  schema: SettingsSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
  title?: string;
}) {
  const { schema, values, onChange, disabled, title } = props;
  const formId = useId();
  const entries = Object.entries(schema.properties ?? {});
  if (!entries.length) return <p className="body-xs-regular">No settings.</p>;

  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  return (
    <div
      className={cn(
        "@container flex flex-col gap-4",
        title && "border-general-border-primary border-t pt-4",
      )}
    >
      {title ? <h3 className="body-sm-medium text-general-label">{title}</h3> : null}
      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 @sm:grid-cols-2 @2xl:grid-cols-3">
        {entries.map(([key, prop]) => {
          const label = prop.title ?? key;
          const value = values[key] ?? prop.default;
          const heading = <Heading label={label} hint={prop.description} />;

          if (Array.isArray(prop.enum)) {
            const options = prop.enum.map((option, index) => ({
              label: String(option),
              value: String(index),
            }));
            const selected = prop.enum.findIndex(
              (option) => String(option) === String(value),
            );
            return (
              <div key={key}>
                <Select
                  size="sm"
                  label={heading}
                  disabled={disabled}
                  options={options}
                  value={selected < 0 ? undefined : String(selected)}
                  placeholder="Select"
                  contentClassName="only-sm:z-[62]"
                  onChange={(index) => set(key, prop.enum?.[Number(index)])}
                />
              </div>
            );
          }

          if (prop.type === "boolean") {
            return (
              <div key={key}>
                <Label htmlFor={`${formId}-${key}`}>{heading}</Label>
                <div className="flex h-7 items-center">
                  <Checkbox
                    id={`${formId}-${key}`}
                    aria-label={label}
                    aria-description={prop.description}
                    checked={value === true}
                    disabled={disabled}
                    onCheckedChange={(on) => set(key, on === true)}
                  />
                </div>
              </div>
            );
          }

          if (prop.type === "number" || prop.type === "integer") {
            return (
              <div key={key}>
                <Input
                  size="sm"
                  type="number"
                  label={heading}
                  aria-label={label}
                  aria-description={prop.description}
                  clearable={false}
                  disabled={disabled}
                  value={typeof value === "number" ? value : ""}
                  min={prop.minimum}
                  max={prop.maximum}
                  step={prop.type === "integer" ? 1 : "any"}
                  onChange={(text) => set(key, text === "" ? undefined : Number(text))}
                />
              </div>
            );
          }

          return (
            <div key={key} className="@sm:col-span-2 @2xl:col-span-3">
              <Input
                size="sm"
                label={heading}
                aria-label={label}
                aria-description={prop.description}
                clearable={false}
                disabled={disabled}
                maxLength={prop.maxLength}
                value={typeof value === "string" ? value : ""}
                onChange={(text) => set(key, text)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type CardDetails = { name: string; description: string };

export function CardDetailsForm({
  values,
  onChange,
  disabled,
}: {
  values: CardDetails;
  onChange: (values: CardDetails) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Input
        size="sm"
        label="Name"
        clearable={false}
        value={values.name}
        maxLength={LIMITS.name}
        disabled={disabled}
        onChange={(name) => onChange({ ...values, name })}
      />
      <Textarea
        label="Description"
        value={values.description}
        maxLength={LIMITS.description}
        disabled={disabled}
        onChange={(description) => onChange({ ...values, description })}
      />
    </div>
  );
}

export function cleanSettings(
  schema: SettingsSchema | undefined,
  values: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const properties = schema?.properties ?? {};
  for (const [key, value] of Object.entries(values ?? {})) {
    const prop = properties[key];
    if (!prop || value === undefined) continue;
    if (Array.isArray(prop.enum)) {
      if (prop.enum.includes(value as never)) result[key] = value;
      continue;
    }
    if (prop.type === "boolean" && typeof value === "boolean") result[key] = value;
    else if (
      (prop.type === "number" || prop.type === "integer") &&
      typeof value === "number"
    )
      result[key] = prop.type === "integer" ? Math.trunc(value) : value;
    else if (prop.type === "string" && typeof value === "string")
      result[key] = value.slice(0, prop.maxLength ?? MAX_SETTING_LENGTH);
  }
  return result;
}
