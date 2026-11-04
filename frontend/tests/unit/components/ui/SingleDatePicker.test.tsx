import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SingleDatePicker } from "~/components/ui/SingleDatePicker";

vi.mock("~/components/ui/Calendar", () => ({
  Calendar: ({ onSelect }: { onSelect: (date: Date) => void }) => (
    <div data-testid="mock-calendar">
      <button onClick={() => onSelect(new Date("2023-05-20"))}>Select date</button>
    </div>
  ),
}));

describe("SingleDatePicker", () => {
  const onSave = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with default date", () => {
    render(<SingleDatePicker defaultDate="2023-01-01" onSave={onSave} />);
    expect(screen.getByText("Jan 01, 2023")).toBeInTheDocument();
  });

  it("calls onSave when a date is selected", async () => {
    render(<SingleDatePicker defaultDate="2023-01-01" onSave={onSave} />);

    fireEvent.click(screen.getByText("Jan 01, 2023"));

    const selectBtn = await screen.findByText("Select date");
    fireEvent.click(selectBtn);

    expect(onSave).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledWith(expect.stringContaining("2023-05"));
  });

  it("calls onSave with empty string when cleared", async () => {
    render(<SingleDatePicker defaultDate="2023-01-01" onSave={onSave} />);

    fireEvent.click(screen.getByText("Jan 01, 2023"));

    const clearBtn = await screen.findByText("Clear");
    fireEvent.click(clearBtn);

    expect(onSave).toHaveBeenCalledWith("");
  });
});
