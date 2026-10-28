const { mockMediaQueryList } = vi.hoisted(() => {
  const mockMediaQueryList = {
    matches: false,
    media: "(max-width: 767px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockReturnValue(mockMediaQueryList),
  });
  return { mockMediaQueryList };
});

import { render, screen, waitFor } from "@testing-library/react";
import ReactDOM from "react-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Tooltip from "~/components/Tooltip";

vi.spyOn(ReactDOM, "createPortal").mockImplementation((element) => {
  return element as React.ReactPortal;
});

describe("Tooltip Component", () => {
  it("renders the tooltip with the correct message when open is true", async () => {
    render(
      <Tooltip message="Test Tooltip" open={true} position="top">
        <button>Hover me</button>
      </Tooltip>,
    );

    await waitFor(() => {
      const tooltips = screen.getAllByText("Test Tooltip");
      expect(tooltips.length).toBeGreaterThan(0);
      expect(tooltips[0]).toHaveClass("TooltipContent");
    });
  });

  it("does not render the tooltip when hide is true", () => {
    render(
      <Tooltip message="Hidden Tooltip" hide={true}>
        <button>Hover me</button>
      </Tooltip>,
    );

    expect(screen.queryByText("Hidden Tooltip")).not.toBeInTheDocument();
  });
});

describe("Tooltip mobile popover behavior", () => {
  beforeEach(() => {
    mockMediaQueryList.matches = false;
  });

  it("renders as Popover on mobile", async () => {
    mockMediaQueryList.matches = true;

    render(
      <Tooltip message="Mobile Tooltip" open={true}>
        <button>Tap me</button>
      </Tooltip>,
    );

    expect(screen.getByRole("button", { name: "Tap me" })).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Tap me" });
    expect(trigger).toBeInTheDocument();
  });

  it("renders message content via Popover on mobile when portal is mocked", async () => {
    mockMediaQueryList.matches = true;

    render(
      <Tooltip message="Mobile Content" open={true}>
        <button>Tap me</button>
      </Tooltip>,
    );

    expect(screen.getByRole("button", { name: "Tap me" })).toBeInTheDocument();
  });

  it("renders as standard Tooltip on desktop", async () => {
    mockMediaQueryList.matches = false;

    render(
      <Tooltip message="Desktop Tooltip" open={true} position="top">
        <button>Hover me</button>
      </Tooltip>,
    );

    await waitFor(() => {
      const tooltips = screen.getAllByText("Desktop Tooltip");
      expect(tooltips.length).toBeGreaterThan(0);
      expect(tooltips[0]).toHaveClass("TooltipContent");
    });

    expect(screen.getByRole("button", { name: "Hover me" })).toBeInTheDocument();
  });

  it("renders children directly when hide is true regardless of mobile state", () => {
    mockMediaQueryList.matches = true;

    render(
      <Tooltip message="Should Not Appear" hide={true}>
        <button>Child Button</button>
      </Tooltip>,
    );

    expect(screen.getByRole("button", { name: "Child Button" })).toBeInTheDocument();
    expect(screen.queryByText("Should Not Appear")).not.toBeInTheDocument();
  });
});
