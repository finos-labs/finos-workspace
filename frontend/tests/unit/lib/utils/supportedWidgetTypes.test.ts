import { describe, expect, it } from "vitest";
import { getWidgetComponent } from "~/components/Widgets";
import { isWidgetVizType, WidgetVizTypes } from "~/lib/types/app";
import { partitionSupportedWidgets } from "~/lib/utils/validateBackend";

const widget = (type?: string) => ({
  name: "A widget",
  description: "A widget",
  endpoint: "/a",
  ...(type ? { type } : {}),
});

describe("the widget types this Workspace renders", () => {
  it("renders markdown, html, iframe, newsfeed and pdf", () => {
    expect([...WidgetVizTypes].sort()).toEqual([
      "html",
      "iframe",
      "markdown",
      "newsfeed",
      "pdf",
    ]);
  });

  it("does not know note, rich_note or table as a widget type of a backend", () => {
    for (const type of ["note", "rich_note", "table"]) {
      expect(isWidgetVizType(type)).toBe(false);
    }
    expect(isWidgetVizType("markdown")).toBe(true);
    expect(isWidgetVizType("newsfeed")).toBe(true);
  });

  it("has a component for each widget the Workspace renders", () => {
    for (const type of WidgetVizTypes) {
      expect(getWidgetComponent(type)).toBeDefined();
    }
    expect(getWidgetComponent("rich_note" as never)).toBeUndefined();
    expect(getWidgetComponent("rss_viewer" as never)).toBeUndefined();
  });

  it("keeps a backend's markdown and newsfeed widgets and leaves out the types it cannot render", () => {
    const { supported, unsupported } = partitionSupportedWidgets({
      notes: widget("markdown"),
      headlines: widget("newsfeed"),
      memo: widget("note"),
      prices: widget("table"),
      untyped: widget(),
    } as never);

    expect(Object.keys(supported)).toEqual(["notes", "headlines"]);
    expect(unsupported).toEqual(["memo", "prices", "untyped"]);
  });

  it("hands an entry that is not a widget on, to be reported as invalid", () => {
    const { supported, unsupported } = partitionSupportedWidgets({
      notes: widget("markdown"),
      nothing: null,
      text: "just a string",
    } as never);

    expect(Object.keys(supported)).toEqual(["notes", "nothing", "text"]);
    expect(unsupported).toEqual([]);
  });
});
