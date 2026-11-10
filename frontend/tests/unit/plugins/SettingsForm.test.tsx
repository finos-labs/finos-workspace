import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CardDetailsForm, SettingsForm } from "~/plugins/SettingsForm";
import type { SettingsSchema } from "~/plugins/types";

describe("the card's name and description in Settings", () => {
  it("edits the name and the description of the card", () => {
    const onChange = vi.fn();
    render(
      <CardDetailsForm
        values={{
          name: "Trades SQL (static)",
          description: "A static copy of Trades SQL",
        }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Trades at close" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      name: "Trades at close",
      description: "A static copy of Trades SQL",
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Closing book" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      name: "Trades SQL (static)",
      description: "Closing book",
    });
  });

  it("is read-only on a shared dashboard", () => {
    render(
      <CardDetailsForm
        values={{ name: "A", description: "" }}
        onChange={vi.fn()}
        disabled={true}
      />,
    );
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Description")).toBeDisabled();
  });
});

describe("a boolean setting in Settings", () => {
  const schema: SettingsSchema = {
    properties: {
      dataTable: {
        type: "boolean",
        title: "Data table",
        description: "Show the marks of the map as a table instead of the map.",
      },
    },
  };

  it("is a checkbox named by its title that sets the value", () => {
    const onChange = vi.fn();
    render(
      <SettingsForm
        schema={schema}
        values={{ dataTable: false }}
        onChange={onChange}
      />,
    );
    const box = screen.getByRole("checkbox", { name: "Data table" });
    expect(box).toHaveAttribute("aria-checked", "false");
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith({ dataTable: true });
  });

  it("shows the value and clears it", () => {
    const onChange = vi.fn();
    render(
      <SettingsForm schema={schema} values={{ dataTable: true }} onChange={onChange} />,
    );
    const box = screen.getByRole("checkbox", { name: "Data table" });
    expect(box).toHaveAttribute("aria-checked", "true");
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith({ dataTable: false });
  });

  it("starts from the default of the setting", () => {
    const withDefault: SettingsSchema = {
      properties: {
        dataTable: { type: "boolean", title: "Data table", default: true },
      },
    };
    render(<SettingsForm schema={withDefault} values={{}} onChange={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Data table" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("keeps its description out of the body and its title once", () => {
    render(<SettingsForm schema={schema} values={{}} onChange={vi.fn()} />);
    expect(
      screen.queryByText("Show the marks of the map as a table instead of the map."),
    ).toBeNull();
    expect(screen.getAllByText("Data table")).toHaveLength(1);
    expect(
      screen.getByRole("checkbox", { name: "Data table" }),
    ).toHaveAccessibleDescription(
      "Show the marks of the map as a table instead of the map.",
    );
  });

  it("labels the checkbox from above like the other fields", () => {
    render(<SettingsForm schema={schema} values={{}} onChange={vi.fn()} />);
    const box = screen.getByRole("checkbox", { name: "Data table" });
    const label = screen.getByText("Data table").closest("label") as HTMLElement;
    expect(label).toHaveAttribute("for", box.id);
    expect(
      label.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is read-only on a shared dashboard", () => {
    render(
      <SettingsForm
        schema={schema}
        values={{ dataTable: false }}
        onChange={vi.fn()}
        disabled={true}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Data table" })).toBeDisabled();
  });
});

describe("the other settings of a plugin card", () => {
  const schema: SettingsSchema = {
    properties: {
      zoom: {
        type: "number",
        title: "Zoom",
        description: "Zoom of the view, from 0 to 24.",
        minimum: 0,
        maximum: 24,
      },
      label: { type: "string", title: "Label", maxLength: 20 },
      provider: {
        type: "string",
        title: "Tile service",
        enum: ["none", "openfreemap"],
      },
    },
  };

  it("sets a number, and clears it when the field is emptied", () => {
    const onChange = vi.fn();
    render(
      <SettingsForm
        schema={schema}
        values={{ zoom: 3, label: "A", provider: "none" }}
        onChange={onChange}
      />,
    );
    const zoom = screen.getByRole("spinbutton", { name: "Zoom" });
    expect(zoom).toHaveAttribute("type", "number");
    expect(zoom).toHaveAttribute("min", "0");
    expect(zoom).toHaveAttribute("max", "24");
    expect(zoom).toHaveValue(3);
    fireEvent.change(zoom, { target: { value: "3.5" } });
    expect(onChange).toHaveBeenLastCalledWith({
      zoom: 3.5,
      label: "A",
      provider: "none",
    });
    fireEvent.change(zoom, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({
      zoom: undefined,
      label: "A",
      provider: "none",
    });
  });

  it("sets text up to its length", () => {
    const onChange = vi.fn();
    render(
      <SettingsForm schema={schema} values={{ label: "A" }} onChange={onChange} />,
    );
    const label = screen.getByRole("textbox", { name: "Label" });
    expect(label).toHaveAttribute("maxlength", "20");
    fireEvent.change(label, { target: { value: "Offices" } });
    expect(onChange).toHaveBeenLastCalledWith({ label: "Offices" });
  });

  it("shows the chosen option of a list", () => {
    render(
      <SettingsForm
        schema={schema}
        values={{ provider: "openfreemap" }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: /^Tile service/ })).toHaveTextContent(
      "openfreemap",
    );
  });

  it("keeps the description of a setting out of the body", () => {
    render(<SettingsForm schema={schema} values={{}} onChange={vi.fn()} />);
    expect(screen.queryByText("Zoom of the view, from 0 to 24.")).toBeNull();
    expect(
      screen.getByRole("spinbutton", { name: "Zoom" }),
    ).toHaveAccessibleDescription("Zoom of the view, from 0 to 24.");
  });

  it("shows the description in a hint beside the label", async () => {
    render(<SettingsForm schema={schema} values={{}} onChange={vi.fn()} />);
    await userEvent.hover(screen.getByRole("button", { name: "About Zoom" }));
    expect(
      (await screen.findAllByText("Zoom of the view, from 0 to 24.")).length,
    ).toBeGreaterThan(0);
  });

  it("gives no hint to a setting without a description", () => {
    render(<SettingsForm schema={schema} values={{}} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "About Label" })).toBeNull();
  });

  it("has a heading only when it is given a title", () => {
    const { rerender } = render(
      <SettingsForm schema={schema} values={{}} onChange={vi.fn()} />,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    rerender(
      <SettingsForm schema={schema} values={{}} onChange={vi.fn()} title="Settings" />,
    );
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("is read-only on a shared dashboard", () => {
    render(
      <SettingsForm
        schema={schema}
        values={{ zoom: 3, provider: "none" }}
        onChange={vi.fn()}
        disabled={true}
      />,
    );
    expect(screen.getByRole("spinbutton", { name: "Zoom" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Label" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: /^Tile service/ })).toBeDisabled();
  });
});
