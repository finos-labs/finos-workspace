import { describe, expect, it } from "vitest";
import { getWidgetComponent } from "~/components/Widgets";
import {
  isBuiltInVizType,
  isRenderableVizType,
  isWellFormedVizType,
  WidgetVizTypes,
} from "~/lib/types/app";
import { validateWidgetItems } from "~/lib/utils/validateBackend";
import { widgetsSchema } from "../../../mocks/widgetsSchema";

const widget = (type?: string) => ({
  name: "A widget",
  description: "A widget",
  endpoint: "/a",
  ...(type ? { type } : {}),
});

describe("the widget types this FINOS Workspace renders", () => {
  it("renders markdown, html, iframe, newsfeed and pdf itself", () => {
    expect([...WidgetVizTypes].sort()).toEqual([
      "html",
      "iframe",
      "markdown",
      "newsfeed",
      "pdf",
    ]);
  });

  it("does not build in note, rich_note or table", () => {
    for (const type of ["note", "rich_note", "table"]) {
      expect(isBuiltInVizType(type)).toBe(false);
    }
    expect(isBuiltInVizType("markdown")).toBe(true);
    expect(isBuiltInVizType("newsfeed")).toBe(true);
  });

  it("renders another type only when an available widget plugin handles it", () => {
    expect(isRenderableVizType("table")).toBe(false);
    expect(isRenderableVizType("table", new Set(["table"]))).toBe(true);
    expect(isRenderableVizType("chart", new Set(["table"]))).toBe(false);
    expect(isRenderableVizType("markdown", new Set())).toBe(true);
  });

  it("accepts any lowercase type name as well formed", () => {
    expect(isWellFormedVizType("plotly_chart")).toBe(true);
    expect(isWellFormedVizType("Table")).toBe(false);
    expect(isWellFormedVizType("x")).toBe(false);
    expect(isWellFormedVizType("")).toBe(false);
    expect(isWellFormedVizType(undefined)).toBe(false);
  });

  it("has a component for each widget the FINOS Workspace renders itself", () => {
    for (const type of WidgetVizTypes) {
      expect(getWidgetComponent(type)).toBeDefined();
    }
    expect(getWidgetComponent("rich_note" as never)).toBeUndefined();
    expect(getWidgetComponent("rss_viewer" as never)).toBeUndefined();
  });

  it("leaves out the types nothing enabled for the entity renders, and names them", () => {
    const { valid, unsupported, unrendered, invalid } = validateWidgetItems(
      {
        notes: widget("markdown"),
        headlines: widget("newsfeed"),
        memo: widget("note"),
        prices: widget("table"),
        chart: widget("test_chart"),
        untyped: widget(),
        bad: widget("Bad Type"),
      },
      { schema: widgetsSchema },
    );

    expect(Object.keys(valid)).toEqual(["notes", "headlines", "chart"]);
    expect(unsupported).toEqual(["memo", "prices"]);
    expect(unrendered).toEqual(["chart"]);
    expect(invalid.map((item) => item.id)).toEqual(["untyped", "bad"]);
  });

  it("does not name a type an available plugin renders", () => {
    const { unrendered } = validateWidgetItems(
      { chart: widget("test_chart") },
      { schema: widgetsSchema, pluginTypes: new Set(["test_chart"]) },
    );
    expect(unrendered).toEqual([]);
  });
});
