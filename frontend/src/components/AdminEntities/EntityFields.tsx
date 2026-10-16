import { useFormContext } from "react-hook-form";
import { FormInput } from "~/components/ds/atoms/Input";
import { FormSelect } from "~/components/ds/atoms/Select";
import { Switch } from "~/components/ds/atoms/Switch";
import { FormField } from "~/components/ds/molecules/Form";
import type { EntityFormValues, NewEntityFormValues } from "./entityForms";

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
        name="sharingEnabled"
        control={control}
        render={({ field }) => (
          <div className="flex flex-col gap-1">
            <Switch
              label="Sharing enabled"
              checked={field.value}
              onCheckedChange={field.onChange}
            />
            <p className="body-xs-regular text-ds-text-caption">
              When off, no one in this organization can share or receive items, and
              existing shares are revoked.
            </p>
          </div>
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
