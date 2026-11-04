import { describe, expect, it } from "vitest";
import {
  ALL_MODELS,
  allowedModels,
  type CopilotAccess,
  grantAgentId,
  isAgentGranted,
  isMcpToolAllowed,
  isMcpToolSwitchedOff,
  isModelAllowed,
  normalizeMcpUrl,
  selectModelId,
} from "~/lib/state/copilotAccess";

const none: CopilotAccess = { models: [], mcp: [] };

const granted: CopilotAccess = {
  models: [
    { agent_id: "default_agent", model_id: "fast" },
    { agent_id: "custom", model_id: "smart" },
  ],
  mcp: [
    { server_url: "https://mcp.example.com/mcp", tool_name: "*" },
    { server_url: "https://tools.example.com/mcp", tool_name: "search" },
  ],
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

describe("grantAgentId", () => {
  it("files grants under the id the agent gives itself in its agents.json", () => {
    expect(grantAgentId("default-copilot")).toBe("default_agent");
    expect(grantAgentId("custom")).toBe("custom");
  });
});

describe("isModelAllowed", () => {
  it("allows no model when no role grants one or the access is not loaded", () => {
    expect(isModelAllowed(null, "default-copilot", "fast")).toBe(false);
    expect(isModelAllowed(undefined, "default-copilot", "fast")).toBe(false);
    expect(isModelAllowed(none, "default-copilot", "fast")).toBe(false);
  });

  it("allows only the granted models of the granted agents", () => {
    expect(isModelAllowed(granted, "default-copilot", "fast")).toBe(true);
    expect(isModelAllowed(granted, "default-copilot", "smart")).toBe(false);
    expect(isModelAllowed(granted, "custom", "fast")).toBe(false);
  });

  it("allows every model of an agent granted with *, and of that agent only", () => {
    const all: CopilotAccess = {
      models: [{ agent_id: "default_agent", model_id: ALL_MODELS }],
      mcp: [],
    };
    expect(isModelAllowed(all, "default-copilot", "fast")).toBe(true);
    expect(isModelAllowed(all, "default-copilot", "ollama:stub")).toBe(true);
    expect(isModelAllowed(all, "custom", "fast")).toBe(false);
  });
});

describe("isAgentGranted", () => {
  it("is whether a role grants any model of the agent", () => {
    expect(isAgentGranted(granted, "default-copilot")).toBe(true);
    expect(isAgentGranted(granted, "other")).toBe(false);
    expect(isAgentGranted(none, "default-copilot")).toBe(false);
    expect(isAgentGranted(null, "default-copilot")).toBe(false);
  });
});

describe("isMcpToolAllowed", () => {
  it("allows no tool when no role grants one or the access is not loaded", () => {
    expect(isMcpToolAllowed(null, "https://mcp.example.com/mcp", "t")).toBe(false);
    expect(isMcpToolAllowed(undefined, "https://mcp.example.com/mcp", "t")).toBe(false);
    expect(isMcpToolAllowed(none, "https://mcp.example.com/mcp", "t")).toBe(false);
  });

  it("allows all tools of a server granted with * and only the granted tools of others", () => {
    expect(isMcpToolAllowed(granted, "https://MCP.example.com/mcp/", "any")).toBe(true);
    expect(isMcpToolAllowed(granted, "https://tools.example.com/mcp", "search")).toBe(
      true,
    );
    expect(isMcpToolAllowed(granted, "https://tools.example.com/mcp", "delete")).toBe(
      false,
    );
    expect(isMcpToolAllowed(granted, "https://other.example.com/mcp", "search")).toBe(
      false,
    );
  });
});

describe("allowedModels and selectModelId", () => {
  const models = [{ id: "fast" }, { id: "smart" }];

  it("lists only the models of the agent that are granted", () => {
    expect(allowedModels(granted, "default-copilot", models)).toEqual([{ id: "fast" }]);
    expect(allowedModels(none, "default-copilot", models)).toEqual([]);
    expect(allowedModels(null, "default-copilot", models)).toEqual([]);
    expect(allowedModels(granted, "default-copilot", undefined)).toEqual([]);
  });

  it("keeps the user's model when they may use it", () => {
    expect(selectModelId(granted, "custom", models, "smart")).toBe("smart");
  });

  it("falls back to the first model the user may use", () => {
    expect(selectModelId(granted, "default-copilot", models, "smart")).toBe("fast");
    expect(selectModelId(granted, "default-copilot", models, undefined)).toBe("fast");
  });

  it("sends the first model when none is granted, for the service to refuse", () => {
    expect(selectModelId(granted, "unknown-agent", models, "smart")).toBe("fast");
    expect(selectModelId(none, "default-copilot", models, "smart")).toBe("fast");
  });
});

describe("what an administrator switched off", () => {
  const all: CopilotAccess = {
    models: [],
    mcp: [
      { server_url: "https://mcp.example.com/mcp", tool_name: "*" },
      { server_url: "https://another.example.com/mcp", tool_name: "*" },
    ],
  };
  const searchOff: CopilotAccess = { ...all, disabled_capabilities: ["SEARCH_WEB"] };
  const bothOff: CopilotAccess = {
    ...all,
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
      ...all,
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

  it("beats a grant of that very tool", () => {
    const granted: CopilotAccess = {
      models: [],
      mcp: [{ server_url: "https://mcp.example.com/mcp", tool_name: "web_search" }],
      disabled_capabilities: ["SEARCH_WEB"],
    };
    expect(isMcpToolAllowed(granted, "https://mcp.example.com/mcp", "web_search")).toBe(
      false,
    );
  });

  it("grants nothing when it is on: the tool still needs a role that grants it", () => {
    expect(isMcpToolSwitchedOff(all, "web_search")).toBe(false);
    expect(isMcpToolSwitchedOff(null, "web_search")).toBe(false);
    expect(
      isMcpToolSwitchedOff({ ...all, disabled_capabilities: [] }, "web_search"),
    ).toBe(false);
    expect(isMcpToolAllowed(all, "https://mcp.example.com/mcp", "web_search")).toBe(
      true,
    );
    expect(isMcpToolAllowed(none, "https://mcp.example.com/mcp", "web_search")).toBe(
      false,
    );
  });
});
