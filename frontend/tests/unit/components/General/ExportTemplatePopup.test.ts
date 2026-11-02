import { describe, expect, it } from "vitest";
import type { AppMetadataForm } from "~/components/General/AppDialog/schema";
import { formatDashboardDataForTemplate } from "~/components/General/ExportTemplatePopup";
import type { TabData } from "~/lib/state/app";
import "../../../mocks/runtimeConfig";

const form = {
  name: "App",
  description: "",
  imageUrl: "",
  prompts: [],
} as AppMetadataForm;

function exported(params: Record<string, unknown>[], stored: Record<string, unknown>) {
  const dashboard = {
    widgets: [{ id: "w1", params, storage: { params: stored } }],
    groups: [],
    gridLayout: { overview: [{ i: "w1", x: 0, y: 0, w: 20, h: 10 }] },
  } as unknown as TabData;
  return formatDashboardDataForTemplate(dashboard, form).tabs.overview.layout[0];
}

describe("the values that an exported app starts with", () => {
  const params = [
    { paramName: "active", type: "boolean", value: true },
    { paramName: "offset", type: "number", value: 5 },
    { paramName: "region", type: "text", value: "eu" },
  ];

  it("keeps a value of false or 0 that the user chose", () => {
    const layout = exported(params, { active: false, offset: 0, region: "us" });
    expect(layout.state).toEqual({
      params: { active: false, offset: 0, region: "us" },
    });
  });

  it("keeps a lone value of false or 0", () => {
    expect(exported(params, { active: false }).state).toEqual({
      params: { active: false },
    });
    expect(exported(params, { offset: 0 }).state).toEqual({ params: { offset: 0 } });
  });

  it("leaves out a value that is the default, including a default of false or 0", () => {
    const defaults = [
      { paramName: "active", type: "boolean", value: false },
      { paramName: "offset", type: "number", value: 0 },
    ];
    expect(exported(defaults, { active: false, offset: 0 }).state).toBeUndefined();
  });

  it("keeps the value that clears a parameter", () => {
    expect(exported(params, { region: "" }).state).toEqual({ params: { region: "" } });
  });
});
