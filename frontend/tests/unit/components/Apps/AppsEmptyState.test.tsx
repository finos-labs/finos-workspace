import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppsEmptyState from "~/components/Apps/AppsEmptyState";
import type { SharingLevel } from "~/lib/state/access";
import { setAccess } from "../../factories";

describe("AppsEmptyState", () => {
  it("shows a user whose roles let them share how to share apps", () => {
    setAccess({ sharing: "share" });
    render(<AppsEmptyState />);

    expect(screen.getByText("Save a Dashboard as an App")).toBeInTheDocument();
    expect(screen.getByText("Share Apps")).toBeInTheDocument();
  });

  it.each<SharingLevel>([
    "none",
    "receive",
  ])("does not show sharing to a user whose sharing is %s", (sharing) => {
    setAccess({ sharing });
    render(<AppsEmptyState />);

    expect(screen.getByText("Save a Dashboard as an App")).toBeInTheDocument();
    expect(screen.queryByText("Share Apps")).not.toBeInTheDocument();
  });
});
