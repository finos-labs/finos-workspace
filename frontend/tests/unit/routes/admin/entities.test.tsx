import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIsEntityAdmin } from "~/hooks/useEntityAdmin";
import AdminEntities from "~/routes/admin/entities";

vi.mock("~/hooks/useEntityAdmin", () => ({ useIsEntityAdmin: vi.fn() }));
vi.mock("~/components/AdminEntities/EntitiesTab", () => ({
  EntitiesTab: () => <p>entities tab</p>,
}));
vi.mock("~/components/AdminEntities/EntityTypesTab", () => ({
  EntityTypesTab: () => <p>types tab</p>,
}));
vi.mock("~/components/AdminEntities/EntityRelationshipsTab", () => ({
  EntityRelationshipsTab: () => <p>relationships tab</p>,
}));
vi.mock("~/components/AdminEntities/EntityMapsTab", () => ({
  EntityMapsTab: () => <p>maps tab</p>,
}));
vi.mock("~/components/AdminEntities/UsersTab", () => ({
  UsersTab: () => <p>users tab</p>,
}));
vi.mock("~/components/General/BrandedLoadingState", () => ({
  default: () => <p>loading</p>,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/entities"]}>
      <Routes>
        <Route path="/admin" element={<p>admin home</p>} />
        <Route path="/admin/entities" element={<AdminEntities />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminEntities page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("waits for the superuser check", () => {
    vi.mocked(useIsEntityAdmin).mockReturnValue({
      isEntityAdmin: false,
      isLoading: true,
    });
    renderPage();

    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.queryByText("admin home")).not.toBeInTheDocument();
  });

  it("sends anyone but a superuser back to the Admin home", () => {
    vi.mocked(useIsEntityAdmin).mockReturnValue({
      isEntityAdmin: false,
      isLoading: false,
    });
    renderPage();

    expect(screen.getByText("admin home")).toBeInTheDocument();
    expect(screen.queryByText("Entity Management")).not.toBeInTheDocument();
  });

  it("shows a superuser the entity management", () => {
    vi.mocked(useIsEntityAdmin).mockReturnValue({
      isEntityAdmin: true,
      isLoading: false,
    });
    renderPage();

    expect(screen.getByText("Entity Management")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Entity types" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All users" })).toBeInTheDocument();
    expect(screen.getByText("entities tab")).toBeInTheDocument();
  });
});
