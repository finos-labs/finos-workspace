import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { TabsParam } from "~/components/WidgetParams/TabsParam";

describe("TabsParam", () => {
  const mockOptions = [
    { label: "Option 1", value: "option1" },
    { label: "Option 2", value: "option2" },
    { label: "Option 3", value: "option3" },
  ];

  describe("Basic rendering", () => {
    it("renders all options", () => {
      render(
        <TabsParam value="option1" options={mockOptions} onValueChange={vi.fn()} />,
      );

      expect(screen.getByText("Option 1")).toBeInTheDocument();
      expect(screen.getByText("Option 2")).toBeInTheDocument();
      expect(screen.getByText("Option 3")).toBeInTheDocument();
    });

    it("shows the selected value", () => {
      render(
        <TabsParam value="option2" options={mockOptions} onValueChange={vi.fn()} />,
      );

      const selectedOption = screen.getByText("Option 2");
      expect(selectedOption.closest('[data-state="on"]')).toBeInTheDocument();
    });
  });

  describe("User interactions", () => {
    it("calls onValueChange when an option is clicked", async () => {
      const user = userEvent.setup();
      const handleValueChange = vi.fn();

      render(
        <TabsParam
          value="option1"
          options={mockOptions}
          onValueChange={handleValueChange}
        />,
      );

      await user.click(screen.getByText("Option 2"));

      expect(handleValueChange).toHaveBeenCalledWith("option2");
      expect(handleValueChange).toHaveBeenCalledTimes(1);
    });

    it("does not call onValueChange when undefined is passed (same option clicked)", async () => {
      const user = userEvent.setup();
      const handleValueChange = vi.fn();

      render(
        <TabsParam
          value="option1"
          options={mockOptions}
          onValueChange={handleValueChange}
        />,
      );

      await user.click(screen.getByText("Option 1"));

      expect(handleValueChange).not.toHaveBeenCalled();
    });
  });

  describe("Tooltip support", () => {
    it("renders tooltip when toolTipMessage is provided", async () => {
      const user = userEvent.setup();
      const tooltipMessage = (
        <div>
          <div>Ratio Category</div>
          <div>Select the financial ratio category</div>
        </div>
      );

      render(
        <TabsParam
          value="option1"
          options={mockOptions}
          onValueChange={vi.fn()}
          toolTipMessage={tooltipMessage}
        />,
      );

      const toggleGroup = screen.getByRole("group");
      expect(toggleGroup).toBeInTheDocument();

      await user.hover(toggleGroup);

      await waitFor(
        () => {
          const tooltipElements = screen.getAllByText("Ratio Category");
          expect(tooltipElements.length).toBeGreaterThan(0);
        },
        { timeout: 1500 },
      );
    });

    it("does not render tooltip when toolTipMessage is not provided", () => {
      render(
        <TabsParam value="option1" options={mockOptions} onValueChange={vi.fn()} />,
      );

      expect(screen.getByText("Option 1")).toBeInTheDocument();
    });
  });

  describe("Edge cases", () => {
    it("handles empty options array", () => {
      render(<TabsParam value="" options={[]} onValueChange={vi.fn()} />);

      const toggleGroup = screen.getByRole("group");
      expect(toggleGroup).toBeInTheDocument();
      expect(toggleGroup.children).toHaveLength(0);
    });

    it("handles value that doesn't match any option", () => {
      render(
        <TabsParam value="nonexistent" options={mockOptions} onValueChange={vi.fn()} />,
      );

      expect(screen.getByText("Option 1")).toBeInTheDocument();

      const selectedItems = screen.queryAllByRole("radio", { checked: true });
      expect(selectedItems).toHaveLength(0);
    });
  });

  describe("Accessibility", () => {
    it("renders as group with radio items", () => {
      render(
        <TabsParam value="option1" options={mockOptions} onValueChange={vi.fn()} />,
      );

      const toggleGroup = screen.getByRole("group");
      expect(toggleGroup).toBeInTheDocument();

      const radios = screen.getAllByRole("radio");
      expect(radios).toHaveLength(3);
    });

    it("supports keyboard interaction via Space key", async () => {
      const user = userEvent.setup();
      const handleValueChange = vi.fn();

      render(
        <TabsParam
          value="option1"
          options={mockOptions}
          onValueChange={handleValueChange}
        />,
      );

      const secondRadio = await screen.findByRole("radio", { name: "Option 2" });

      await act(async () => {
        secondRadio.focus();
        await user.keyboard(" ");
      });

      expect(handleValueChange).toHaveBeenCalledWith("option2");
    });
  });
});
