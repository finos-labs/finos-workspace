import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  buildMcpConnectSnippets,
  CODEX_TOKEN_ENV_VAR,
  MCP_SERVER_NAME,
  McpConnectSnippets,
} from "~/components/LayoutAuth/McpConnectSnippets";

const ENDPOINT = "https://backend.test/mcp";
const TOKEN = "ws_mcp_created123_secret";
const ORIGIN = "https://workspace.test";

describe("buildMcpConnectSnippets", () => {
  it("returns one snippet per supported client", () => {
    const snippets = buildMcpConnectSnippets(ENDPOINT, TOKEN, ORIGIN);
    expect(snippets.map((snippet) => snippet.label)).toEqual([
      "Prompt",
      ".mcp.json",
      "Claude Code",
      "Codex",
    ]);
  });

  it("bakes the endpoint, bearer token and origin into every snippet", () => {
    const snippets = buildMcpConnectSnippets(ENDPOINT, TOKEN, ORIGIN);
    for (const snippet of snippets) {
      expect(snippet.text).toContain(ENDPOINT);
      expect(snippet.text).toContain(TOKEN);
      expect(snippet.text).toContain(ORIGIN);
      expect(snippet.text).toContain(MCP_SERVER_NAME);
    }
  });

  it("uses an Authorization: Bearer header for the json and claude snippets", () => {
    const snippets = buildMcpConnectSnippets(ENDPOINT, TOKEN, ORIGIN);
    const json = snippets.find((snippet) => snippet.value === "json");
    const claude = snippets.find((snippet) => snippet.value === "claude");
    expect(json?.text).toContain(`"Authorization": "Bearer ${TOKEN}"`);
    expect(claude?.text).toContain(`Authorization: Bearer ${TOKEN}`);
    expect(claude?.text).toContain(`--header "Origin: ${ORIGIN}"`);
  });

  it("exports the codex token to the shell, and names the origin in Codex's config", () => {
    const codex = buildMcpConnectSnippets(ENDPOINT, TOKEN, ORIGIN).find(
      (snippet) => snippet.value === "codex",
    );
    expect(codex?.text).toBe(
      [
        `export ${CODEX_TOKEN_ENV_VAR}='${TOKEN}'`,
        "",
        "# ~/.codex/config.toml",
        `[mcp_servers.${MCP_SERVER_NAME}]`,
        `url = "${ENDPOINT}"`,
        `bearer_token_env_var = "${CODEX_TOKEN_ENV_VAR}"`,
        `http_headers = { "Origin" = "${ORIGIN}" }`,
      ].join("\n"),
    );
  });

  it("produces valid JSON for the .mcp.json snippet", () => {
    const json = buildMcpConnectSnippets(ENDPOINT, TOKEN, ORIGIN).find(
      (snippet) => snippet.value === "json",
    );
    const parsed = JSON.parse(json?.text ?? "");
    expect(parsed.mcpServers[MCP_SERVER_NAME]).toEqual({
      type: "http",
      url: ENDPOINT,
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN },
    });
  });

  it("spells out the bearer auth header in the natural-language prompt", () => {
    const prompt = buildMcpConnectSnippets(ENDPOINT, TOKEN, ORIGIN).find(
      (snippet) => snippet.value === "prompt",
    );
    expect(prompt?.text).toContain(ENDPOINT);
    expect(prompt?.text).toContain(`Authorization: Bearer ${TOKEN}`);
  });
});

describe("McpConnectSnippets", () => {
  it("renders client tabs with the default snippet baked in", () => {
    render(<McpConnectSnippets endpoint={ENDPOINT} token={TOKEN} origin={ORIGIN} />);

    expect(screen.getByRole("tab", { name: "Prompt" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: ".mcp.json" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Claude Code" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Codex" })).toBeInTheDocument();

    const panel = screen.getByTestId("mcp-connect-snippets");
    expect(panel.textContent).toContain(ENDPOINT);
    expect(panel.textContent).toContain(`Authorization: Bearer ${TOKEN}`);
  });
});
