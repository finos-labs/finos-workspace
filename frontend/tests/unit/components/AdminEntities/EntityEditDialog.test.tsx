import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { updateEntity } from "~/api/entities.api";
import { EntityEditDialog } from "~/components/AdminEntities/EntityEditDialog";
import type { Entity } from "~/types/entity.type";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("~/api/entities.api", () => ({ updateEntity: vi.fn() }));

const entity = (sharing_enabled: boolean): Entity => ({
  uuid: "0d1b9b0e-7c2b-4a58-8d63-5c1f6f0c8a21",
  name: "Acme",
  sharing_enabled,
});

function renderDialog(sharingEnabled: boolean) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EntityEditDialog entity={entity(sharingEnabled)} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

const sharingSwitch = () => screen.getByRole("switch", { name: "Sharing enabled" });

describe("EntityEditDialog sharing switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (updateEntity as Mock).mockResolvedValue({ success: true });
  });

  it("shows whether the organization may share", () => {
    renderDialog(true);

    expect(sharingSwitch()).toBeChecked();
  });

  it("turns sharing on for the organization", async () => {
    const { onClose } = renderDialog(false);
    expect(sharingSwitch()).not.toBeChecked();

    await userEvent.click(sharingSwitch());
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updateEntity).toHaveBeenCalledWith(
      "0d1b9b0e-7c2b-4a58-8d63-5c1f6f0c8a21",
      expect.objectContaining({ name: "Acme", sharing_enabled: true }),
    );
  });

  it("turns sharing off for the organization", async () => {
    renderDialog(true);

    await userEvent.click(sharingSwitch());
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateEntity).toHaveBeenCalledWith(
        "0d1b9b0e-7c2b-4a58-8d63-5c1f6f0c8a21",
        expect.objectContaining({ sharing_enabled: false }),
      ),
    );
  });
});
