import { describe, expect, it } from "vitest";
import { mapFormSchema } from "~/components/AdminEntities/EntityMapDialog";
import { relationshipFormSchema } from "~/components/AdminEntities/EntityRelationshipDialog";
import { entityTypeFormSchema } from "~/components/AdminEntities/EntityTypeDialog";
import {
  entityBody,
  entityFormDefaults,
  entityFormSchema,
  newEntityFormDefaults,
  newEntityFormSchema,
} from "~/components/AdminEntities/entityForms";
import type { Entity } from "~/types/entity.type";

const TYPE_UUID = "7d4f3a52-1b1e-4c7a-9a43-3f7a2b1c9e10";
const OTHER_UUID = "0d1b9b0e-7c2b-4a58-8d63-5c1f6f0c8a21";

const ENTITY: Entity = {
  uuid: OTHER_UUID,
  name: "Acme",
  entity_type: {
    uuid: TYPE_UUID,
    entity_type: "Default",
    code: "DEF",
    active: true,
    permission_hierarchy: 1,
  },
  email: "ops@acme.com",
  company_type: "Fund",
  country: "USA",
  aum: 5,
  organization_size: "Small",
  sharing_enabled: true,
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
      sharingEnabled: true,
    });
    expect(entityFormSchema.safeParse(valid).success).toBe(true);
  });

  it("starts a new entity with sharing on and without an administrator", () => {
    const defaults = newEntityFormDefaults();

    expect(defaults.sharingEnabled).toBe(true);
    expect(defaults.adminEmail).toBe("");
    expect(newEntityFormSchema.safeParse(defaults).success).toBe(false);
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

  it("refuses an AUM that is not a whole number", () => {
    expect(entityFormSchema.safeParse({ ...valid, aum: "1.5" }).success).toBe(false);
    expect(entityFormSchema.safeParse({ ...valid, aum: "ten" }).success).toBe(false);
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
      sharing_enabled: true,
    });
    expect(entityBody({ ...valid, sharingEnabled: false }).sharing_enabled).toBe(false);
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

  it("names a permission map after one of the three user types", () => {
    for (const name of ["Admin", "Developer", "User"]) {
      expect(mapFormSchema.safeParse({ entityUuid: TYPE_UUID, name }).success).toBe(
        true,
      );
    }
    expect(
      mapFormSchema.safeParse({ entityUuid: TYPE_UUID, name: "Reviewers" }).success,
    ).toBe(false);
    expect(mapFormSchema.safeParse({ entityUuid: "", name: "" }).success).toBe(false);
  });
});
