import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "~/lib/state/backendConnector";
import { validateBackend } from "~/lib/utils/validateBackend";
import { throughSourceProxy } from "../../../mocks/sourceProxy";
import { installWidgetsSchemaFixture } from "../../../mocks/widgetsSchema";

installWidgetsSchemaFixture();

const mockFetch = vi.fn();
global.fetch = throughSourceProxy(mockFetch);

describe("validateBackend - apps.json endpoint behavior", () => {
  const mockSource: Source = {
    id: "test-backend",
    url: "https://test-backend.com",
    name: "Test Backend",
    endpointHeaders: [
      { key: "Authorization", value: "Bearer test-token", location: "headers" },
    ],
    uuid: "test-uuid",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should handle jsonify({}) correctly - returns empty object, no error message, 0 apps found", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });

    const result = await validateBackend(mockSource, false);

    expect(result.templates).toEqual([]);
    expect(result.templateErrorMessage).toBeNull();
    expect(result.totalFailed).toBe(0);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "https://test-backend.com/widgets.json",
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://test-backend.com/apps.json",
      expect.any(Object),
    );
  });

  it("should handle jsonify([]) correctly - returns empty array, no error message, 0 apps found", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });

    const result = await validateBackend(mockSource, false);

    expect(result.templates).toEqual([]);
    expect(result.templateErrorMessage).toBeNull();
    expect(result.totalFailed).toBe(0);
  });

  it("should handle jsonify() (undefined/null response) correctly - should not show widget errors", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(undefined),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });

    const result = await validateBackend(mockSource, false);

    expect(result.templates).toEqual([]);
    expect(result.templateErrorMessage).toBeNull();
    expect(result.totalFailed).toBe(0);
    expect(result.errorMessage).toBeNull();
  });

  it("should handle apps.json fetch failure by trying templates.json fallback", async () => {
    mockFetch.mockImplementation((url: URL | string) => {
      const href = url.toString();
      if (href.endsWith("widgets.json")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
          headers: new Headers(),
        });
      }
      if (href.endsWith("apps.json")) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      if (href.endsWith("templates.json")) {
        return Promise.resolve({
          ok: true,
          url: href,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        });
      }
      if (href.endsWith("agents.json")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const result = await validateBackend(mockSource, false);

    expect(result.templates).toEqual([]);
    expect(result.templateErrorMessage).toBeNull();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://test-backend.com/apps.json",
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test-backend.com/templates.json",
      expect.any(Object),
    );
  });

  it("should handle both apps.json and templates.json failures", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });

    const result = await validateBackend(mockSource, false);

    expect(result.templates).toEqual([]);
    expect(result.templateErrorMessage).toBeNull();
  });

  it("should handle invalid template data in apps.json response", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              invalidField: "invalid",
            },
          ]),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });

    const result = await validateBackend(mockSource, false);

    expect(result.templates).toEqual([]);
    expect(result.templateErrorMessage).not.toBeNull();
    expect(result.templateErrorMessage).toContain("Unknown App");
    expect(result.totalFailed).toBeGreaterThan(0);
  });

  it("should correctly process valid template data", async () => {
    const validTemplate = {
      name: "Test App",
      description: "A test application",
      tabs: {
        main: {
          id: "main",
          name: "Main Tab",
          layout: [],
        },
      },
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([validTemplate]),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });

    const result = await validateBackend(mockSource, false);

    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].name).toBe("Test App");
    expect(result.templateErrorMessage).toBeNull();
    expect(result.totalFailed).toBe(0);
  });

  it("should handle mixed valid and invalid templates", async () => {
    const validTemplate = {
      name: "Valid App",
      description: "A valid application",
      tabs: {
        main: {
          id: "main",
          name: "Main Tab",
          layout: [],
        },
      },
    };

    const invalidTemplate = {
      name: "Invalid App",
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([validTemplate, invalidTemplate]),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });

    const result = await validateBackend(mockSource, false);

    expect(result.templates).toEqual([]);
    expect(result.templateErrorMessage).not.toBeNull();
    expect(result.templateErrorMessage).toContain("Invalid App");
    expect(result.totalFailed).toBeGreaterThan(0);
  });

  it("should report unrecognized template keys from apps.json with the correct label", async () => {
    const templateWithExtraKey = {
      name: "Template With Extra Key",
      description: "Template that includes unsupported metadata",
      tabs: {
        main: {
          id: "main",
          name: "Main",
          layout: [],
        },
      },
      unsupported_template_flag: true,
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([templateWithExtraKey]),
        url: `${mockSource.url}/apps.json`,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });

    const result = await validateBackend(mockSource, false);

    expect(result.templateErrorMessage).toBeNull();
    expect(result.unrecognizedKeysMessage).toEqual([
      {
        label: "[apps.json]",
        entries: [
          {
            name: "Template With Extra Key",
            keys: ["unsupported_template_flag"],
          },
        ],
      },
    ]);
  });

  it("should normalize snake_case `mcp_servers` to camelCase `mcpServers` and not flag it as unrecognized", async () => {
    const templateWithSnakeCaseMcp = {
      name: "Template With MCP",
      description: "Uses snake_case mcp_servers from the docs",
      tabs: {
        main: { id: "main", name: "Main", layout: [] },
      },
      mcp_servers: [
        {
          name: "MyMcp",
          description: "Test MCP",
          url: "https://mcp.example.com/sse",
        },
      ],
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([templateWithSnakeCaseMcp]),
        url: `${mockSource.url}/apps.json`,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });

    const result = await validateBackend(mockSource, false);

    expect(result.templateErrorMessage).toBeNull();
    expect(result.unrecognizedKeysMessage).toBeNull();
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].mcpServers).toEqual([
      {
        name: "MyMcp",
        description: "Test MCP",
        url: "https://mcp.example.com/sse",
      },
    ]);
    expect(result.templates[0]).not.toHaveProperty("mcp_servers");
  });

  it("should report unrecognized template keys from templates.json fallback with the correct label", async () => {
    const fallbackTemplateWithExtraKey = {
      name: "Fallback Template",
      description: "Loaded from templates.json",
      tabs: {
        main: {
          id: "main",
          name: "Main",
          layout: [],
        },
      },
      templates_only_extra_key: "x",
    };

    mockFetch.mockImplementation((url: URL | string) => {
      const href = url.toString();
      if (href.endsWith("widgets.json")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
          headers: new Headers(),
        });
      }
      if (href.endsWith("apps.json")) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      if (href.endsWith("templates.json")) {
        return Promise.resolve({
          ok: true,
          url: `${mockSource.url}/templates.json`,
          json: () => Promise.resolve([fallbackTemplateWithExtraKey]),
          headers: new Headers(),
        });
      }
      if (href.endsWith("agents.json")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const result = await validateBackend(mockSource, false);

    expect(result.templateErrorMessage).toBeNull();
    expect(result.unrecognizedKeysMessage).toEqual([
      {
        label: "[templates.json]",
        entries: [
          {
            name: "Fallback Template",
            keys: ["templates_only_extra_key"],
          },
        ],
      },
    ]);
  });
});
