import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();
const mockAddTab = vi.fn();
const mockCreateCustomTemplateTab = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: "test-dashboard-id" }),
  };
});

vi.mock("~/lib/state/app", () => ({
  useShallowAppStore: vi.fn(),
}));

vi.mock("~/lib/state/backendConnector", () => ({
  useShallowBackendConnectorStore: vi.fn(),
  getTemplateWidgetsMetadata: vi.fn(),
}));

vi.mock("~/hooks/useSharedTemplates", () => ({
  useSharedTemplates: vi.fn(),
}));

vi.mock("~/lib/utils/createTemplates", () => ({
  createCustomTemplateTab: (...args: unknown[]) => mockCreateCustomTemplateTab(...args),
}));

import { useAllTemplates } from "~/hooks/useAllTemplates";
import { type ProcessedTemplate, useSharedTemplates } from "~/hooks/useSharedTemplates";
import { useShallowAppStore } from "~/lib/state/app";
import {
  getTemplateWidgetsMetadata,
  type Source,
  useShallowBackendConnectorStore,
} from "~/lib/state/backendConnector";
import { makeItem } from "../factories";
import { malformed, partial, stubStoreState } from "../mocks";

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

describe("useAllTemplates", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    stubStoreState(useShallowAppStore, {
      addTab: mockAddTab,
      items: { "test-dashboard-id": makeItem({ index: "test-dashboard-id" }) },
    });

    stubStoreState(useShallowBackendConnectorStore, {
      apiSources: [],
    });

    vi.mocked(useSharedTemplates).mockReturnValue(partial({ data: [] }));
    vi.mocked(getTemplateWidgetsMetadata).mockReturnValue(
      partial({
        widgets: [],
        totalWidgets: 0,
      }),
    );
  });

  describe("basic functionality", () => {
    it("should return empty array when no templates available", () => {
      const { result } = renderHook(() => useAllTemplates(), { wrapper });

      expect(result.current).toEqual([]);
    });
  });

  describe("user templates from API sources", () => {
    it("should include user templates from apiSources", () => {
      const mockSource = partial<Source>({
        uuid: "source-1",
        name: "Custom Backend",
        url: "https://custom.api.com",
        templates: [
          {
            id: "custom-template",
            name: "Custom Template",
            description: "User's custom template",
            prompts: ["Custom prompt"],
            img: "/custom.png",
          },
        ],
      });

      stubStoreState(useShallowBackendConnectorStore, {
        apiSources: [mockSource],
      });

      vi.mocked(getTemplateWidgetsMetadata).mockReturnValue(
        partial({
          widgets: [{ name: "Custom Widget" }],
          totalWidgets: 1,
        }),
      );

      const { result } = renderHook(() => useAllTemplates(), { wrapper });

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe("user");
      expect(result.current[0].id).toBe("custom-template");
      expect(result.current[0].name).toBe("Custom Template");
      expect(result.current[0].source).toBe(mockSource);
    });

    it("should filter out sources without templates", () => {
      stubStoreState(useShallowBackendConnectorStore, {
        apiSources: [
          { uuid: "source-1", templates: [] },
          malformed<Source>({ uuid: "source-2", templates: null }),
          {
            uuid: "source-3",
            templates: [{ id: "custom-t1", name: "Template" }],
          },
        ],
      });

      vi.mocked(getTemplateWidgetsMetadata).mockReturnValue(
        partial({
          widgets: [],
          totalWidgets: 0,
        }),
      );

      const { result } = renderHook(() => useAllTemplates(), { wrapper });

      expect(result.current).toHaveLength(1);
    });

    it("should call createCustomTemplateTab on user template click", () => {
      const mockSource = partial<Source>({
        uuid: "source-1",
        templates: [
          {
            id: "custom-template",
            name: "Custom Template",
            description: "Desc",
          },
        ],
      });

      stubStoreState(useShallowBackendConnectorStore, {
        apiSources: [mockSource],
      });

      vi.mocked(getTemplateWidgetsMetadata).mockReturnValue(
        partial({
          widgets: [],
          totalWidgets: 0,
        }),
      );

      const { result } = renderHook(() => useAllTemplates(), { wrapper });

      result.current[0].onClick();

      expect(mockCreateCustomTemplateTab).toHaveBeenCalledWith({
        addTab: mockAddTab,
        navigate: mockNavigate,
        items: { "test-dashboard-id": makeItem({ index: "test-dashboard-id" }) },
        template: mockSource.templates?.[0],
        source: mockSource,
        currentDashboard: "test-dashboard-id",
      });
    });

    it("should mark user templates as shared when in sharedTemplatesData", () => {
      const mockSource = partial<Source>({
        uuid: "source-1",
        templates: [
          { id: "custom-shared-template", name: "Shared Template" },
          { id: "custom-private-template", name: "Private Template" },
        ],
      });

      stubStoreState(useShallowBackendConnectorStore, {
        apiSources: [mockSource],
      });

      vi.mocked(useSharedTemplates).mockReturnValue(
        partial({
          data: [{ id: "custom-shared-template" }],
        }),
      );

      vi.mocked(getTemplateWidgetsMetadata).mockReturnValue(
        partial({
          widgets: [],
          totalWidgets: 0,
        }),
      );

      const { result } = renderHook(() => useAllTemplates(), { wrapper });

      const sharedTemplate = result.current.find(
        (t) => t.id === "custom-shared-template",
      );
      const privateTemplate = result.current.find(
        (t) => t.id === "custom-private-template",
      );

      expect(sharedTemplate?.isShared).toBe(true);
      expect(privateTemplate?.isShared).toBe(false);
    });
  });

  describe("shared templates", () => {
    it("should include shared templates with correct type", () => {
      const mockSharedTemplate = partial<ProcessedTemplate<string>>({
        id: "custom-shared-1",
        templateId: "shared-template-id",
        name: "Shared Template",
        description: "A shared template",
        prompts: ["Shared prompt"],
        source: { uuid: "shared-source" },
      });

      vi.mocked(useSharedTemplates).mockReturnValue(
        partial({
          data: [mockSharedTemplate],
        }),
      );

      vi.mocked(getTemplateWidgetsMetadata).mockReturnValue(
        partial({
          widgets: [{ name: "Shared Widget" }],
          totalWidgets: 2,
        }),
      );

      const { result } = renderHook(() => useAllTemplates(), { wrapper });

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe("shared");
      expect(result.current[0].id).toBe("shared-template-id");
      expect(result.current[0].name).toBe("Shared Template");
    });

    it("should not duplicate templates that exist in both user and shared", () => {
      const mockSource = partial<Source>({
        uuid: "source-1",
        templates: [{ id: "custom-duplicate-id", name: "User Template" }],
      });

      stubStoreState(useShallowBackendConnectorStore, {
        apiSources: [mockSource],
      });

      vi.mocked(useSharedTemplates).mockReturnValue(
        partial({
          data: [
            {
              id: "custom-duplicate-id",
              templateId: "custom-duplicate-id",
              name: "Shared Template",
              source: {},
            },
          ],
        }),
      );

      vi.mocked(getTemplateWidgetsMetadata).mockReturnValue(
        partial({
          widgets: [],
          totalWidgets: 0,
        }),
      );

      const { result } = renderHook(() => useAllTemplates(), { wrapper });

      const duplicateTemplates = result.current.filter(
        (t) => t.id === "custom-duplicate-id",
      );
      expect(duplicateTemplates).toHaveLength(1);
      expect(duplicateTemplates[0].type).toBe("user");
    });

    it("should call createCustomTemplateTab on shared template click", () => {
      const mockSharedTemplate = partial<ProcessedTemplate<string>>({
        id: "custom-shared-1",
        templateId: "shared-template-id",
        name: "Shared Template",
        description: "Desc",
        prompts: [],
        source: { uuid: "shared-source" },
      });

      vi.mocked(useSharedTemplates).mockReturnValue(
        partial({
          data: [mockSharedTemplate],
        }),
      );

      vi.mocked(getTemplateWidgetsMetadata).mockReturnValue(
        partial({
          widgets: [],
          totalWidgets: 0,
        }),
      );

      const { result } = renderHook(() => useAllTemplates(), { wrapper });

      result.current[0].onClick();

      expect(mockCreateCustomTemplateTab).toHaveBeenCalledWith({
        addTab: mockAddTab,
        navigate: mockNavigate,
        items: { "test-dashboard-id": makeItem({ index: "test-dashboard-id" }) },
        template: mockSharedTemplate,
        source: mockSharedTemplate.source,
        currentDashboard: "test-dashboard-id",
      });
    });
  });

  describe("template ordering", () => {
    it("should order templates as: shared, user", () => {
      stubStoreState(useShallowBackendConnectorStore, {
        apiSources: [
          {
            uuid: "source-1",
            templates: [{ id: "custom-user-template", name: "User Template" }],
          },
        ],
      });

      vi.mocked(useSharedTemplates).mockReturnValue(
        partial({
          data: [
            {
              id: "custom-shared-template",
              templateId: "custom-shared-template",
              name: "Shared Template",
              source: {},
            },
          ],
        }),
      );

      vi.mocked(getTemplateWidgetsMetadata).mockReturnValue(
        partial({
          widgets: [],
          totalWidgets: 0,
        }),
      );

      const { result } = renderHook(() => useAllTemplates(), { wrapper });

      expect(result.current[0].type).toBe("shared");
      expect(result.current[1].type).toBe("user");
    });
  });

  describe("isLoadingApiSources parameter", () => {
    it("should disable shared templates query when isLoadingApiSources is true", () => {
      renderHook(() => useAllTemplates(true), { wrapper });

      expect(useSharedTemplates).toHaveBeenCalledWith({ enabled: false });
    });

    it("should enable shared templates query when isLoadingApiSources is false", () => {
      renderHook(() => useAllTemplates(false), { wrapper });

      expect(useSharedTemplates).toHaveBeenCalledWith({ enabled: true });
    });

    it("should default to enabling shared templates query", () => {
      renderHook(() => useAllTemplates(), { wrapper });

      expect(useSharedTemplates).toHaveBeenCalledWith({ enabled: true });
    });
  });

  describe("template properties", () => {
    it("should include all template image variants", () => {
      const mockSource = partial<Source>({
        uuid: "source-1",
        templates: [
          {
            id: "custom-template-1",
            name: "Template",
            img: "/default.png",
            img_dark: "/dark.png",
            img_light: "/light.png",
          },
        ],
      });

      stubStoreState(useShallowBackendConnectorStore, {
        apiSources: [mockSource],
      });

      vi.mocked(getTemplateWidgetsMetadata).mockReturnValue(
        partial({
          widgets: [],
          totalWidgets: 0,
        }),
      );

      const { result } = renderHook(() => useAllTemplates(), { wrapper });

      expect(result.current[0].img).toBe("/default.png");
      expect(result.current[0].img_dark).toBe("/dark.png");
      expect(result.current[0].img_light).toBe("/light.png");
    });

    it("should include selected_agent for user templates", () => {
      const mockSource = partial<Source>({
        uuid: "source-1",
        templates: [
          {
            id: "custom-template-1",
            name: "Template",
            selected_agent: "custom-agent-id",
          },
        ],
      });

      stubStoreState(useShallowBackendConnectorStore, {
        apiSources: [mockSource],
      });

      vi.mocked(getTemplateWidgetsMetadata).mockReturnValue(
        partial({
          widgets: [],
          totalWidgets: 0,
        }),
      );

      const { result } = renderHook(() => useAllTemplates(), { wrapper });

      expect(result.current[0].selected_agent).toBe("custom-agent-id");
    });

    it("should include totalWidgets from getTemplateWidgetsMetadata", () => {
      const mockSource = partial<Source>({
        uuid: "source-1",
        templates: [{ id: "custom-template-1", name: "Template" }],
      });

      stubStoreState(useShallowBackendConnectorStore, {
        apiSources: [mockSource],
      });

      vi.mocked(getTemplateWidgetsMetadata).mockReturnValue(
        partial({
          widgets: [{ name: "W1" }, { name: "W2" }],
          totalWidgets: 5,
        }),
      );

      const { result } = renderHook(() => useAllTemplates(), { wrapper });

      expect(result.current[0].totalWidgets).toBe(5);
      expect(result.current[0].widgets).toEqual([{ name: "W1" }, { name: "W2" }]);
    });
  });
});
