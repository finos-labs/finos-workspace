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
  it("renders markdown, html, iframe and pdf", () => {
    expect([...WidgetVizTypes].sort()).toEqual(["html", "iframe", "markdown", "pdf"]);
  });

  it("does not know newsfeed, note or rich_note as a widget type of a backend", () => {
    for (const type of ["newsfeed", "note", "rich_note", "table"]) {
      expect(isWidgetVizType(type)).toBe(false);
    }
    expect(isWidgetVizType("markdown")).toBe(true);
  });

  it("has a component for each widget the Workspace places itself", () => {
    expect(getWidgetComponent("markdown")).toBeDefined();
    expect(getWidgetComponent("rss_viewer")).toBeDefined();
    expect(getWidgetComponent("rich_note" as never)).toBeUndefined();
    expect(getWidgetComponent("newsfeed" as never)).toBeUndefined();
  });

  it("keeps a backend's markdown widgets and leaves out the types it cannot render", () => {
    const { supported, unsupported } = partitionSupportedWidgets({
      notes: widget("markdown"),
      headlines: widget("newsfeed"),
      memo: widget("note"),
      prices: widget("table"),
      untyped: widget(),
    } as never);

    expect(Object.keys(supported)).toEqual(["notes"]);
    expect(unsupported).toEqual(["headlines", "memo", "prices", "untyped"]);
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
