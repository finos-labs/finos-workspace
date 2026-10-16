import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DragFileHere from "~/components/AI/DragFileHere";

// Mock the Icon component
vi.mock("~/components/Icon", () => ({
  default: ({ id, className }: { id: string; className: string }) => (
    <svg data-testid={id} id={id} className={className} />
  ),
}));

describe("DragFileHere Component", () => {
  it("renders the correct content and structure", () => {
    render(<DragFileHere />);

    // Check if the component text is present
    const componentText = screen.getByText("Drag the file here");
    expect(componentText).toBeInTheDocument();

    // Check if the Icon component is rendered with the correct props
    const icon = screen.getByTestId("download-icon");
    expect(icon).toBeInTheDocument();

    // Check if the component has the correct css classes
    const component = screen.getByTestId("drag-file-here");
    expect(component).toHaveClass(
      "rounded border border-dashed dark:border-dark-300 dark:bg-dark-600 dark:text-dark-100 w-full h-full flex items-center justify-center",
    );
  });
});
