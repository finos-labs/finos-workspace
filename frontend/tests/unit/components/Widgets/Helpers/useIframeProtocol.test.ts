import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useIframeProtocol as UseIframeProtocol } from "~/components/Widgets/Helpers/useIframeProtocol";
import { mockConfig } from "../../../../mocks/runtimeConfig";
import { required } from "../../../mocks";

function createMockIframeRef(contentWindow: Window | null = window, src = "") {
  return {
    current: { contentWindow, src },
  } as unknown as React.RefObject<HTMLIFrameElement>;
}

type DataRequest = ReturnType<
  ReturnType<typeof UseIframeProtocol>["requestWidgetData"]
>;

function setContentWindow(iframeRef: React.RefObject<HTMLIFrameElement>, win: object) {
  Object.assign(iframeRef.current as object, { contentWindow: win });
}

function postFromIframe(iframeRef: React.RefObject<HTMLIFrameElement>, data: unknown) {
  const event = new MessageEvent("message", {
    data,
    source: iframeRef.current?.contentWindow,
  });
  window.dispatchEvent(event);
}

vi.mock("~/components/Widget.context", () => ({
  useWidgetContext: vi.fn(() => ({ widget: {} })),
}));

describe("useIframeProtocol", () => {
  let useIframeProtocol: typeof import("~/components/Widgets/Helpers/useIframeProtocol").useIframeProtocol;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mockConfig.data.allowHtmlJsExecution = true;
    vi.doMock("~/lib/runtimeConfig", () => ({
      getConfig: () => mockConfig,
      _resetConfig: vi.fn(),
    }));
    const mod = await import("~/components/Widgets/Helpers/useIframeProtocol");
    useIframeProtocol = mod.useIframeProtocol;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with null manifest", () => {
    const iframeRef = createMockIframeRef();
    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));
    expect(result.current.manifest).toBeNull();
  });

  it("sets manifest on workspace-connect message", () => {
    const iframeRef = createMockIframeRef();
    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    const widgets = [{ widgetId: "w1", name: "Widget 1", dataType: "table" as const }];

    act(() => {
      postFromIframe(iframeRef, { type: "workspace-connect", widgets });
    });

    expect(result.current.manifest).toEqual(widgets);
  });

  it("requestWidgetData sends workspace-request and resolves on response", async () => {
    const iframeRef = createMockIframeRef();
    const postMessageSpy = vi.fn();
    setContentWindow(iframeRef, {
      postMessage: postMessageSpy,
    });
    const mockWindow = iframeRef.current?.contentWindow;

    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    let resolved: DataRequest | undefined;
    act(() => {
      resolved = result.current.requestWidgetData("w1");
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: "workspace-request", widgetId: "w1" },
      "*",
    );

    const responseData = {
      type: "workspace-data",
      widgetId: "w1",
      dataType: "table",
      data: [{ a: 1 }],
    };

    act(() => {
      const event = new MessageEvent("message", {
        data: responseData,
        source: mockWindow,
      });
      window.dispatchEvent(event);
    });

    await expect(resolved).resolves.toEqual(responseData);
  });

  it("requestWidgetData rejects after timeout", async () => {
    const iframeRef = createMockIframeRef();
    const postMessageSpy = vi.fn();
    setContentWindow(iframeRef, {
      postMessage: postMessageSpy,
    });

    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    let promise: DataRequest | undefined;
    act(() => {
      promise = result.current.requestWidgetData("w1");
    });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    await expect(required(promise)).rejects.toThrow(
      'Request for widget "w1" timed out',
    );
  });

  it("workspace-error rejects pending requestWidgetData with error message", async () => {
    const iframeRef = createMockIframeRef();
    const postMessageSpy = vi.fn();
    setContentWindow(iframeRef, {
      postMessage: postMessageSpy,
    });
    const mockWindow = iframeRef.current?.contentWindow;

    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    let promise: DataRequest | undefined;
    act(() => {
      promise = result.current.requestWidgetData("w1");
    });

    act(() => {
      const event = new MessageEvent("message", {
        data: {
          type: "workspace-error",
          widgetId: "w1",
          error: "Data source unavailable",
        },
        source: mockWindow,
      });
      window.dispatchEvent(event);
    });

    await expect(required(promise)).rejects.toThrow("Data source unavailable");
  });

  it("workspace-error for unknown widget does not crash", () => {
    const iframeRef = createMockIframeRef();

    renderHook(() => useIframeProtocol({ iframeRef }));

    act(() => {
      postFromIframe(iframeRef, {
        type: "workspace-error",
        widgetId: "unknown",
        error: "Not found",
      });
    });
  });

  it("ignores messages from wrong source", () => {
    const iframeRef = createMockIframeRef();
    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    act(() => {
      const event = new MessageEvent("message", {
        data: {
          type: "workspace-connect",
          widgets: [{ widgetId: "w1", name: "X", dataType: "table" }],
        },
        source: null,
      });
      window.dispatchEvent(event);
    });

    expect(result.current.manifest).toBeNull();
  });

  it("fires onAiData callback for aiData messages", () => {
    const iframeRef = createMockIframeRef();
    const onAiData = vi.fn();
    renderHook(() => useIframeProtocol({ iframeRef, onAiData }));

    act(() => {
      postFromIframe(iframeRef, { type: "aiData", data: { foo: "bar" } });
    });

    expect(onAiData).toHaveBeenCalledWith(JSON.stringify({ foo: "bar" }));
  });

  it("fires onParamsUpdate callback for iframe param update messages", () => {
    const iframeRef = createMockIframeRef();
    const onParamsUpdate = vi.fn();
    renderHook(() => useIframeProtocol({ iframeRef, onParamsUpdate }));

    act(() => {
      postFromIframe(iframeRef, {
        type: "workspace:widget-params:update",
        params: { event_ticker: "KXSB-27", reverse: false, limit: 40 },
      });
    });

    expect(onParamsUpdate).toHaveBeenCalledWith({
      event_ticker: "KXSB-27",
      reverse: "false",
      limit: "40",
    });
  });

  it("supports single paramName/value iframe param update messages", () => {
    const iframeRef = createMockIframeRef();
    const onParamsUpdate = vi.fn();
    renderHook(() => useIframeProtocol({ iframeRef, onParamsUpdate }));

    act(() => {
      postFromIframe(iframeRef, {
        type: "workspace:params:update",
        paramName: "event_ticker",
        value: "KXNBA-26",
      });
    });

    expect(onParamsUpdate).toHaveBeenCalledWith({
      event_ticker: "KXNBA-26",
    });
  });

  it("accepts workspace-connect from an iframe nested in the widget's iframe", () => {
    const outer = {} as Window;
    const iframeRef = createMockIframeRef(outer, "http://localhost:8501/app");
    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    const widgets = [
      { widgetId: "w1", name: "Nested Widget", dataType: "table" as const },
    ];

    act(() => {
      const event = new MessageEvent("message", {
        data: { type: "workspace-connect", widgets },
        source: { postMessage: vi.fn(), parent: outer } as unknown as Window,
        origin: "http://localhost:8501",
      });
      window.dispatchEvent(event);
    });

    expect(result.current.manifest).toEqual(widgets);
  });

  it("accepts it from an iframe nested several frames deep", () => {
    const outer = {} as Window;
    const middle = { parent: outer } as unknown as Window;
    const iframeRef = createMockIframeRef(outer, "http://localhost:8501/app");
    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));
    const widgets = [{ widgetId: "w1", name: "Deep", dataType: "table" as const }];

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "workspace-connect", widgets },
          source: { parent: middle } as unknown as Window,
          origin: "http://localhost:8501",
        }),
      );
    });

    expect(result.current.manifest).toEqual(widgets);
  });

  it("does not take the messages of another iframe of the same origin for its own", () => {
    const top = {} as Window;
    const own = { parent: top } as unknown as Window;
    const sibling = { postMessage: vi.fn(), parent: top } as unknown as Window;
    const iframeRef = createMockIframeRef(own, "http://127.0.0.1:6900/view/a");
    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "workspace-connect",
            widgets: [{ widgetId: "theirs", name: "Theirs", dataType: "table" }],
          },
          source: sibling,
          origin: "http://127.0.0.1:6900",
        }),
      );
    });

    expect(result.current.manifest).toBeNull();
  });

  it("keeps sending to its own iframe after a sibling of the same origin has spoken", async () => {
    const top = {} as Window;
    const ownPostMessage = vi.fn();
    const siblingPostMessage = vi.fn();
    const own = { postMessage: ownPostMessage, parent: top } as unknown as Window;
    const sibling = {
      postMessage: siblingPostMessage,
      parent: top,
    } as unknown as Window;
    const iframeRef = createMockIframeRef(own, "http://127.0.0.1:6900/view/a");
    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));
    const handshake = (source: Window, widgetId: string) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "workspace-connect",
            widgets: [{ widgetId, name: widgetId, dataType: "table" }],
          },
          source,
          origin: "http://127.0.0.1:6900",
        }),
      );

    act(() => {
      handshake(own, "mine");
      handshake(sibling, "theirs");
    });
    act(() => {
      result.current.requestWidgetData("mine");
    });

    expect(result.current.manifest?.map((w) => w.widgetId)).toEqual(["mine"]);
    expect(ownPostMessage).toHaveBeenCalledWith(
      { type: "workspace-request", widgetId: "mine" },
      "http://127.0.0.1:6900",
    );
    expect(siblingPostMessage).not.toHaveBeenCalled();
  });

  it("does not take the data of another iframe of the same origin for the answer to its request", async () => {
    const top = {} as Window;
    const own = { postMessage: vi.fn(), parent: top } as unknown as Window;
    const sibling = { postMessage: vi.fn(), parent: top } as unknown as Window;
    const iframeRef = createMockIframeRef(own, "http://127.0.0.1:6900/view/a");
    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    let request!: DataRequest;
    act(() => {
      request = result.current.requestWidgetData("mine");
    });
    const settled = vi.fn();
    request.then(settled, () => {});
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "workspace-data",
            widgetId: "mine",
            dataType: "table",
            data: [{ a: 1 }],
          },
          source: sibling,
          origin: "http://127.0.0.1:6900",
        }),
      );
    });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "workspace-data",
            widgetId: "mine",
            dataType: "table",
            data: [{ a: 2 }],
          },
          source: own,
          origin: "http://127.0.0.1:6900",
        }),
      );
    });
    await expect(request).resolves.toMatchObject({ data: [{ a: 2 }] });
  });

  it("sends workspace-request to stored bridgeSource after handshake", async () => {
    const outer = {} as Window;
    const nestedPostMessage = vi.fn();
    const nestedWindow = {
      postMessage: nestedPostMessage,
      parent: outer,
    } as unknown as Window;
    const iframeRef = createMockIframeRef(outer, "http://localhost:8501/app");

    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    act(() => {
      const event = new MessageEvent("message", {
        data: {
          type: "workspace-connect",
          widgets: [{ widgetId: "w1", name: "W", dataType: "table" }],
        },
        source: nestedWindow,
        origin: "http://localhost:8501",
      });
      window.dispatchEvent(event);
    });

    act(() => {
      result.current.requestWidgetData("w1");
    });

    expect(nestedPostMessage).toHaveBeenCalledWith(
      { type: "workspace-request", widgetId: "w1" },
      "http://localhost:8501",
    );
  });

  it("parses params from workspace-connect message", () => {
    const iframeRef = createMockIframeRef();
    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    const widgets = [{ widgetId: "w1", name: "Widget 1", dataType: "table" as const }];
    const params = [
      {
        paramName: "sector",
        label: "Sector",
        type: "text" as const,
        value: "Technology",
        options: [
          { label: "Technology", value: "Technology" },
          { label: "Financials", value: "Financials" },
        ],
      },
    ];

    act(() => {
      postFromIframe(iframeRef, { type: "workspace-connect", widgets, params });
    });

    expect(result.current.paramDefs).toEqual(params);
  });

  it("parses number, date, and boolean param types from workspace-connect", () => {
    const iframeRef = createMockIframeRef();
    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    const widgets = [{ widgetId: "w1", name: "Widget 1", dataType: "table" as const }];
    const params = [
      {
        paramName: "min_shares",
        label: "Min Shares",
        type: "number" as const,
        value: "100",
        min: 0,
        max: 10000,
        step: 10,
      },
      {
        paramName: "as_of_date",
        label: "As Of Date",
        type: "date" as const,
        value: "2026-01-01",
      },
      {
        paramName: "show_pnl",
        label: "Show PnL",
        type: "boolean" as const,
        value: "true",
      },
    ];

    act(() => {
      postFromIframe(iframeRef, { type: "workspace-connect", widgets, params });
    });

    expect(result.current.paramDefs).toEqual(params);
  });

  it("starts with null paramDefs", () => {
    const iframeRef = createMockIframeRef();
    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));
    expect(result.current.paramDefs).toBeNull();
  });

  it("paramDefs remain null when workspace-connect has no params", () => {
    const iframeRef = createMockIframeRef();
    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    act(() => {
      postFromIframe(iframeRef, {
        type: "workspace-connect",
        widgets: [{ widgetId: "w1", name: "W", dataType: "table" }],
      });
    });

    expect(result.current.paramDefs).toBeNull();
  });

  it("sendParamsUpdate posts workspace-params-update to bridge source", () => {
    const outer = {} as Window;
    const nestedPostMessage = vi.fn();
    const nestedWindow = {
      postMessage: nestedPostMessage,
      parent: outer,
    } as unknown as Window;
    const iframeRef = createMockIframeRef(outer, "http://localhost:8501/app");

    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    act(() => {
      const event = new MessageEvent("message", {
        data: {
          type: "workspace-connect",
          widgets: [{ widgetId: "w1", name: "W", dataType: "table" }],
          params: [{ paramName: "sector", type: "text", value: "All" }],
        },
        source: nestedWindow,
        origin: "http://localhost:8501",
      });
      window.dispatchEvent(event);
    });

    act(() => {
      result.current.sendParamsUpdate({ sector: "Financials" });
    });

    expect(nestedPostMessage).toHaveBeenCalledWith(
      { type: "workspace-params-update", params: { sector: "Financials" } },
      "http://localhost:8501",
    );
  });

  it("sendParamsUpdate falls back to contentWindow when no bridge source", () => {
    const postMessageSpy = vi.fn();
    const iframeRef = createMockIframeRef();
    setContentWindow(iframeRef, { postMessage: postMessageSpy });

    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    act(() => {
      result.current.sendParamsUpdate({ ticker: "MSFT" });
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: "workspace-params-update", params: { ticker: "MSFT" } },
      "*",
    );
  });

  describe("message validation", () => {
    it("rejects workspace-connect with missing widgets array", () => {
      const iframeRef = createMockIframeRef();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

      act(() => {
        postFromIframe(iframeRef, { type: "workspace-connect" });
      });

      expect(result.current.manifest).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("invalid workspace-connect"),
        expect.any(Array),
      );
      warnSpy.mockRestore();
    });

    it("rejects workspace-connect with malformed widget entries", () => {
      const iframeRef = createMockIframeRef();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

      act(() => {
        postFromIframe(iframeRef, {
          type: "workspace-connect",
          widgets: [{ name: "Missing widgetId" }],
        });
      });

      expect(result.current.manifest).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("invalid workspace-connect"),
        expect.any(Array),
      );
      warnSpy.mockRestore();
    });

    it("rejects workspace-data with missing widgetId", async () => {
      const iframeRef = createMockIframeRef();
      const postMessageSpy = vi.fn();
      setContentWindow(iframeRef, {
        postMessage: postMessageSpy,
      });
      const mockWindow = iframeRef.current?.contentWindow;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

      let promise: DataRequest | undefined;
      act(() => {
        promise = result.current.requestWidgetData("w1");
      });

      act(() => {
        const event = new MessageEvent("message", {
          data: { type: "workspace-data", data: [{ a: 1 }] },
          source: mockWindow,
        });
        window.dispatchEvent(event);
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("invalid workspace-data"),
        expect.any(Array),
      );

      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      await expect(required(promise)).rejects.toThrow("timed out");
      warnSpy.mockRestore();
    });

    it("rejects workspace-error with missing error string", async () => {
      const iframeRef = createMockIframeRef();
      const postMessageSpy = vi.fn();
      setContentWindow(iframeRef, {
        postMessage: postMessageSpy,
      });
      const mockWindow = iframeRef.current?.contentWindow;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

      let promise: DataRequest | undefined;
      act(() => {
        promise = result.current.requestWidgetData("w1");
      });

      act(() => {
        const event = new MessageEvent("message", {
          data: { type: "workspace-error", widgetId: "w1" },
          source: mockWindow,
        });
        window.dispatchEvent(event);
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("invalid workspace-error"),
        expect.any(Array),
      );

      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      await expect(required(promise)).rejects.toThrow("timed out");
      warnSpy.mockRestore();
    });
  });

  it("hands the iframe its source's headers from memory, not the saved widget's", async () => {
    const { useWidgetContext } = await import("~/components/Widget.context");
    vi.mocked(useWidgetContext).mockReturnValue({
      widget: {
        id: "w",
        sourceId: "src-1",
        endpoint: {
          url: "http://localhost:8501/app",
          method: "GET",
          headers: { "X-Api-Key": "stale-saved-key" },
        },
      },
    } as unknown as ReturnType<typeof useWidgetContext>);
    const { useBackendConnectorStore } = await import("~/lib/state/backendConnector");
    useBackendConnectorStore.setState({
      apiSources: [
        {
          id: "src-1",
          name: "Streamlit",
          url: "http://localhost:8501",
          endpointHeaders: [
            { key: "X-Api-Key", value: "from-source", location: "headers" },
          ],
        },
      ],
    });
    const postMessage = vi.fn();
    const frame = { postMessage } as unknown as Window;
    const iframeRef = createMockIframeRef(frame, "http://localhost:8501/app");
    renderHook(() => useIframeProtocol({ iframeRef }));

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "workspace-connect", widgets: [] },
          source: frame,
          origin: "http://localhost:8501",
        }),
      );
    });

    expect(postMessage).toHaveBeenCalledWith(
      { type: "workspace-auth", headers: { "X-Api-Key": "from-source" } },
      "http://localhost:8501",
    );
  });

  it("hands the iframe its source's headers when they arrive after the handshake", async () => {
    const { useWidgetContext } = await import("~/components/Widget.context");
    vi.mocked(useWidgetContext).mockReturnValue({
      widget: {
        id: "w",
        sourceId: "src-1",
        endpoint: { url: "http://localhost:8501/app", method: "GET" },
      },
    } as unknown as ReturnType<typeof useWidgetContext>);
    const { useBackendConnectorStore } = await import("~/lib/state/backendConnector");
    useBackendConnectorStore.setState({
      apiSources: [
        {
          id: "src-1",
          name: "Streamlit",
          url: "http://localhost:8501",
          endpointHeaders: null,
        },
      ],
    });
    const postMessage = vi.fn();
    const frame = { postMessage } as unknown as Window;
    const iframeRef = createMockIframeRef(frame, "http://localhost:8501/app");
    const { result } = renderHook(() => useIframeProtocol({ iframeRef }));

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "workspace-connect", widgets: [] },
          source: frame,
          origin: "http://localhost:8501",
        }),
      );
    });
    expect(postMessage).not.toHaveBeenCalled();

    act(() => {
      useBackendConnectorStore.setState({
        apiSources: [
          {
            id: "src-1",
            name: "Streamlit",
            url: "http://localhost:8501",
            endpointHeaders: [
              { key: "X-Api-Key", value: "from-source", location: "headers" },
            ],
          },
        ],
      });
    });

    expect(postMessage).toHaveBeenCalledWith(
      { type: "workspace-auth", headers: { "X-Api-Key": "from-source" } },
      "http://localhost:8501",
    );
    act(() => {
      result.current.requestWidgetData("w1");
    });
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: "workspace-request", widgetId: "w1" },
      "http://localhost:8501",
    );
  });
});
