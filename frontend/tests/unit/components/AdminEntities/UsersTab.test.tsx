import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsersTab } from "~/components/AdminEntities/UsersTab";
import { useEntityMaps, useEntityUsers } from "~/hooks/useEntityAdmin";
import type { Entity, EntityMapItem, EntityUser } from "~/types/entity.type";

vi.mock("~/hooks/useEntityAdmin", () => ({
  useEntityUsers: vi.fn(),
  useEntityMaps: vi.fn(),
}));
vi.mock("~/components/AdminEntities/UserMoveDialog", () => ({
  UserMoveDialog: ({ user }: { user: EntityUser }) => <p>moving {user.email}</p>,
}));

const ACME: Entity = {
  uuid: "0d1b9b0e-7c2b-4a58-8d63-5c1f6f0c8a21",
  name: "Acme",
  sharing_enabled: true,
};

const ACME_ADMIN: EntityMapItem = {
  uuid: "a1a1a1a1-0000-4000-8000-000000000002",
  name: "Admin",
  entity_uuid: ACME.uuid,
  entity: ACME,
};

const USERS: EntityUser[] = [
  {
    uuid: "c3c3c3c3-0000-4000-8000-000000000001",
    email: "pat@acme.test",
    permissions: ACME_ADMIN,
  },
  {
    uuid: "c3c3c3c3-0000-4000-8000-000000000002",
    email: "lee@gone.test",
    permissions: null,
  },
];

function query<T>(data: T) {
  return { data, isLoading: false, isError: false } as unknown as ReturnType<
    typeof useEntityUsers
  >;
}

const row = (email: string) => screen.getByText(email).closest("tr") as HTMLElement;

describe("UsersTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useEntityUsers).mockReturnValue(query(USERS));
    vi.mocked(useEntityMaps).mockReturnValue(
      query([ACME_ADMIN]) as unknown as ReturnType<typeof useEntityMaps>,
    );
  });

  it("lists every user with their entity and user type", () => {
    render(<UsersTab />);

    expect(within(row("pat@acme.test")).getByText("Acme")).toBeInTheDocument();
    expect(within(row("pat@acme.test")).getByText("Admin")).toBeInTheDocument();
    expect(within(row("lee@gone.test")).getAllByText("None")).toHaveLength(2);
  });

  it("has no Add button", () => {
    render(<UsersTab />);

    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
  });

  it("finds users by email or entity", async () => {
    render(<UsersTab />);

    fireEvent.change(screen.getByPlaceholderText("Search for users"), {
      target: { value: "acme" },
    });

    await waitFor(() =>
      expect(screen.queryByText("lee@gone.test")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("pat@acme.test")).toBeInTheDocument();
  });

  it("opens the move for a user", () => {
    render(<UsersTab />);

    fireEvent.click(
      within(row("pat@acme.test")).getByRole("button", { name: "Move user" }),
    );

    expect(screen.getByText("moving pat@acme.test")).toBeInTheDocument();
  });
});
