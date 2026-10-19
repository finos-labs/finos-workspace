import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnifiedTemplate } from "~/hooks/useAllTemplates";
import type { SharingLevel } from "~/lib/state/access";
import type { Source } from "~/lib/state/backendConnector";

const mockNavigate = vi.fn();
const mockSetShareUserAppsPopupId = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockSource: Source | null = null;

vi.mock("~/lib/state/theme", () => ({
  useShallowThemeStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      theme: "light",
      setEditAppDialog: vi.fn(),
      setShareUserAppsPopupId: mockSetShareUserAppsPopupId,
    }),
}));

vi.mock("~/lib/state/backendConnector", () => ({
  useShallowBackendConnectorStore: (
    selector: (state: Record<string, unknown>) => unknown,
  ) =>
    selector({
      getApiSourceById: () => mockSource,
      refreshApiSourceById: vi.fn(),
    }),
}));

vi.mock("~/lib/state/mcpTools", () => ({
  useShallowMcpToolsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ servers: [], getMCPConnection: () => undefined }),
}));

vi.mock("~/lib/constants", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
  };
});

vi.mock("~/components/ds/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

vi.mock("~/components/Icon", () => ({
  default: ({ id }: { id: string }) => <span data-testid={`icon-${id}`} />,
}));

vi.mock("~/components/Tooltip", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/HoverPopover", () => ({
  HoverPopover: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/General/Avatar", () => ({
  AuthenticatedAvatar: () => <div data-testid="avatar" />,
}));

vi.mock("~/components/ds/dialogs/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

vi.mock("~/components/ds/atoms/Button", () => ({
  Button: ({ children, ...rest }: ComponentProps<"button">) => (
    <button {...rest}>{children}</button>
  ),
}));

vi.mock("~/components/AI/WidgetTooltipItem", () => ({
  WidgetTooltipItem: () => null,
}));

vi.mock("~/components/AdminRoles/AddUsersSelect", () => ({
  getUserInitials: () => "U",
}));

vi.mock("~/components/Apps/McpAppPopover", () => ({
  McpAppPopover: () => null,
}));

// Render the dropdown items as plain buttons so we can assert on the items
// array (the unit under test) without driving Radix portal/pointer internals.
// Paths use the ~ alias so they resolve to the same module AppCard.tsx imports.
vi.mock("~/components/LayoutAuth/AppCard/AppCardDropdown", () => ({
  AppCardDropdown: ({ items }: { items: { label: string; onClick: () => void }[] }) => (
    <div data-testid="dropdown">
      {items.map((item) => (
        <button key={item.label} type="button" onClick={item.onClick}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("~/components/LayoutAuth/AppCard/PopoverContent", () => ({
  PopoverContent: () => null,
}));
vi.mock("~/components/LayoutAuth/AppCard/SharedWithPopover", () => ({
  SharedWithPopover: () => null,
}));
vi.mock("~/components/LayoutAuth/AppCard/Tag", () => ({ Tag: () => null }));

import AppCard from "~/components/LayoutAuth/AppCard/AppCard";
import { setAccess } from "../../../factories";
import { partial } from "../../../mocks";

function makeTemplate(
  type: UnifiedTemplate["type"],
  sourceId: string | undefined = "src-1",
): UnifiedTemplate {
  return {
    id: "tpl",
    name: "Tpl",
    description: "desc",
    type,
    widgets: [],
    prompts: [],
    onClick: vi.fn(),
    creator: true,
    onDelete: vi.fn(),
    source: sourceId
      ? partial({
          id: sourceId,
          uuid: sourceId,
          name: "src",
          url: "",
          endpointHeaders: [],
        })
      : undefined,
  };
}

const renderCard = (template: UnifiedTemplate) =>
  render(
    <MemoryRouter>
      <AppCard template={template} setDeleteConfirm={vi.fn()} />
    </MemoryRouter>,
  );

describe("AppCard - Go to connection menu item", () => {
  beforeEach(() => {
    mockSource = null;
    mockNavigate.mockClear();
  });

  it("shows 'Go to connection' for a user backend card", () => {
    renderCard(makeTemplate("user"));
    expect(
      screen.getByRole("button", { name: "Go to connection" }),
    ).toBeInTheDocument();
  });

  it("navigates to /app/connections with the source id when clicked", async () => {
    const user = userEvent.setup();
    renderCard(makeTemplate("user", "backend-42"));

    await user.click(screen.getByRole("button", { name: "Go to connection" }));

    expect(mockNavigate).toHaveBeenCalledWith(
      "/app/connections?connectionId=backend-42",
    );
  });

  it("does NOT show 'Go to connection' for shared cards", () => {
    renderCard(makeTemplate("shared"));
    expect(
      screen.queryByRole("button", { name: "Go to connection" }),
    ).not.toBeInTheDocument();
  });

  it("does NOT show 'Go to connection' for generated (saved) cards", () => {
    renderCard(makeTemplate("generated"));
    expect(
      screen.queryByRole("button", { name: "Go to connection" }),
    ).not.toBeInTheDocument();
  });
});
describe("AppCard - Share app button", () => {
  const shareButton = () => screen.queryByTestId("icon-share-07")?.closest("button");

  beforeEach(() => {
    mockSource = null;
    mockSetShareUserAppsPopupId.mockClear();
  });

  it("lets a user whose roles allow sharing share their saved app", async () => {
    setAccess({ sharing: "share" });
    renderCard(makeTemplate("generated"));

    const button = shareButton();
    expect(button).toBeInTheDocument();
    await userEvent.setup().click(button as HTMLButtonElement);
    expect(mockSetShareUserAppsPopupId).toHaveBeenCalledWith("tpl");
  });

  it.each<SharingLevel>([
    "none",
    "receive",
  ])("does not offer sharing to a user whose sharing is %s", (sharing) => {
    setAccess({ sharing });
    renderCard(makeTemplate("generated"));

    expect(shareButton()).toBeUndefined();
  });
});
