import { vi } from "vitest";

vi.mock("~/components/Icon", () => ({
  default: vi.fn(({ id, className }) => {
    const React = require("react");
    return React.createElement("svg", {
      "data-testid": `icon-${id}`,
      className,
    });
  }),
}));
