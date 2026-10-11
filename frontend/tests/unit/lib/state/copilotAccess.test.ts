import { describe, expect, it } from "vitest";
import {
  allowedModels,
  type CopilotAccess,
  isMcpToolAllowed,
  isMcpToolSwitchedOff,
  isModelAllowed,
  normalizeMcpUrl,
  selectModelId,
} from "~/lib/state/copilotAccess";

const open: CopilotAccess = {
  models: [],
  mcp: [],
  models_restricted: false,
  mcp_restricted: false,
};

const restricted: CopilotAccess = {
  models: [
    { agent_id: "default-copilot", model_id: "fast" },
    { agent_id: "custom", model_id: "smart" },
  ],
  mcp: [
    { server_url: "https://mcp.example.com/mcp", tool_name: "*" },
    { server_url: "https://tools.example.com/mcp", tool_name: "search" },
  ],
  models_restricted: true,
  mcp_restricted: true,
};

describe("normalizeMcpUrl", () => {
  it("keeps the form the backend stores", () => {
    expect(normalizeMcpUrl("https://MCP.Example.com/mcp/")).toBe(
      "https://mcp.example.com/mcp",
    );
    expect(normalizeMcpUrl(" https://mcp.example.com:8443/a/b/?x=1#frag ")).toBe(
      "https://mcp.example.com:8443/a/b",
    );
    expect(normalizeMcpUrl("https://mcp.example.com")).toBe("https://mcp.example.com");
  });
});

describe("isModelAllowed", () => {
  it("allows every model until a role grants some", () => {
    expect(isModelAllowed(null, "any", "model")).toBe(true);
    expect(isModelAllowed(open, "any", "model")).toBe(true);
  });

  it("allows only the granted models of the granted agents", () => {
    expect(isModelAllowed(restricted, "default-copilot", "fast")).toBe(true);
    expect(isModelAllowed(restricted, "default-copilot", "smart")).toBe(false);
    expect(isModelAllowed(restricted, "custom", "fast")).toBe(false);
  });
});

describe("isMcpToolAllowed", () => {
  it("allows every tool until a role grants some", () => {
    expect(isMcpToolAllowed(null, "https://x.example.com", "t")).toBe(true);
    expect(isMcpToolAllowed(open, "https://x.example.com", "t")).toBe(true);
  });

  it("allows all tools of a granted server and only the granted tools of others", () => {
    expect(isMcpToolAllowed(restricted, "https://MCP.example.com/mcp/", "any")).toBe(
      true,
    );
    expect(
      isMcpToolAllowed(restricted, "https://tools.example.com/mcp", "search"),
    ).toBe(true);
    expect(
      isMcpToolAllowed(restricted, "https://tools.example.com/mcp", "delete"),
    ).toBe(false);
    expect(
      isMcpToolAllowed(restricted, "https://other.example.com/mcp", "search"),
    ).toBe(false);
  });
});

describe("allowedModels and selectModelId", () => {
  const models = [{ id: "fast" }, { id: "smart" }];

  it("lists only the models of the agent that are granted", () => {
    expect(allowedModels(restricted, "default-copilot", models)).toEqual([
      { id: "fast" },
    ]);
    expect(allowedModels(open, "default-copilot", models)).toEqual(models);
    expect(allowedModels(open, "default-copilot", undefined)).toEqual([]);
  });

  it("keeps the user's model when they may use it", () => {
    expect(selectModelId(open, "default-copilot", models, "smart")).toBe("smart");
  });

  it("falls back to the first model the user may use", () => {
    expect(selectModelId(restricted, "default-copilot", models, "smart")).toBe("fast");
    expect(selectModelId(restricted, "default-copilot", models, undefined)).toBe(
      "fast",
    );
  });

  it("sends the first model when none is granted, for the service to refuse", () => {
    expect(selectModelId(restricted, "unknown-agent", models, "smart")).toBe("fast");
  });
});

describe("what an administrator switched off", () => {
  const searchOff: CopilotAccess = { ...open, disabled_capabilities: ["SEARCH_WEB"] };
  const bothOff: CopilotAccess = {
    ...open,
    disabled_capabilities: ["SEARCH_WEB", "FETCH_FROM_WEB"],
  };

  it("takes the tools of that capability away, and no others", () => {
    expect(
      isMcpToolAllowed(searchOff, "https://mcp.example.com/mcp", "web_search"),
    ).toBe(false);
    expect(
      isMcpToolAllowed(searchOff, "https://mcp.example.com/mcp", "fetch_webpage"),
    ).toBe(true);
    expect(
      isMcpToolAllowed(searchOff, "https://mcp.example.com/mcp", "execute_sql"),
    ).toBe(true);
    expect(
      isMcpToolAllowed(bothOff, "https://mcp.example.com/mcp", "fetch_webpage"),
    ).toBe(false);
  });

  it("takes reading a fetched page away with fetching it", () => {
    const fetchOff: CopilotAccess = {
      ...open,
      disabled_capabilities: ["FETCH_FROM_WEB"],
    };
    expect(
      isMcpToolAllowed(fetchOff, "https://mcp.example.com/mcp", "inspect_webpage"),
    ).toBe(false);
    expect(
      isMcpToolAllowed(searchOff, "https://mcp.example.com/mcp", "inspect_webpage"),
    ).toBe(true);
  });

  it("goes by the tool's name, so the same tool on another server is as switched off", () => {
    expect(
      isMcpToolAllowed(searchOff, "https://another.example.com/mcp", "web_search"),
    ).toBe(false);
  });

  it("beats what the roles grant", () => {
    const granted: CopilotAccess = {
      ...restricted,
      disabled_capabilities: ["SEARCH_WEB"],
    };
    expect(isMcpToolAllowed(granted, "https://mcp.example.com/mcp", "web_search")).toBe(
      false,
    );
    expect(
      isMcpToolAllowed(granted, "https://mcp.example.com/mcp", "anything_else"),
    ).toBe(true);
  });

  it("changes nothing when nothing is switched off, or for a Workspace that does not say", () => {
    expect(isMcpToolSwitchedOff(open, "web_search")).toBe(false);
    expect(isMcpToolSwitchedOff(null, "web_search")).toBe(false);
    expect(
      isMcpToolSwitchedOff({ ...open, disabled_capabilities: [] }, "web_search"),
    ).toBe(false);
    expect(isMcpToolAllowed(open, "https://mcp.example.com/mcp", "web_search")).toBe(
      true,
    );
  });
});
