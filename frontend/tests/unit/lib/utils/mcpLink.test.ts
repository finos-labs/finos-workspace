import { describe, expect, it } from "vitest";
import type { ParamDef } from "~/components/types";
import type { AgentToolConfig, McpServer } from "~/lib/state/mcpTools";
import type { McpToolContractT } from "~/lib/types/widgetsContract";
import { activeMcpLink, citeMcpCall, withMcpLinks } from "~/lib/utils/mcpLink";

const server = (overrides: Partial<McpServer> = {}): McpServer => ({
  id: "srv-1",
  name: "Team data",
  declaredName: "Team data",
  url: "https://mcp.example/a",
  enabled: true,
  tools: [],
  sourceId: "backend-a",
  ...overrides,
});

const tool = (overrides: Partial<AgentToolConfig> = {}): AgentToolConfig => ({
  server_id: "srv-1",
  name: "srv-1_get_team_report",
  tool_name: "get_team_report",
  url: "https://mcp.example/a",
  ...overrides,
});

const widget = (
  link: McpToolContractT,
  overrides: { sourceId?: string; widgetId?: string; params?: ParamDef[] } = {},
) => ({
  sourceId: "backend-a",
  widgetId: "team_report",
  params: [
    { paramName: "team", type: "text" },
    { paramName: "period", type: "text" },
  ] as ParamDef[],
  mcp_tool: link,
  ...overrides,
});

const LINK = {
  mcp_server: "Team data",
  tool_id: "get_team_report",
  args: { team_id: "$team", period: "$period" },
};

describe("the active link (WIDGETS-JSON 5.3 and 5.4)", () => {
  it("is the tool as the request lists it, with the declared mapping", () => {
    expect(activeMcpLink(widget(LINK), [tool()], [server()])).toEqual({
      server_id: "srv-1",
      tool_name: "get_team_report",
      args: LINK.args,
    });
  });

  it("is none while the tool is not in the agent's tools", () => {
    expect(activeMcpLink(widget(LINK), [], [server()])).toBeUndefined();
    expect(
      activeMcpLink(widget(LINK), [tool({ tool_name: "other" })], [server()]),
    ).toBeUndefined();
  });

  it("is only to a server of the widget's own backend, by its declared name", () => {
    expect(
      activeMcpLink(widget(LINK), [tool()], [server({ sourceId: "backend-b" })]),
    ).toBeUndefined();
    expect(
      activeMcpLink(
        widget(LINK),
        [tool()],
        [server({ declaredName: "Other", name: "Team data", clientName: "Team data" })],
      ),
    ).toBeUndefined();
    expect(
      activeMcpLink(widget({ ...LINK, mcp_server: "team data" }), [tool()], [server()]),
    ).toBeUndefined();
  });

  it("is added to the rows of linked widgets only", () => {
    const rows = [{ widget_id: "team_report" }, { widget_id: "notes" }];
    const linked = withMcpLinks(rows, [tool()], [server()], (row) =>
      row.widget_id === "team_report" ? widget(LINK) : undefined,
    );
    expect(linked[0].mcp_tool?.tool_name).toBe("get_team_report");
    expect(linked[1]).toEqual({ widget_id: "notes" });
    expect(withMcpLinks(rows, [], [server()], () => widget(LINK))).toBe(rows);
  });
});

describe("citing a call of a linked tool (5.3, rule 5, and 5.4)", () => {
  it("builds input_args through the mapping in reverse, and keeps the rest as details", () => {
    const citation = citeMcpCall(
      server(),
      "get_team_report",
      { team_id: "platform", period: "month", verbose: true },
      [widget(LINK)],
    );
    expect(citation?.widget.widgetId).toBe("team_report");
    expect(citation?.inputArgs).toEqual({ team: "platform", period: "month" });
    expect(citation?.details).toEqual({ verbose: true });
  });

  it("maps arguments named like params when the link has no mapping", () => {
    const citation = citeMcpCall(
      server(),
      "get_team_report",
      { team: "platform", limit: 5 },
      [widget({ mcp_server: "Team data", tool_id: "get_team_report" })],
    );
    expect(citation?.inputArgs).toEqual({ team: "platform" });
    expect(citation?.details).toEqual({ limit: 5 });
  });

  it("picks among widgets by their literal args, the most literals first, then the first declared", () => {
    const general = widget(
      { ...LINK, args: { team_id: "$team" } },
      { widgetId: "general" },
    );
    const eu = widget(
      { ...LINK, args: { team_id: "$team", region: "eu" } },
      { widgetId: "eu" },
    );
    const euMonthly = widget(
      { ...LINK, args: { team_id: "$team", region: "eu", period: "month" } },
      { widgetId: "eu_monthly" },
    );
    const widgets = [general, eu, euMonthly];
    const cite = (args: Record<string, unknown>) =>
      citeMcpCall(server(), "get_team_report", args, widgets)?.widget.widgetId;

    expect(cite({ team_id: "a", region: "eu", period: "month" })).toBe("eu_monthly");
    expect(cite({ team_id: "a", region: "eu" })).toBe("eu");
    expect(cite({ team_id: "a", region: "us" })).toBe("general");
    expect(
      citeMcpCall(server(), "get_team_report", { team_id: "a", region: "eu" }, widgets)
        ?.details,
    ).toEqual({ region: "eu" });
  });

  it("does not cite a widget of another backend, or a server registered without its declared name", () => {
    const other = widget(LINK, { sourceId: "backend-b" });
    expect(citeMcpCall(server(), "get_team_report", {}, [other])).toBeNull();
    expect(
      citeMcpCall(server({ declaredName: undefined }), "get_team_report", {}, [
        widget(LINK),
      ]),
    ).toBeNull();
    expect(citeMcpCall(server(), "GET_TEAM_REPORT", {}, [widget(LINK)])).toBeNull();
  });
});
