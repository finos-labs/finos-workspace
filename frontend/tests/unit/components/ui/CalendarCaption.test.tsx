import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Calendar } from "~/components/ui/Calendar";

describe("Calendar caption dropdowns", () => {
  it("sizes the year column to its content and lets the month take the rest", () => {
    const { container } = render(
      <Calendar isSingle mode="single" captionLayout="dropdown" />,
    );

    const dropdowns = container.querySelector(".rdp-dropdown_root")?.parentElement;
    expect(dropdowns).toHaveClass("grid", "grid-cols-[minmax(0,1fr)_auto]");
  });

  it("renders the caption selects at the compact size, not the default md", () => {
    render(<Calendar isSingle mode="single" captionLayout="dropdown" />);

    const [monthTrigger, yearTrigger] = screen.getAllByRole("combobox");
    for (const trigger of [monthTrigger, yearTrigger]) {
      expect(trigger).toHaveClass("gap-1");
      expect(trigger).not.toHaveClass("gap-2");
    }
  });
});
