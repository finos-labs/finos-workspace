import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { restoreEntity } from "~/api/entities.api";
import { EntityRestoreDialog } from "~/components/AdminEntities/EntityRestoreDialog";
import type { Entity } from "~/types/entity.type";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast }));
vi.mock("~/api/entities.api", () => ({ restoreEntity: vi.fn() }));

const ENTITY: Entity = {
  uuid: "0d1b9b0e-7c2b-4a58-8d63-5c1f6f0c8a21",
  name: "Acme",
  sharing_enabled: true,
  disabled: false,
};

function renderDialog() {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EntityRestoreDialog entity={ENTITY} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

const nameInput = () => screen.getByRole("textbox", { name: "Name" });

describe("EntityRestoreDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (restoreEntity as Mock).mockResolvedValue({ success: true });
  });

  it("starts from the name the entity had", () => {
    renderDialog();

    expect(nameInput()).toHaveValue("Acme");
  });

  it("restores the entity under its name", async () => {
    const { onClose } = renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(restoreEntity).toHaveBeenCalledWith(ENTITY.uuid, "Acme");
    expect(toast.success).toHaveBeenCalledWith("Entity restored");
  });

  it("restores the entity under another name", async () => {
    renderDialog();

    await userEvent.clear(nameInput());
    await userEvent.type(nameInput(), "Acme Two");
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(restoreEntity).toHaveBeenCalledWith(ENTITY.uuid, "Acme Two"),
    );
  });

  it("asks for a name and does not restore without one", async () => {
    renderDialog();

    await userEvent.clear(nameInput());
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(await screen.findByText("This field is required")).toBeInTheDocument();
    expect(restoreEntity).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and says why when the name is taken", async () => {
    (restoreEntity as Mock).mockRejectedValue({
      isAxiosError: true,
      response: { data: { detail: "An entity with this name already exists" } },
    });
    const { onClose } = renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
