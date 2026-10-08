import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Source, ValidateBackend } from "~/lib/state/backendConnector";
import {
  processWorkerResults,
  validateBackend,
  validateSource,
  validateWidgetItems,
} from "~/lib/utils/validateBackend";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const source: Source = {
  url: "https://test-backend.com",
  name: "Test Backend",
  endpointHeaders: [],
  id: "test-uuid",
};

const goodWidget = {
  name: "Stock Price",
  description: "Get current stock price",
  endpoint: "/stock/price",
  type: "html",
  params: [],
};

// A widget needs a name
const badWidget = { name: "", endpoint: "/bad", type: "html", params: [] };

const goodApp = {
  name: "Stock App",
  description: "Stock analysis",
  tabs: { main: { id: "main", name: "Main", layout: [] } },
};

// An app needs its tabs
const badApp = { name: "Broken App" };

function respond(widgets: unknown, apps: unknown = []) {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(widgets),
      headers: new Headers(),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(apps),
      url: `${source.url}/apps.json`,
      headers: new Headers(),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
      headers: new Headers(),
    });
}

describe("validateWidgetItems", () => {
  it("keeps the valid widgets and reports each invalid one on its own", () => {
    const { fileError, valid, invalid } = validateWidgetItems({
      good: { ...goodWidget },
      bad: { ...badWidget, params: [{ paramName: "x", type: "text" }] },
    });

    expect(fileError).toBeNull();
    expect(Object.keys(valid)).toEqual(["good"]);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({ file: "widgets.json", id: "bad" });
    expect(invalid[0].errors).toContain("[description]");
  });

  it("shows the invalid widget as the backend sent it", () => {
    const sentParams = [{ paramName: "x", type: "text" }];
    const { invalid } = validateWidgetItems({
      bad: { ...badWidget, params: sentParams },
    });

    const sent = JSON.parse(invalid[0].json);
    expect(sent.endpoint).toBe("/bad");
    expect(sent.params).toEqual(sentParams);
  });

  it("reports an entry that is not an object", () => {
    const { valid, invalid } = validateWidgetItems({
      good: { ...goodWidget },
      nothing: null,
      text: "just a string",
    });

    expect(Object.keys(valid)).toEqual(["good"]);
    expect(invalid.map((item) => item.id)).toEqual(["nothing", "text"]);
    expect(invalid[0].errors).toContain("Expected an object");
  });

  it("reports a file that is not a map of widgets as a file error", () => {
    const { fileError, invalid } = validateWidgetItems([{ name: "widget" }]);

    expect(fileError).toContain("Invalid format");
    expect(invalid).toEqual([]);
  });
});

describe("validateBackend with invalid items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads what is valid and reports what is not", async () => {
    respond({ good: { ...goodWidget }, bad: { ...badWidget } }, [goodApp, badApp]);

    const result = await validateBackend(source, false);

    expect(Object.keys(result.validWidgets ?? {})).toEqual(["good"]);
    expect(result.validTemplates?.map((t) => t.name)).toEqual(["Stock App"]);
    expect(result.invalidItems?.map((i) => `${i.file}:${i.id}`)).toEqual([
      "widgets.json:bad",
      "apps.json:Broken App",
    ]);
    // Nothing that is invalid leaves the backend unusable
    expect(result.fatalErrorMessage).toBeNull();
  });

  it("still reports the problems as errors for the dialogs that test a connection", async () => {
    respond({ good: { ...goodWidget }, bad: { ...badWidget } }, [goodApp, badApp]);

    const result = await validateBackend(source, false);

    expect(result.errorMessage).not.toBeNull();
    expect(result.templateErrorMessage).not.toBeNull();
    expect(result.widgets).toEqual({});
    expect(result.templates).toEqual([]);
  });

  it("names apps.json or templates.json, whichever the backend serves", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ good: { ...goodWidget } }),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([badApp]),
        url: `${source.url}/templates.json`,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });

    const result = await validateBackend(source, false);

    expect(result.invalidItems?.[0]).toMatchObject({
      file: "templates.json",
      id: "Broken App",
    });
  });

  it("treats a widgets.json that is not a map of widgets as fatal", async () => {
    respond([{ name: "widget" }]);

    const result = await validateBackend(source, false);

    expect(result.fatalErrorMessage).toContain("Invalid format");
  });

  it("reports nothing for a backend that is all valid", async () => {
    respond({ good: { ...goodWidget } }, [goodApp]);

    const result = await validateBackend(source, false);

    expect(result.invalidItems).toEqual([]);
    expect(result.fatalErrorMessage).toBeNull();
    expect(result.errorMessage).toBeNull();
  });
});

describe("the warning about widget types that are not rendered", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says which widget types are supported next to what it left out", async () => {
    respond({
      good: { ...goodWidget },
      prices: { name: "Prices", description: "A table", endpoint: "/p", type: "table" },
      untyped: { name: "Untyped", description: "No type", endpoint: "/u" },
    });

    const result = await validateSource(source, false);

    const message = result.templateWarningMessage ?? "";
    expect(message).toContain("does not render their widget type: `prices`, `untyped`");
    expect(message).toContain(
      "Supported widget types: `html`, `iframe`, `markdown`, `pdf`",
    );
    expect(message).toContain("A widget with no `type` is a table");
  });

  it("has no warning when every widget is rendered", async () => {
    respond({ good: { ...goodWidget } });

    const result = await validateSource(source, false);

    expect(result.templateWarningMessage).toBeUndefined();
  });
});

describe("processWorkerResults with invalid items", () => {
  const result = (overrides: Partial<ValidateBackend>): ValidateBackend => ({
    widgets: {},
    errorMessage: "widgets.json is invalid",
    templateErrorMessage: null,
    totalFailed: 0,
    templates: [],
    agents: [],
    ...overrides,
  });

  const items = [
    {
      file: "widgets.json" as const,
      id: "bad",
      errors: "bad:\n [name]: required",
      json: "{}",
    },
  ];

  it("loads the valid widgets and apps of a backend that has invalid ones", () => {
    const processed = processWorkerResults([
      {
        source: { ...source },
        result: result({
          validWidgets: { good: { ...goodWidget } } as never,
          validTemplates: [goodApp] as never,
          invalidItems: items,
          fatalErrorMessage: null,
        }),
      },
    ]);

    const [loaded] = processed.apiSources;
    expect(loaded.status).toBe("success");
    expect(Object.keys(loaded.widgets ?? {})).toEqual(["good"]);
    expect(loaded.templates).toHaveLength(1);
    expect(processed.invalidItems).toEqual([
      { source: { name: "Test Backend", id: "test-uuid" }, items },
    ]);
  });

  it("does not report twice while results stream in", () => {
    const processed = processWorkerResults(
      [
        {
          source: { ...source },
          result: result({
            validWidgets: { good: { ...goodWidget } } as never,
            invalidItems: items,
            fatalErrorMessage: null,
          }),
        },
      ],
      true,
    );

    expect(processed.invalidItems).toEqual([]);
  });

  it("marks a backend with nothing usable as an error", () => {
    const processed = processWorkerResults([
      {
        source: { ...source },
        result: result({
          validWidgets: {} as never,
          invalidItems: [],
          fatalErrorMessage: "Invalid format",
        }),
      },
      { source: { ...source, id: "other" }, result: result({}) },
    ]);

    expect(processed.apiSources.map((s) => s.status)).toEqual(["error", "error"]);
    expect(processed.invalidItems).toEqual([]);
  });
});
