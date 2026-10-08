import { describe, expect, it } from "vitest";
import { mapFormSchema } from "~/components/AdminEntities/EntityMapDialog";
import { relationshipFormSchema } from "~/components/AdminEntities/EntityRelationshipDialog";
import { entityTypeFormSchema } from "~/components/AdminEntities/EntityTypeDialog";
import {
  type EditEntityFormValues,
  editEntityFormSchema,
  entitlementBody,
  entitlementFormDefaults,
  entitlementFormSchema,
  entityBody,
  entityFormDefaults,
  entityFormSchema,
  newEntityFormDefaults,
  newEntityFormSchema,
  oneYearFrom,
} from "~/components/AdminEntities/entityForms";
import type { Entity } from "~/types/entity.type";

const TYPE_UUID = "7d4f3a52-1b1e-4c7a-9a43-3f7a2b1c9e10";
const OTHER_UUID = "0d1b9b0e-7c2b-4a58-8d63-5c1f6f0c8a21";

const ENTITY: Entity = {
  uuid: OTHER_UUID,
  name: "Acme",
  entity_type: {
    uuid: TYPE_UUID,
    entity_type: "On-Premise",
    code: "OPR",
    active: true,
    permission_hierarchy: 1,
  },
  email: "ops@acme.com",
  company_type: "Fund",
  country: "USA",
  aum: 5,
  organization_size: "Small",
  seats: 12,
  expiration_date: "2030-03-04T00:00:00",
};

describe("entity form", () => {
  const valid = entityFormDefaults(ENTITY);

  it("starts from the entity it edits", () => {
    expect(valid).toEqual({
      name: "Acme",
      entityTypeUuid: TYPE_UUID,
      email: "ops@acme.com",
      companyType: "Fund",
      organizationSize: "Small",
      aum: "5",
      country: "USA",
      seats: "12",
      expirationDate: "2030-03-04",
    });
    expect(entityFormSchema.safeParse(valid).success).toBe(true);
  });

  it("starts a new entity for a year, with a seat, and without an administrator", () => {
    const defaults = newEntityFormDefaults(new Date(2026, 9, 7));

    expect(defaults.expirationDate).toBe("2027-10-07");
    expect(defaults.seats).toBe("1");
    expect(defaults.adminEmail).toBe("");
    expect(newEntityFormSchema.safeParse(defaults).success).toBe(false);
  });

  it("counts a year from the day, whatever the month", () => {
    expect(oneYearFrom(new Date(2026, 0, 31))).toBe("2027-01-31");
    expect(oneYearFrom(new Date(2026, 11, 31))).toBe("2027-12-31");
  });

  it("asks for what is missing", () => {
    const result = entityFormSchema.safeParse({
      ...valid,
      name: " ",
      entityTypeUuid: "",
      email: "not an email",
    });

    expect(result.success).toBe(false);
    const fields = result.error?.issues.map((issue) => issue.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["name", "entityTypeUuid", "email"]));
  });

  it("refuses more seats than the backend takes, and text that is not a number", () => {
    expect(entityFormSchema.safeParse({ ...valid, seats: "10000" }).success).toBe(true);
    expect(entityFormSchema.safeParse({ ...valid, seats: "10001" }).success).toBe(
      false,
    );
    expect(entityFormSchema.safeParse({ ...valid, seats: "ten" }).success).toBe(false);
    expect(entityFormSchema.safeParse({ ...valid, aum: "1.5" }).success).toBe(false);
  });

  it("wants a date as YYYY-MM-DD", () => {
    expect(
      entityFormSchema.safeParse({ ...valid, expirationDate: "03/04/2030" }).success,
    ).toBe(false);
  });

  it("makes the request body out of the typed text", () => {
    expect(entityBody(valid)).toEqual({
      name: "Acme",
      entity_code: TYPE_UUID,
      email: "ops@acme.com",
      company_type: "Fund",
      organization_size: "Small",
      aum: 5,
      country: "USA",
      seats: 12,
      expiration_date: "2030-03-04",
    });
  });

  it("needs an administrator for a new entity", () => {
    const withAdmin = {
      ...valid,
      adminFirstName: "Ada",
      adminLastName: "Lovelace",
      adminEmail: "ada@acme.com",
    };

    expect(newEntityFormSchema.safeParse(withAdmin).success).toBe(true);
    expect(
      newEntityFormSchema.safeParse({ ...withAdmin, adminEmail: "ada" }).success,
    ).toBe(false);
  });
});

describe("entitlement form", () => {
  const entitlements = entitlementFormDefaults({
    tier: "basic",
    number_copilot_calls_day: 40,
    number_copilot_tokens_day: null,
    total_file_upload_size_gb: 3,
    share_widgets: "public",
    bring_your_own_data: true,
    bring_your_own_copilot: false,
    admin_access: true,
    support: false,
    excel_add_in: true,
    data_add_ons_redistribution: false,
    allow_custom_backends: true,
    bundle_name: "On-Premise",
  });

  it("shows what the entity has", () => {
    expect(entitlements.tier).toBe("basic");
    expect(entitlements.number_copilot_calls_day).toBe("40");
    expect(entitlements.number_copilot_tokens_day).toBe("");
    expect(entitlements.bundle_name).toBe("On-Premise");
  });

  it("reads an entity without entitlements as having none, but custom backends allowed", () => {
    const none = entitlementFormDefaults(undefined);

    expect(none.admin_access).toBe(false);
    expect(none.allow_custom_backends).toBe(true);
    expect(entitlementFormSchema.safeParse(none).success).toBe(true);
  });

  it("sends no token limit as null and the rest as numbers", () => {
    const body = entitlementBody(entitlements);

    expect(body.number_copilot_tokens_day).toBeNull();
    expect(body.number_copilot_calls_day).toBe(40);
    expect(body.total_file_upload_size_gb).toBe(3);
    expect(
      entitlementBody({ ...entitlements, number_copilot_tokens_day: "9000" })
        .number_copilot_tokens_day,
    ).toBe(9000);
  });

  it("refuses a token limit that is not a whole number", () => {
    expect(
      entitlementFormSchema.safeParse({
        ...entitlements,
        number_copilot_tokens_day: "1.5",
      }).success,
    ).toBe(false);
    expect(
      entitlementFormSchema.safeParse({
        ...entitlements,
        number_copilot_tokens_day: "",
      }).success,
    ).toBe(true);
  });

  it("sends only entitlement fields when the entity's own fields are in the same form", () => {
    const editing: EditEntityFormValues = {
      ...entityFormDefaults(ENTITY),
      ...entitlements,
    };
    expect(editEntityFormSchema.safeParse(editing).success).toBe(true);

    const body = entitlementBody(editing);

    expect(Object.keys(body).sort()).toEqual(
      [
        "tier",
        "number_copilot_calls_day",
        "number_copilot_tokens_day",
        "total_file_upload_size_gb",
        "share_widgets",
        "bring_your_own_data",
        "bring_your_own_copilot",
        "admin_access",
        "support",
        "excel_add_in",
        "data_add_ons_redistribution",
        "allow_custom_backends",
        "bundle_name",
      ].sort(),
    );
  });
});

describe("the smaller forms", () => {
  it("keeps the code of an entity type to three characters", () => {
    const type = {
      entityType: "Standard",
      code: "STD",
      permissionHierarchy: "2",
      active: true,
    };

    expect(entityTypeFormSchema.safeParse(type).success).toBe(true);
    expect(entityTypeFormSchema.safeParse({ ...type, code: "STAND" }).success).toBe(
      false,
    );
    expect(
      entityTypeFormSchema.safeParse({ ...type, permissionHierarchy: "-1" }).success,
    ).toBe(false);
  });

  it("does not let an entity be its own child", () => {
    expect(
      relationshipFormSchema.safeParse({ parent: TYPE_UUID, child: OTHER_UUID })
        .success,
    ).toBe(true);
    const same = relationshipFormSchema.safeParse({
      parent: TYPE_UUID,
      child: TYPE_UUID,
    });
    expect(same.success).toBe(false);
    expect(same.error?.issues[0]?.path).toEqual(["child"]);
  });

  it("wants an entity and a name for a permission map", () => {
    expect(
      mapFormSchema.safeParse({ entityUuid: TYPE_UUID, name: "Reviewers" }).success,
    ).toBe(true);
    expect(mapFormSchema.safeParse({ entityUuid: "", name: "" }).success).toBe(false);
  });
});
