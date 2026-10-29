import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("html-to-image", () => ({
  toPng: vi.fn(),
}));

let mockPdfInstance: {
  addImage: Mock;
  addPage: Mock;
  save: Mock;
  output: Mock;
} | null = null;

vi.mock("jspdf", () => {
  const mock = vi.fn();
  return { jsPDF: mock };
});

let mockZipInstance: {
  file: Mock;
  folder: Mock;
  generateAsync: Mock;
} | null = null;

vi.mock("jszip", () => {
  const mock = vi.fn();
  return { default: mock };
});

import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import {
  type DashboardInfo,
  generateFolderReport,
  generateMultiTabReport,
  type TabInfo,
} from "~/lib/utils/utils";
import { required } from "../../mocks";

const checkIfLoadingData = () => false;

describe("generateMultiTabReport", () => {
  let mockElement: Partial<Element>;
  let originalLocation: Location;
  let originalHistory: History;
  let originalCreateElement: typeof document.createElement;
  let originalGetElementsByClassName: typeof document.getElementsByClassName;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    originalLocation = window.location;
    originalHistory = window.history;
    originalCreateElement = document.createElement.bind(document);
    originalGetElementsByClassName = document.getElementsByClassName.bind(document);

    Object.defineProperty(window, "location", {
      value: {
        href: "http://localhost:3000/app/test-dashboard?tab=tab1",
        search: "?tab=tab1",
        pathname: "/app/test-dashboard",
      },
      writable: true,
    });

    Object.defineProperty(window, "history", {
      value: {
        replaceState: vi.fn(),
      },
      writable: true,
    });

    window.dispatchEvent = vi.fn();

    mockElement = {
      scrollWidth: 800,
      clientWidth: 800,
      scrollHeight: 600,
      clientHeight: 600,
    };

    document.getElementsByClassName = vi.fn().mockReturnValue([mockElement]);

    document.createElement = vi.fn((tagName: string) => {
      if (tagName === "canvas") {
        return {
          width: 816,
          height: 680,
          getContext: vi.fn().mockReturnValue({
            fillStyle: "",
            fillRect: vi.fn(),
            font: "",
            textAlign: "left",
            fillText: vi.fn(),
            measureText: vi.fn().mockReturnValue({ width: 100 }),
            drawImage: vi.fn(),
          }),
          toDataURL: vi.fn().mockReturnValue("data:image/png;base64,abc123"),
        };
      }
      if (tagName === "a") {
        return {
          href: "",
          download: "",
          click: vi.fn(),
          remove: vi.fn(),
        };
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement;

    (toPng as Mock).mockResolvedValue("data:image/png;base64,mockImageData");

    mockPdfInstance = {
      addImage: vi.fn(),
      addPage: vi.fn(),
      save: vi.fn(),
      output: vi.fn().mockReturnValue(new Blob(["pdf content"])),
    };
    vi.mocked(jsPDF).mockImplementation(function (this: unknown) {
      return mockPdfInstance;
    });

    mockZipInstance = {
      file: vi.fn(),
      folder: vi.fn().mockReturnThis(),
      generateAsync: vi.fn().mockResolvedValue(new Blob(["zip content"])),
    };
    vi.mocked(JSZip).mockImplementation(function (this: unknown) {
      return mockZipInstance as unknown as JSZip;
    });

    URL.createObjectURL = vi.fn().mockReturnValue("blob:http://localhost/mock");
    URL.revokeObjectURL = vi.fn();

    global.Image = vi.fn().mockImplementation(function MockImage() {
      const img = {
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
        _src: "",
        width: 816,
        height: 600,
        get src() {
          return this._src;
        },
        set src(value: string) {
          this._src = value;
          queueMicrotask(() => {
            if (this.onload) this.onload();
          });
        },
      };
      return img;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "location", { value: originalLocation });
    Object.defineProperty(window, "history", { value: originalHistory });
    document.createElement = originalCreateElement;
    document.getElementsByClassName = originalGetElementsByClassName;
  });

  describe("tab switching", () => {
    it("calls switchTab for each tab in order", async () => {
      const tabs: TabInfo[] = [
        { id: "tab1", name: "Tab 1" },
        { id: "tab2", name: "Tab 2" },
      ];

      const promise = generateMultiTabReport(
        checkIfLoadingData,
        tabs,
        "Test",
        "test",
        "pdf",
        true,
      );
      await vi.advanceTimersByTimeAsync(10000);
      await promise;

      expect(window.history.replaceState).toHaveBeenCalledTimes(3);
      expect(window.dispatchEvent).toHaveBeenCalledTimes(3);
    });
  });

  describe("PDF export", () => {
    it("creates single PDF with all tabs as pages", async () => {
      const tabs: TabInfo[] = [
        { id: "tab1", name: "Tab 1" },
        { id: "tab2", name: "Tab 2" },
        { id: "tab3", name: "Tab 3" },
      ];

      const promise = generateMultiTabReport(
        checkIfLoadingData,
        tabs,
        "Test",
        "test",
        "pdf",
        true,
      );
      await vi.advanceTimersByTimeAsync(10000);
      await promise;

      expect(jsPDF).toHaveBeenCalled();
      expect(required(mockPdfInstance).addPage).toHaveBeenCalledTimes(2);
      expect(required(mockPdfInstance).addImage).toHaveBeenCalledTimes(3);
      expect(required(mockPdfInstance).save).toHaveBeenCalledWith("test.pdf");
    });
  });

  describe("PNG export", () => {
    it("creates ZIP with each tab as separate PNG file", async () => {
      const tabs: TabInfo[] = [
        { id: "tab1", name: "Tab 1" },
        { id: "tab2", name: "Tab 2" },
      ];

      const promise = generateMultiTabReport(
        checkIfLoadingData,
        tabs,
        "Test",
        "test",
        "png",
        true,
      );
      await vi.advanceTimersByTimeAsync(10000);
      await promise;

      expect(JSZip).toHaveBeenCalled();
      expect(required(mockZipInstance).file).toHaveBeenCalledTimes(2);
      expect(required(mockZipInstance).generateAsync).toHaveBeenCalledWith({
        type: "blob",
      });
    });
  });

  describe("progress callback", () => {
    it("calls onProgress callback with (current, total, tabName) for each tab", async () => {
      const tabs: TabInfo[] = [
        { id: "tab1", name: "Tab 1" },
        { id: "tab2", name: "Tab 2" },
      ];
      const onProgress = vi.fn();

      const promise = generateMultiTabReport(
        checkIfLoadingData,
        tabs,
        "Test",
        "test",
        "pdf",
        true,
        onProgress,
      );
      await vi.advanceTimersByTimeAsync(10000);
      await promise;

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2, "Tab 1");
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2, "Tab 2");
    });
  });

  describe("callbacks", () => {
    it("calls onFinish callback on success", async () => {
      const tabs: TabInfo[] = [{ id: "tab1", name: "Tab 1" }];
      const onFinish = vi.fn();

      const promise = generateMultiTabReport(
        checkIfLoadingData,
        tabs,
        "Test",
        "test",
        "pdf",
        true,
        undefined,
        onFinish,
      );
      await vi.advanceTimersByTimeAsync(10000);
      await promise;

      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it("calls onError callback when error occurs", async () => {
      const tabs: TabInfo[] = [{ id: "tab1", name: "Tab 1" }];
      const onError = vi.fn();

      (toPng as Mock).mockRejectedValue(new Error("Capture failed"));

      const promise = generateMultiTabReport(
        checkIfLoadingData,
        tabs,
        "Test",
        "test",
        "pdf",
        true,
        undefined,
        undefined,
        onError,
      );
      await vi.advanceTimersByTimeAsync(10000);
      await promise;

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("restores original tab in finally block", async () => {
      const tabs: TabInfo[] = [{ id: "tab1", name: "Tab 1" }];

      Object.defineProperty(window, "location", {
        value: {
          href: "http://localhost:3000/app/test-dashboard?tab=original-tab",
          search: "?tab=original-tab",
          pathname: "/app/test-dashboard",
        },
        writable: true,
      });

      const promise = generateMultiTabReport(
        checkIfLoadingData,
        tabs,
        "Test",
        "test",
        "pdf",
        true,
      );
      await vi.advanceTimersByTimeAsync(10000);
      await promise;

      const calls = (window.history.replaceState as Mock).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1]).toBe("");
      expect(lastCall[2]).toContain("tab=original-tab");
    });
  });

  describe("error handling", () => {
    it("throws error if grid layout element not found", async () => {
      const tabs: TabInfo[] = [{ id: "tab1", name: "Tab 1" }];
      const onError = vi.fn();

      document.getElementsByClassName = vi.fn().mockReturnValue([]);

      const promise = generateMultiTabReport(
        checkIfLoadingData,
        tabs,
        "Test",
        "test",
        "pdf",
        true,
        undefined,
        undefined,
        onError,
      );

      await vi.advanceTimersByTimeAsync(6000);
      await promise;

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Could not find grid layout"),
        }),
      );
    });

    it("throws error when no content was captured", async () => {
      const tabs: TabInfo[] = [{ id: "tab1", name: "Tab 1" }];
      const onError = vi.fn();

      document.getElementsByClassName = vi.fn().mockReturnValue([]);

      const promise = generateMultiTabReport(
        checkIfLoadingData,
        tabs,
        "Test",
        "test",
        "pdf",
        true,
        undefined,
        undefined,
        onError,
      );

      await vi.advanceTimersByTimeAsync(6000);
      await promise;

      expect(onError).toHaveBeenCalled();
    });
  });
});

describe("generateFolderReport", () => {
  let mockElement: Partial<Element>;
  let originalLocation: Location;
  let originalHistory: History;
  let originalCreateElement: typeof document.createElement;
  let originalGetElementsByClassName: typeof document.getElementsByClassName;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    originalLocation = window.location;
    originalHistory = window.history;
    originalCreateElement = document.createElement.bind(document);
    originalGetElementsByClassName = document.getElementsByClassName.bind(document);

    Object.defineProperty(window, "location", {
      value: {
        href: "http://localhost:3000/app/original-dashboard?tab=original-tab",
        search: "?tab=original-tab",
        pathname: "/app/original-dashboard",
      },
      writable: true,
    });

    Object.defineProperty(window, "history", {
      value: {
        replaceState: vi.fn(),
      },
      writable: true,
    });

    window.dispatchEvent = vi.fn();

    mockElement = {
      scrollWidth: 800,
      clientWidth: 800,
      scrollHeight: 600,
      clientHeight: 600,
    };

    document.getElementsByClassName = vi.fn().mockReturnValue([mockElement]);

    document.createElement = vi.fn((tagName: string) => {
      if (tagName === "canvas") {
        return {
          width: 816,
          height: 680,
          getContext: vi.fn().mockReturnValue({
            fillStyle: "",
            fillRect: vi.fn(),
            font: "",
            textAlign: "left",
            fillText: vi.fn(),
            measureText: vi.fn().mockReturnValue({ width: 100 }),
            drawImage: vi.fn(),
          }),
          toDataURL: vi.fn().mockReturnValue("data:image/png;base64,abc123"),
        };
      }
      if (tagName === "a") {
        return {
          href: "",
          download: "",
          click: vi.fn(),
          remove: vi.fn(),
        };
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement;

    (toPng as Mock).mockResolvedValue("data:image/png;base64,mockImageData");

    mockPdfInstance = {
      addImage: vi.fn(),
      addPage: vi.fn(),
      save: vi.fn(),
      output: vi.fn().mockReturnValue(new Blob(["pdf content"])),
    };
    vi.mocked(jsPDF).mockImplementation(function (this: unknown) {
      return mockPdfInstance;
    });

    mockZipInstance = {
      file: vi.fn(),
      folder: vi.fn().mockReturnThis(),
      generateAsync: vi.fn().mockResolvedValue(new Blob(["zip content"])),
    };
    vi.mocked(JSZip).mockImplementation(function (this: unknown) {
      return mockZipInstance as unknown as JSZip;
    });

    URL.createObjectURL = vi.fn().mockReturnValue("blob:http://localhost/mock");
    URL.revokeObjectURL = vi.fn();

    global.Image = vi.fn().mockImplementation(function MockImage() {
      const img = {
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
        _src: "",
        width: 816,
        height: 600,
        get src() {
          return this._src;
        },
        set src(value: string) {
          this._src = value;
          queueMicrotask(() => {
            if (this.onload) this.onload();
          });
        },
      };
      return img;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "location", { value: originalLocation });
    Object.defineProperty(window, "history", { value: originalHistory });
    document.createElement = originalCreateElement;
    document.getElementsByClassName = originalGetElementsByClassName;
  });

  describe("navigation", () => {
    it("navigates to each dashboard in order", async () => {
      const dashboards: DashboardInfo[] = [
        { id: "dash1", name: "Dashboard 1", tabs: [{ id: "tab1", name: "Tab 1" }] },
        { id: "dash2", name: "Dashboard 2", tabs: [{ id: "tab1", name: "Tab 1" }] },
      ];

      const promise = generateFolderReport(
        checkIfLoadingData,
        dashboards,
        "Folder",
        "folder",
        "pdf",
        "current",
        true,
      );
      await vi.advanceTimersByTimeAsync(60000);
      await promise;

      const calls = (window.history.replaceState as Mock).mock.calls;
      expect(calls.some((c) => c[2].includes("/app/dash1"))).toBe(true);
      expect(calls.some((c) => c[2].includes("/app/dash2"))).toBe(true);
    });
  });

  describe("export scope: current", () => {
    it("exports only first tab when scope is current", async () => {
      const dashboards: DashboardInfo[] = [
        {
          id: "dash1",
          name: "Dashboard 1",
          tabs: [
            { id: "tab1", name: "Tab 1" },
            { id: "tab2", name: "Tab 2" },
          ],
        },
      ];

      const promise = generateFolderReport(
        checkIfLoadingData,
        dashboards,
        "Folder",
        "folder",
        "pdf",
        "current",
        true,
      );
      await vi.advanceTimersByTimeAsync(60000);
      await promise;

      expect(toPng).toHaveBeenCalledTimes(1);
    });
  });

  describe("export scope: all-tabs", () => {
    it("exports all tabs per dashboard when scope is all-tabs", async () => {
      const dashboards: DashboardInfo[] = [
        {
          id: "dash1",
          name: "Dashboard 1",
          tabs: [
            { id: "tab1", name: "Tab 1" },
            { id: "tab2", name: "Tab 2" },
          ],
        },
      ];

      const promise = generateFolderReport(
        checkIfLoadingData,
        dashboards,
        "Folder",
        "folder",
        "pdf",
        "all-tabs",
        true,
      );
      await vi.advanceTimersByTimeAsync(60000);
      await promise;

      expect(toPng).toHaveBeenCalledTimes(2);
    });
  });

  describe("ZIP structure", () => {
    it("creates ZIP with correct structure for PDF export", async () => {
      const dashboards: DashboardInfo[] = [
        { id: "dash1", name: "Dashboard 1", tabs: [{ id: "tab1", name: "Tab 1" }] },
      ];

      const promise = generateFolderReport(
        checkIfLoadingData,
        dashboards,
        "Folder",
        "folder",
        "pdf",
        "current",
        true,
      );
      await vi.advanceTimersByTimeAsync(60000);
      await promise;

      expect(required(mockZipInstance).file).toHaveBeenCalledWith(
        "dashboard-1.pdf",
        expect.any(Blob),
      );
      expect(required(mockZipInstance).generateAsync).toHaveBeenCalledWith({
        type: "blob",
      });
    });

    it("creates ZIP with folder structure for PNG all-tabs export", async () => {
      const dashboards: DashboardInfo[] = [
        {
          id: "dash1",
          name: "Dashboard 1",
          tabs: [
            { id: "tab1", name: "Tab 1" },
            { id: "tab2", name: "Tab 2" },
          ],
        },
      ];

      const promise = generateFolderReport(
        checkIfLoadingData,
        dashboards,
        "Folder",
        "folder",
        "png",
        "all-tabs",
        true,
      );
      await vi.advanceTimersByTimeAsync(60000);
      await promise;

      expect(required(mockZipInstance).folder).toHaveBeenCalledWith("dashboard-1");
    });
  });

  describe("progress callback", () => {
    it("calls onProgress with correct arguments", async () => {
      const dashboards: DashboardInfo[] = [
        {
          id: "dash1",
          name: "Dashboard 1",
          tabs: [
            { id: "tab1", name: "Tab 1" },
            { id: "tab2", name: "Tab 2" },
          ],
        },
      ];
      const onProgress = vi.fn();

      const promise = generateFolderReport(
        checkIfLoadingData,
        dashboards,
        "Folder",
        "folder",
        "pdf",
        "all-tabs",
        true,
        onProgress,
      );
      await vi.advanceTimersByTimeAsync(60000);
      await promise;

      expect(onProgress).toHaveBeenCalled();
      expect(onProgress.mock.calls[0][0]).toBe(1);
      expect(onProgress.mock.calls[0][1]).toBe(1);
      expect(onProgress.mock.calls[0][2]).toBe("Dashboard 1");
    });
  });

  describe("callbacks", () => {
    it("calls onFinish on success", async () => {
      const dashboards: DashboardInfo[] = [
        { id: "dash1", name: "Dashboard 1", tabs: [{ id: "tab1", name: "Tab 1" }] },
      ];
      const onFinish = vi.fn();

      const promise = generateFolderReport(
        checkIfLoadingData,
        dashboards,
        "Folder",
        "folder",
        "pdf",
        "current",
        true,
        undefined,
        onFinish,
      );
      await vi.advanceTimersByTimeAsync(60000);
      await promise;

      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it("calls onError on failure", async () => {
      const dashboards: DashboardInfo[] = [
        { id: "dash1", name: "Dashboard 1", tabs: [{ id: "tab1", name: "Tab 1" }] },
      ];
      const onError = vi.fn();

      (toPng as Mock).mockRejectedValue(new Error("Capture failed"));

      const promise = generateFolderReport(
        checkIfLoadingData,
        dashboards,
        "Folder",
        "folder",
        "pdf",
        "current",
        true,
        undefined,
        undefined,
        onError,
      );
      await vi.advanceTimersByTimeAsync(60000);
      await promise;

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe("navigation restoration", () => {
    it("restores original dashboard and tab path in finally block", async () => {
      const dashboards: DashboardInfo[] = [
        { id: "dash1", name: "Dashboard 1", tabs: [{ id: "tab1", name: "Tab 1" }] },
      ];

      const promise = generateFolderReport(
        checkIfLoadingData,
        dashboards,
        "Folder",
        "folder",
        "pdf",
        "current",
        true,
      );
      await vi.advanceTimersByTimeAsync(60000);
      await promise;

      const calls = (window.history.replaceState as Mock).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[2]).toContain("/app/original-dashboard");
    });

    it("restores URL even when original path is not a dashboard path", async () => {
      Object.defineProperty(window, "location", {
        value: {
          href: "http://localhost:3000/settings",
          search: "",
          pathname: "/settings",
        },
        writable: true,
      });

      const dashboards: DashboardInfo[] = [
        { id: "dash1", name: "Dashboard 1", tabs: [{ id: "tab1", name: "Tab 1" }] },
      ];

      const promise = generateFolderReport(
        checkIfLoadingData,
        dashboards,
        "Folder",
        "folder",
        "pdf",
        "current",
        true,
      );
      await vi.advanceTimersByTimeAsync(60000);
      await promise;

      const calls = (window.history.replaceState as Mock).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[2]).toBe("/settings");
    });
  });

  describe("error handling", () => {
    it("continues to next element if grid layout not found", async () => {
      const dashboards: DashboardInfo[] = [
        { id: "dash1", name: "Dashboard 1", tabs: [{ id: "tab1", name: "Tab 1" }] },
        { id: "dash2", name: "Dashboard 2", tabs: [{ id: "tab1", name: "Tab 1" }] },
      ];

      let callCount = 0;
      document.getElementsByClassName = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return [];
        return [mockElement];
      });

      const onFinish = vi.fn();

      const promise = generateFolderReport(
        checkIfLoadingData,
        dashboards,
        "Folder",
        "folder",
        "pdf",
        "current",
        true,
        undefined,
        onFinish,
      );
      await vi.advanceTimersByTimeAsync(60000);
      await promise;

      expect(onFinish).toHaveBeenCalled();
    });
  });
});
