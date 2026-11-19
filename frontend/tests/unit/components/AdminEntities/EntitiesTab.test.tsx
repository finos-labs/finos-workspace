import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteEntity } from "~/api/entities.api";
import { EntitiesTab } from "~/components/AdminEntities/EntitiesTab";
import { useEntities, useRemovedEntities } from "~/hooks/useEntityAdmin";
import type { Entity } from "~/types/entity.type";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast }));
vi.mock("~/api/entities.api", () => ({ deleteEntity: vi.fn() }));
vi.mock("~/hooks/useEntityAdmin", () => ({
  useEntities: vi.fn(),
  useRemovedEntities: vi.fn(),
  entityAdminKeys: { root: ["admin", "entityAdmin"] },
}));
vi.mock("~/components/AdminEntities/EntityEditDialog", () => ({
  EntityEditDialog: ({ entity }: { entity: Entity }) => <p>editing {entity.name}</p>,
}));
vi.mock("~/components/AdminEntities/EntityRestoreDialog", () => ({
  EntityRestoreDialog: ({ entity }: { entity: Entity }) => (
    <p>restoring {entity.name}</p>
  ),
}));
vi.mock("~/components/AdminEntities/EntityCreateDialog", () => ({
  EntityCreateDialog: () => <p>adding</p>,
}));

const ACME: Entity = {
  uuid: "0d1b9b0e-7c2b-4a58-8d63-5c1f6f0c8a21",
  name: "Acme",
  sharing_enabled: true,
  disabled: false,
};
const BETA: Entity = {
  uuid: "5b2c8e1a-3f4d-4c6b-9a7e-1d2f3a4b5c6d",
  name: "Beta",
  sharing_enabled: true,
  disabled: true,
};

const GONE: Entity = {
  uuid: "9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a",
  name: "Gamma",
  sharing_enabled: true,
  disabled: false,
};

const row = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

function renderTab() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EntitiesTab />
    </QueryClientProvider>,
  );
}

describe("EntitiesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useEntities).mockReturnValue({
      data: [ACME, BETA],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useEntities>);
    vi.mocked(useRemovedEntities).mockReturnValue({
      data: [GONE],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useRemovedEntities>);
  });

  it("shows whether each entity is active or disabled", () => {
    renderTab();

    expect(within(row("Acme")).getByText("Active")).toBeInTheDocument();
    expect(within(row("Beta")).getByText("Disabled")).toBeInTheDocument();
  });

  it("removes an entity after it is confirmed", async () => {
    vi.mocked(deleteEntity).mockResolvedValue({ success: true });
    renderTab();

    fireEvent.click(within(row("Beta")).getByRole("button", { name: "Remove entity" }));
    expect(deleteEntity).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Yes, Remove" }));

    await waitFor(() => expect(deleteEntity).toHaveBeenCalledWith(BETA.uuid));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Entity removed"));
  });

  it("keeps the entity when the removal is cancelled", async () => {
    renderTab();

    fireEvent.click(within(row("Acme")).getByRole("button", { name: "Remove entity" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(deleteEntity).not.toHaveBeenCalled();
  });

  it("says why an entity with users is not removed", async () => {
    vi.mocked(deleteEntity).mockRejectedValue({
      isAxiosError: true,
      response: { data: { detail: "Cannot delete entity with existing users" } },
    });
    renderTab();

    fireEvent.click(within(row("Acme")).getByRole("button", { name: "Remove entity" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, Remove" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("opens the edit dialog from the edit action", () => {
    renderTab();

    fireEvent.click(within(row("Acme")).getByRole("button", { name: "Edit entity" }));

    expect(screen.getByText("editing Acme")).toBeInTheDocument();
  });

  it("lists the removed entities when asked, with a restore action only", async () => {
    renderTab();
    expect(useRemovedEntities).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("switch", { name: "Show removed" }));

    expect(useRemovedEntities).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Gamma")).toBeInTheDocument();
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
    const actions = within(row("Gamma"));
    expect(actions.getByText("Removed")).toBeInTheDocument();
    expect(actions.queryByText("Active")).not.toBeInTheDocument();
    expect(actions.getByRole("button", { name: "Restore entity" })).toBeInTheDocument();
    expect(
      actions.queryByRole("button", { name: "Edit entity" }),
    ).not.toBeInTheDocument();
    expect(
      actions.queryByRole("button", { name: "Remove entity" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add entity" }),
    ).not.toBeInTheDocument();
  });

  it("opens the restore dialog for a removed entity", () => {
    renderTab();
    fireEvent.click(screen.getByRole("switch", { name: "Show removed" }));

    fireEvent.click(
      within(row("Gamma")).getByRole("button", { name: "Restore entity" }),
    );

    expect(screen.getByText("restoring Gamma")).toBeInTheDocument();
  });

  it("goes back to the active entities when removed ones are hidden again", () => {
    renderTab();
    const toggle = screen.getByRole("switch", { name: "Show removed" });
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add entity" })).toBeInTheDocument();
  });
});
