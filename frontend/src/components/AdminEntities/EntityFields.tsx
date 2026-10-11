import { useFormContext } from "react-hook-form";
import { Checkbox } from "~/components/ds/atoms/Checkbox";
import { FormInput } from "~/components/ds/atoms/Input";
import { FormSelect } from "~/components/ds/atoms/Select";
import { FormField } from "~/components/ds/molecules/Form";
import {
  BUNDLE_OPTIONS,
  type EntitlementFormValues,
  type EntityFormValues,
  type NewEntityFormValues,
  SHARE_WIDGETS_OPTIONS,
  TIER_OPTIONS,
} from "./entityForms";

type Option = { value: string; label: string };

/** The fields every entity has. Has to be inside a form that holds `EntityFormValues`. */
export function EntityBaseFields({
  entityTypeOptions,
}: {
  entityTypeOptions: Option[];
}) {
  const { control } = useFormContext<EntityFormValues>();
  return (
    <>
      <FormField
        name="name"
        control={control}
        render={({ field }) => <FormInput label="Name" {...field} />}
      />
      <FormField
        name="entityTypeUuid"
        control={control}
        render={({ field }) => (
          <FormSelect
            label="Entity type"
            placeholder="Select an entity type"
            options={entityTypeOptions}
            {...field}
          />
        )}
      />
      <FormField
        name="email"
        control={control}
        render={({ field }) => <FormInput label="Business email" {...field} />}
      />
      <FormField
        name="companyType"
        control={control}
        render={({ field }) => <FormInput label="Company type" {...field} />}
      />
      <FormField
        name="organizationSize"
        control={control}
        render={({ field }) => <FormInput label="Organization size" {...field} />}
      />
      <FormField
        name="aum"
        control={control}
        render={({ field }) => <FormInput type="number" label="AUM" {...field} />}
      />
      <FormField
        name="country"
        control={control}
        render={({ field }) => <FormInput label="Country" {...field} />}
      />
      <FormField
        name="seats"
        control={control}
        render={({ field }) => <FormInput type="number" label="Seats" {...field} />}
      />
      <FormField
        name="expirationDate"
        control={control}
        render={({ field }) => (
          <FormInput type="date" label="Expiration date" {...field} />
        )}
      />
    </>
  );
}

/** The administrator that a new entity starts with. */
export function EntityAdminFields() {
  const { control } = useFormContext<NewEntityFormValues>();
  return (
    <>
      <FormField
        name="adminFirstName"
        control={control}
        render={({ field }) => <FormInput label="Admin first name" {...field} />}
      />
      <FormField
        name="adminLastName"
        control={control}
        render={({ field }) => <FormInput label="Admin last name" {...field} />}
      />
      <FormField
        name="adminEmail"
        control={control}
        render={({ field }) => <FormInput label="Admin email" {...field} />}
      />
    </>
  );
}

const FLAGS: { name: keyof EntitlementFormValues; label: string }[] = [
  { name: "bring_your_own_data", label: "Bring your own data" },
  { name: "bring_your_own_copilot", label: "Bring your own copilot" },
  { name: "allow_custom_backends", label: "Allow custom backends" },
  { name: "search_web", label: "Copilot may search the web (SEARCH_WEB)" },
  {
    name: "fetch_from_web",
    label: "Copilot may read pages from the web (FETCH_FROM_WEB)",
  },
  { name: "admin_access", label: "Admin access" },
  { name: "support", label: "Support" },
  { name: "excel_add_in", label: "Excel add-in" },
  { name: "data_add_ons_redistribution", label: "Data add-ons redistribution" },
];

/** What the users of an entity are entitled to. Needs a form that holds `EntitlementFormValues`. */
export function EntityEntitlementFields() {
  const { control } = useFormContext<EntitlementFormValues>();
  return (
    <>
      <FormField
        name="tier"
        control={control}
        render={({ field }) => (
          <FormSelect label="Tier" options={TIER_OPTIONS} {...field} />
        )}
      />
      <FormField
        name="bundle_name"
        control={control}
        render={({ field }) => (
          <FormSelect label="Data bundle" options={BUNDLE_OPTIONS} {...field} />
        )}
      />
      <FormField
        name="number_copilot_calls_day"
        control={control}
        render={({ field }) => (
          <FormInput type="number" label="Copilot queries per day" {...field} />
        )}
      />
      <FormField
        name="number_copilot_tokens_day"
        control={control}
        render={({ field }) => (
          <FormInput
            type="number"
            label="Copilot tokens per day"
            message="Leave empty for no limit"
            {...field}
          />
        )}
      />
      <FormField
        name="total_file_upload_size_gb"
        control={control}
        render={({ field }) => (
          <FormInput type="number" label="Total file upload size (GB)" {...field} />
        )}
      />
      <FormField
        name="share_widgets"
        control={control}
        render={({ field }) => (
          <FormSelect
            label="Share widgets"
            options={SHARE_WIDGETS_OPTIONS}
            {...field}
          />
        )}
      />
      {FLAGS.map(({ name, label }) => (
        <FormField
          key={name}
          name={name}
          control={control}
          render={({ field }) => (
            <Checkbox
              label={label}
              labelClassName="max-w-none whitespace-nowrap ml-1"
              checked={field.value === true}
              onCheckedChange={field.onChange}
            />
          )}
        />
      ))}
    </>
  );
}
