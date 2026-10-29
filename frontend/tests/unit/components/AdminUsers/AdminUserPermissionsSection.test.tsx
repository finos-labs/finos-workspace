import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryResult = vi.hoisted(() => ({
  data: undefined as unknown,
  isLoading: false,
  isError: false,
}));
const queryOptions = vi.hoisted(() => ({ enabled: undefined as unknown }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { enabled?: boolean }) => {
    queryOptions.enabled = options.enabled;
    return queryResult;
  },
}));

import AdminUserPermissionsSection from "~/components/AdminUsers/AdminUserPermissionsSection";

const PERMISSIONS = {
  data_connectors: [
    {
      name: "conn1",
      uuid: "c1",
      type: "backend",
      access: [{ "Risk Manager": "access" }],
      widgets: [
        {
          widgetId: "w1",
          access: [{ "Risk Manager": "access" }, { Analyst: "access" }],
        },
        { widgetId: "w2", access: [{ Analyst: "access" }] },
      ],
    },
  ],
  templates: [
    { templateId: "app1", access: [{ "Risk Manager": "access" }] },
    { templateId: "app2", access: [{ "Risk Manager": "denied" }] },
  ],
  prompts: [{ uuid: "p1", access: [{ Analyst: "access" }] }],
};

beforeEach(() => {
  queryResult.data = undefined;
  queryResult.isLoading = false;
  queryResult.isError = false;
});

describe("AdminUserPermissionsSection", () => {
  it("renders one row per role with resource counts and a Final Permission tag", () => {
    queryResult.data = PERMISSIONS;
    render(<AdminUserPermissionsSection userUuid="u1" />);

    expect(screen.getByText("Risk Manager")).toBeInTheDocument();
    expect(screen.getByText("Analyst")).toBeInTheDocument();

    const riskRow = screen.getByText("Risk Manager").closest("tr") as HTMLElement;
    expect(within(riskRow).getAllByText("1")).toHaveLength(2);

    const analystRow = screen.getByText("Analyst").closest("tr") as HTMLElement;
    expect(within(analystRow).getByText("2")).toBeInTheDocument();

    expect(screen.getAllByText("Access")).toHaveLength(2);
  });

  it("shows the empty state when the user has no roles", () => {
    queryResult.data = { data_connectors: [], templates: [], prompts: [] };
    render(<AdminUserPermissionsSection userUuid="u1" />);

    expect(
      screen.getByText("No roles assigned to this user account"),
    ).toBeInTheDocument();
  });

  it("does not ask for the permissions of a pending invite", () => {
    render(<AdminUserPermissionsSection userUuid="invite-uuid" invited />);

    expect(queryOptions.enabled).toBe(false);
    expect(
      screen.getByText("No roles assigned to this user account"),
    ).toBeInTheDocument();
  });

  it("asks for the permissions of a user", () => {
    render(<AdminUserPermissionsSection userUuid="u1" />);

    expect(queryOptions.enabled).toBe(true);
  });

  it("shows the loading state", () => {
    queryResult.isLoading = true;
    render(<AdminUserPermissionsSection userUuid="u1" />);
    expect(screen.getByText("Loading permissions...")).toBeInTheDocument();
  });
});
