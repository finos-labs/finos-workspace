import { describe, expect, it } from "vitest";
import {
  getExportableWidgets,
  isExportableWidget,
} from "~/components/LayoutAuth/DropdownSubs/ExcelExportDialog";
import { makeWidget } from "../../../factories";

describe("ExcelExportDialog widget selection", () => {
  it("exports a widget of a backend connection that has parameters", () => {
    const widget = makeWidget({
      connectionType: "advanced-backend",
      storage: { params: { symbol: "AAPL" } },
    });

    expect(isExportableWidget(widget)).toBe(true);
  });

  it("exports a widget with empty parameters", () => {
    const widget = makeWidget({
      connectionType: "advanced-backend",
      storage: { params: {} },
    });

    expect(isExportableWidget(widget)).toBe(true);
  });

  it("skips a widget that is not served by a backend", () => {
    const widget = makeWidget({
      connectionType: "file",
      storage: { params: { symbol: "AAPL" } },
    });

    expect(isExportableWidget(widget)).toBe(false);
  });

  it("skips a widget that has no parameters stored", () => {
    expect(
      isExportableWidget(
        makeWidget({ connectionType: "advanced-backend", storage: {} }),
      ),
    ).toBe(false);
    expect(
      isExportableWidget(
        makeWidget({ connectionType: "advanced-backend", storage: undefined }),
      ),
    ).toBe(false);
  });

  it("keeps the widgets of a dashboard that the export can query, in order", () => {
    const first = makeWidget({
      id: "a",
      connectionType: "advanced-backend",
      storage: { params: { symbol: "AAPL" } },
    });
    const skipped = makeWidget({
      id: "b",
      connectionType: "advanced-backend",
      storage: undefined,
    });
    const last = makeWidget({
      id: "c",
      connectionType: "advanced-backend",
      storage: { params: {} },
    });

    expect(getExportableWidgets([first, skipped, last])).toEqual([first, last]);
  });
});
