import { describe, expect, it } from "vitest";
import { mapFormSchema } from "~/components/AdminEntities/EntityMapDialog";
import {
  entityBody,
  entityFormDefaults,
  entityFormSchema,
  newEntityFormDefaults,
  newEntityFormSchema,
} from "~/components/AdminEntities/entityForms";
import type { Entity } from "~/types/entity.type";

const ENTITY_UUID = "7d4f3a52-1b1e-4c7a-9a43-3f7a2b1c9e10";
const OTHER_UUID = "0d1b9b0e-7c2b-4a58-8d63-5c1f6f0c8a21";

const ENTITY: Entity = { uuid: OTHER_UUID, name: "Acme", sharing_enabled: true };

describe("entity form", () => {
  const valid = entityFormDefaults(ENTITY);

  it("starts from the entity it edits", () => {
    expect(valid).toEqual({ name: "Acme", sharingEnabled: true });
    expect(entityFormSchema.safeParse(valid).success).toBe(true);
  });

  it("starts a new entity with sharing on and without an administrator", () => {
    const defaults = newEntityFormDefaults();

    expect(defaults.sharingEnabled).toBe(true);
    expect(defaults.adminEmail).toBe("");
    expect(newEntityFormSchema.safeParse(defaults).success).toBe(false);
  });

  it("asks for a name", () => {
    const result = entityFormSchema.safeParse({ ...valid, name: " " });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(["name"]);
  });

  it("makes the request body: the name and the sharing switch", () => {
    expect(entityBody(valid)).toEqual({ name: "Acme", sharing_enabled: true });
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
  it("names a permission map after one of the three user types", () => {
    for (const name of ["Admin", "Developer", "User"]) {
      expect(mapFormSchema.safeParse({ entityUuid: ENTITY_UUID, name }).success).toBe(
        true,
      );
    }
    expect(
      mapFormSchema.safeParse({ entityUuid: ENTITY_UUID, name: "Reviewers" }).success,
    ).toBe(false);
    expect(mapFormSchema.safeParse({ entityUuid: "", name: "" }).success).toBe(false);
  });
});
