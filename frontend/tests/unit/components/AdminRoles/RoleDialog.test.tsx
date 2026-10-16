import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleDialog } from "~/components/AdminRoles/RoleDialog";
import type { RoleT } from "~/components/AdminRoles/types";

// --- mocks ------------------------------------------------------------------

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const usersData = [
  {
    uuid: "u1",
    email: "alice@example.com",
    first_name: "Alice",
    last_name: "Admin",
    fullName: "Alice Admin",
    source: "user",
    permissions_uuid: "perm-1",
    role: "User",
    status: "active",
    last_login: null,
    last_active: null,
  },
];

vi.mock("~/components/AdminRoles/adminUseQueries", async () => {
  const actual = await vi.importActual<
    typeof import("~/components/AdminRoles/adminUseQueries")
  >("~/components/AdminRoles/adminUseQueries");
  return {
    ...actual,
    useUsers: () => ({
      data: usersData,
      isLoading: false,
      refetch: vi.fn(),
    }),
  };
});

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    // Saving calls the API function the mutation wraps, so a test sees what is sent.
    useMutation: vi.fn(
      ({ mutationFn }: { mutationFn: (variables: unknown) => unknown }) => ({
        mutate: vi.fn(),
        mutateAsync: async (variables: unknown) => mutationFn(variables),
        isPending: false,
      }),
    ),
    useQueryClient: vi.fn(() => ({
      refetchQueries: vi.fn(),
      invalidateQueries: vi.fn(),
    })),
  };
});

vi.mock("~/api/entity_roles.api", () => ({
  postEntityRole: (...args: unknown[]) => mockCreate(...args),
  patchEntityRole: (...args: unknown[]) => mockUpdate(...args),
  deleteEntityRole: (...args: unknown[]) => mockDelete(...args),
}));

// ---------------------------------------------------------------------------

function renderDialog(overrides?: {
  mode?: "create" | "edit";
  initialData?: RoleT;
  onClose?: () => void;
}) {
  const onClose = overrides?.onClose ?? vi.fn();
  const client = new QueryClient();
  const result = render(
    <QueryClientProvider client={client}>
      <RoleDialog
        open={true}
        onClose={onClose}
        mode={overrides?.mode ?? "create"}
        initialData={overrides?.initialData}
        roles={[]}
      />
    </QueryClientProvider>,
  );
  return { onClose, ...result };
}

async function typeName(value: string) {
  const input = screen.getByPlaceholderText("Enter name") as HTMLInputElement;

  await userEvent.clear(input);

  await userEvent.type(input, value);
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RoleDialog", () => {
  describe("close-intent gating", () => {
    it("calls onClose immediately when the form is clean", () => {
      const { onClose } = renderDialog();
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("opens the discard confirm when Cancel is clicked on a dirty form", async () => {
      const { onClose } = renderDialog();
      await typeName("Analyst");
      const unsaved = await screen.findByText("Unsaved");

      expect(unsaved).toBeInTheDocument();

      const cancelBtn = await screen.findByRole("button", { name: /^cancel$/i });
      userEvent.click(cancelBtn);
      const confirm = await screen.findByText("Discard changes?");

      expect(confirm).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("'Keep editing' dismisses the discard confirm and preserves the name input", async () => {
      const { onClose } = renderDialog();
      await typeName("Analyst");
      const cancelBtn = await screen.findByRole("button", { name: /^cancel$/i });
      userEvent.click(cancelBtn);

      const confirmTitle = await screen.findByText("Discard changes?");
      const confirm = confirmTitle.closest("[role='dialog']") as HTMLElement;
      const editBtn = await within(confirm).findByRole("button", {
        name: /keep editing/i,
      });
      userEvent.click(editBtn);

      await waitFor(() => {
        expect(screen.queryByText("Discard changes?")).not.toBeInTheDocument();
      });
      expect(
        (screen.getByPlaceholderText("Enter name") as HTMLInputElement).value,
      ).toBe("Analyst");
      expect(onClose).not.toHaveBeenCalled();
    });

    it("'Discard' calls onClose", async () => {
      const { onClose } = renderDialog();
      await typeName("Analyst");
      const cancelBtn = await screen.findByRole("button", { name: /^cancel$/i });
      userEvent.click(cancelBtn);
      await waitFor(() => {
        expect(screen.queryByText("Discard changes?")).not.toBeInTheDocument();
      });

      const confirmTitle = await screen.findByText("Discard changes?");
      const confirm = confirmTitle.closest("[role='dialog']") as HTMLElement;
      const discardBtn = await within(confirm).findByRole("button", {
        name: /^discard$/i,
      });
      userEvent.click(discardBtn);
      await waitFor(() => {
        expect(screen.queryByText("Discard changes?")).not.toBeInTheDocument();
      });

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("Unsaved indicator", () => {
    it("renders an 'Unsaved' tag only when the form is dirty", async () => {
      renderDialog();
      expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();

      await typeName("Analyst");
      await waitFor(() => {
        expect(screen.getByText("Unsaved")).toBeInTheDocument();
      });
    });
  });

  describe("Save button", () => {
    it("is disabled when the form is clean", () => {
      renderDialog();
      const save = screen.getByRole("button", { name: /^create role$/i });
      expect(save).toBeDisabled();
    });

    it("enables once the form is both dirty and valid", async () => {
      renderDialog();
      await typeName("Analyst");
      await waitFor(() => {
        const save = screen.getByRole("button", { name: /^create role$/i });
        expect(save).toBeEnabled();
      });
    });
  });

  describe("role settings", () => {
    const role: RoleT = {
      uuid: "r1",
      name: "Analyst",
      description: "Reads dashboards",
      users: [],
      createdAt: 0,
      sharing: "receive",
      copilot_calls_day: 50,
      copilot_tokens_day: null,
      upload_size_gb: 2,
      excel_add_in: true,
    };

    const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
    const noLimit = (label: string) =>
      screen.getByRole("checkbox", { name: `${label}: no limit` });
    const LIMITS = [
      "Copilot calls per day",
      "Copilot tokens per day",
      "Upload size (GB)",
    ];
    // The select's label names its form item, not the trigger
    const sharingSelect = () =>
      within(
        screen.getByText("Sharing").closest(".BB-FormSelect") as HTMLElement,
      ).getByRole("combobox");

    it("starts a new role with no sharing, no limits and no Excel add-in", () => {
      renderDialog();

      expect(sharingSelect()).toHaveTextContent("None");
      for (const label of LIMITS) {
        expect(noLimit(label)).toBeChecked();
        expect(field(label)).toBeDisabled();
        expect(field(label).value).toBe("");
      }
      expect(screen.getByRole("checkbox", { name: "Excel add-in" })).not.toBeChecked();
    });

    it("shows the settings of the role it edits, a null limit as no limit", () => {
      renderDialog({ mode: "edit", initialData: role });

      expect(sharingSelect()).toHaveTextContent("Receive only");
      expect(field("Copilot calls per day").value).toBe("50");
      expect(noLimit("Copilot calls per day")).not.toBeChecked();
      expect(noLimit("Copilot tokens per day")).toBeChecked();
      expect(field("Copilot tokens per day")).toBeDisabled();
      expect(field("Upload size (GB)").value).toBe("2");
      expect(screen.getByRole("checkbox", { name: "Excel add-in" })).toBeChecked();
    });

    it("offers the three sharing levels", async () => {
      renderDialog();

      await userEvent.click(sharingSelect());

      expect(
        (await screen.findAllByRole("option")).map((option) => option.textContent),
      ).toEqual(["None", "Receive only", "Can share"]);
    });

    it("creates a role with the limits typed, the others as no limit", async () => {
      renderDialog();
      await typeName("Sharers");
      await userEvent.click(sharingSelect());
      await userEvent.click(await screen.findByRole("option", { name: "Can share" }));
      await userEvent.click(noLimit("Copilot tokens per day"));
      await userEvent.type(field("Copilot tokens per day"), "5000");
      await userEvent.click(noLimit("Upload size (GB)"));
      await userEvent.type(field("Upload size (GB)"), "3");
      await userEvent.click(screen.getByRole("checkbox", { name: "Excel add-in" }));

      const save = screen.getByRole("button", { name: /^create role$/i });
      await waitFor(() => expect(save).toBeEnabled());
      await userEvent.click(save);

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      expect(mockCreate.mock.calls[0][0]).toMatchObject({
        name: "Sharers",
        sharing: "share",
        copilot_calls_day: null,
        copilot_tokens_day: 5000,
        upload_size_gb: 3,
        excel_add_in: true,
      });
    });

    it("saves an edited limit and keeps the others as they were", async () => {
      renderDialog({ mode: "edit", initialData: role });
      await userEvent.clear(field("Copilot calls per day"));
      await userEvent.type(field("Copilot calls per day"), "75");

      const save = screen.getByRole("button", { name: /save changes/i });
      await waitFor(() => expect(save).toBeEnabled());
      await userEvent.click(save);

      await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
      expect(mockUpdate.mock.calls[0][0]).toMatchObject({
        uuid: "r1",
        sharing: "receive",
        copilot_calls_day: 75,
        copilot_tokens_day: null,
        upload_size_gb: 2,
        excel_add_in: true,
      });
    });

    it("refuses a limit that is not a whole number", async () => {
      renderDialog();
      await typeName("Analyst");
      await userEvent.click(noLimit("Upload size (GB)"));
      await userEvent.type(field("Upload size (GB)"), "1.5");

      await waitFor(() =>
        expect(screen.getByRole("button", { name: /^create role$/i })).toBeDisabled(),
      );
    });

    it("asks for a number once No limit is unchecked", async () => {
      renderDialog();
      await typeName("Analyst");
      await userEvent.click(noLimit("Copilot calls per day"));

      expect(field("Copilot calls per day")).toBeEnabled();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /^create role$/i })).toBeDisabled(),
      );
      expect(await screen.findByText("Enter a whole number")).toBeInTheDocument();

      await userEvent.type(field("Copilot calls per day"), "0");
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /^create role$/i })).toBeEnabled(),
      );
    });

    it("lifts a limit when No limit is checked", async () => {
      renderDialog({ mode: "edit", initialData: role });
      await userEvent.click(noLimit("Upload size (GB)"));

      const save = screen.getByRole("button", { name: /save changes/i });
      await waitFor(() => expect(save).toBeEnabled());
      await userEvent.click(save);

      await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
      expect(mockUpdate.mock.calls[0][0]).toMatchObject({
        copilot_calls_day: 50,
        copilot_tokens_day: null,
        upload_size_gb: null,
      });
    });
  });

  describe("Edit mode: trash button dirties the form", () => {
    const role: RoleT = {
      uuid: "r1",
      name: "Analyst",
      description: "Reads dashboards",
      users: ["alice@example.com"],
      createdAt: 0,
      sharing: "none",
      copilot_calls_day: 0,
      copilot_tokens_day: 0,
      upload_size_gb: 0,
      excel_add_in: false,
    };

    it("removes a member via trash and the form becomes dirty", async () => {
      renderDialog({ mode: "edit", initialData: role });

      // Wait for the member list to render.
      await screen.findByText("Alice Admin");

      const trashBtn = screen.getByRole("button", {
        name: /remove alice admin from role/i,
      });
      fireEvent.click(trashBtn);

      // "Unsaved" tag appears, the user vanishes, and Save enables.
      await waitFor(() => {
        expect(screen.getByText("Unsaved")).toBeInTheDocument();
      });
      expect(screen.queryByText("Alice Admin")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled();
    });
  });
});
