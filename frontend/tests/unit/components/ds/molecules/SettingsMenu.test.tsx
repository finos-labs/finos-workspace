import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SettingsMenu from "~/components/ds/molecules/SettingsMenu";
import { required } from "../../../mocks";

describe("SettingsMenu Molecule", () => {
  it("renders with title and children", () => {
    render(
      <SettingsMenu title="Test Title">
        <div>Content</div>
      </SettingsMenu>,
    );

    expect(screen.getByText("Test Title")).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("handles collapse correctly when enabled", () => {
    const { container } = render(
      <SettingsMenu title="Collapsible" canCollapse={true}>
        <div>Hidden Content</div>
      </SettingsMenu>,
    );

    const titleContainer = required(screen.getByText("Collapsible").parentElement);

    expect(screen.getByText("Hidden Content")).toBeInTheDocument();

    fireEvent.click(titleContainer);
  });

  it("shows tooltip when provided", () => {
    render(
      <SettingsMenu title="Tooltip Title" tooltip="Help text">
        <div>Content</div>
      </SettingsMenu>,
    );
    expect(screen.getByText("Tooltip Title")).toBeInTheDocument();
  });
});
