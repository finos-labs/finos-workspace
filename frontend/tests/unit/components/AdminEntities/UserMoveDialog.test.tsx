import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { moveEntityUser } from "~/api/entities.api";
import { UserMoveDialog } from "~/components/AdminEntities/UserMoveDialog";
import type { Entity, EntityMapItem, EntityUser } from "~/types/entity.type";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("~/api/entities.api", () => ({ moveEntityUser: vi.fn() }));

const entity = (uuid: string, name: string): Entity => ({
  uuid,
  name,
  entity_type: {
    uuid: "7d4f3a52-1b1e-4c7a-9a43-3f7a2b1c9e10",
    entity_type: "Default",
    code: "DEF",
    active: true,
    permission_hierarchy: 1,
  },
  email: null,
  company_type: null,
  country: null,
  aum: null,
  organization_size: null,
  sharing_enabled: true,
});

const ACME = entity("0d1b9b0e-7c2b-4a58-8d63-5c1f6f0c8a21", "Acme");
const BETA = entity("5b2c8e1a-3f4d-4c6b-9a7e-1d2f3a4b5c6d", "Beta");

const map = (uuid: string, of: Entity, name: EntityMapItem["name"]): EntityMapItem => ({
  uuid,
  name,
  entity_uuid: of.uuid,
  entity: of,
});

const ACME_USER = map("a1a1a1a1-0000-4000-8000-000000000001", ACME, "User");
const ACME_ADMIN = map("a1a1a1a1-0000-4000-8000-000000000002", ACME, "Admin");
// Beta has no Admin type
const BETA_USER = map("b2b2b2b2-0000-4000-8000-000000000001", BETA, "User");
const BETA_DEVELOPER = map("b2b2b2b2-0000-4000-8000-000000000002", BETA, "Developer");
const MAPS = [ACME_USER, ACME_ADMIN, BETA_USER, BETA_DEVELOPER];

const USER: EntityUser = {
  uuid: "c3c3c3c3-0000-4000-8000-000000000001",
  email: "pat@acme.test",
  permissions: ACME_ADMIN,
};

function renderDialog(user: EntityUser = USER) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UserMoveDialog user={user} maps={MAPS} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

const [entitySelect, typeSelect] = [0, 1].map(
  (index) => () => screen.getAllByRole("combobox")[index],
);

async function choose(select: HTMLElement, name: string) {
  fireEvent.click(select);
  fireEvent.click(await screen.findByRole("option", { name }));
}

describe("UserMoveDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (moveEntityUser as Mock).mockResolvedValue({ success: true });
  });

  it("starts at the user's entity and user type", () => {
    renderDialog();

    expect(screen.getByText("pat@acme.test")).toBeInTheDocument();
    expect(entitySelect()).toHaveTextContent("Acme");
    expect(typeSelect()).toHaveTextContent("Admin");
  });

  it("moves the user to a user type of another entity", async () => {
    const { onClose } = renderDialog();

    await choose(entitySelect(), "Beta");
    await choose(typeSelect(), "Developer");
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(moveEntityUser).toHaveBeenCalledWith(USER.uuid, BETA_DEVELOPER.uuid);
  });

  it("offers only the user types the chosen entity has", async () => {
    renderDialog();

    await choose(entitySelect(), "Beta");
    // The user's Admin type is not one of Beta's
    expect(typeSelect()).not.toHaveTextContent("Admin");
    fireEvent.click(typeSelect());

    expect(
      (await screen.findAllByRole("option")).map((option) => option.textContent),
    ).toEqual(["Developer", "User"]);
  });

  it("asks for a user type when the entity's types do not include the user's", async () => {
    renderDialog();

    await choose(entitySelect(), "Beta");
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    expect(await screen.findByText("Choose a user type")).toBeInTheDocument();
    expect(moveEntityUser).not.toHaveBeenCalled();
  });

  it("does not move a user to where they are", async () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(moveEntityUser).not.toHaveBeenCalled();
  });

  it("places a user without an organization", async () => {
    const { onClose } = renderDialog({ ...USER, permissions: null });

    await choose(entitySelect(), "Acme");
    await choose(typeSelect(), "User");
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(moveEntityUser).toHaveBeenCalledWith(USER.uuid, ACME_USER.uuid);
  });

  it("says why a move failed and stays open", async () => {
    (moveEntityUser as Mock).mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { detail: "Permission map not found" } },
    });
    const { onClose } = renderDialog();

    await choose(entitySelect(), "Beta");
    await choose(typeSelect(), "User");
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Permission map not found",
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
