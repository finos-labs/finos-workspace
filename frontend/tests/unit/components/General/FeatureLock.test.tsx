import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FeatureLock from "~/components/General/FeatureLock";

vi.mock("~/components/Tooltip", () => ({
  default: ({ children, message }: { children?: ReactNode; message?: ReactNode }) => (
    <div data-testid="tooltip">
      <div data-testid="tooltip-message">{message}</div>
      {children}
    </div>
  ),
}));

describe("FeatureLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders children directly when not locked", () => {
    render(
      <FeatureLock isLocked={false}>
        <button>Click me</button>
      </FeatureLock>,
    );

    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
    expect(screen.queryByTestId("locker")).not.toBeInTheDocument();
  });

  it("renders lock icon when locked", () => {
    render(
      <FeatureLock isLocked={true}>
        <button>Click me</button>
      </FeatureLock>,
    );

    expect(screen.getByTestId("icon-locker")).toBeInTheDocument();
  });

  it("renders tooltip with default message when locked", () => {
    render(
      <FeatureLock isLocked={true}>
        <button>Click me</button>
      </FeatureLock>,
    );

    expect(screen.getByTestId("tooltip")).toBeInTheDocument();
    expect(
      screen.getByText("This feature is not available on your current plan."),
    ).toBeInTheDocument();
  });

  it("renders tooltip with custom message when locked", () => {
    render(
      <FeatureLock isLocked={true} message="Custom lock message">
        <button>Click me</button>
      </FeatureLock>,
    );

    expect(screen.getByText("Custom lock message")).toBeInTheDocument();
  });

  it("applies opacity to children when locked", () => {
    render(
      <FeatureLock isLocked={true}>
        <button>Click me</button>
      </FeatureLock>,
    );

    // The parent div should have opacity-50 class
    const container = screen.getByTestId("tooltip").querySelector(".opacity-50");
    expect(container).toBeInTheDocument();
  });

  it("makes children non-interactive when locked", () => {
    render(
      <FeatureLock isLocked={true}>
        <button>Click me</button>
      </FeatureLock>,
    );

    // The children should have pointer-events-none
    const container = screen
      .getByTestId("tooltip")
      .querySelector(".pointer-events-none");
    expect(container).toBeInTheDocument();
  });
});
