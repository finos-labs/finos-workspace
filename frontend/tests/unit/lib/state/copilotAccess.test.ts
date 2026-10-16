import { describe, expect, it } from "vitest";
import {
  allowedModels,
  type CopilotAccess,
  grantAgentId,
  isMcpToolAllowed,
  isModelAllowed,
  normalizeMcpUrl,
  selectModelId,
} from "~/lib/state/copilotAccess";

const none: CopilotAccess = { models: [], mcp: [] };

const granted: CopilotAccess = {
  models: [
    // The default agent's grants carry the id its agents.json gives it
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
    // The web app knows the default agent as default-copilot
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
