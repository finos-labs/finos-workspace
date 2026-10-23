import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { PermissionsT } from "~/api/user_roles.api";
import { usePermissionsStore } from "~/lib/state/permissions";
import { partial } from "../../mocks";

describe("usePermissionsStore", () => {
  beforeEach(() => {
    act(() => {
      usePermissionsStore.setState({
        permissions: {
          backends: [],
          files: [],
          prompts: [],
        },
      });
    });
  });

  describe("initial state", () => {
    it("should have empty permissions initially", () => {
      const state = usePermissionsStore.getState();

      expect(state.permissions).toEqual({
        backends: [],
        files: [],
        prompts: [],
      });
    });
  });

  describe("setPermissions", () => {
    it("should set permissions", () => {
      const newPermissions = partial<PermissionsT>({
        backends: [
          {
            uuid: "backend-1",
            widgets: [{ widgetId: "widget-1", access: "access" as const }],
          },
        ],
        files: [{ uuid: "file-1", access: "access" as const }],
        prompts: [],
      });

      act(() => {
        usePermissionsStore.getState().setPermissions(newPermissions);
      });

      expect(usePermissionsStore.getState().permissions).toEqual(newPermissions);
    });

    it("should replace existing permissions", () => {
      const initialPermissions = partial<PermissionsT>({
        backends: [
          {
            uuid: "backend-1",
            widgets: [{ widgetId: "widget-1", access: "access" as const }],
          },
        ],
        files: [],
        prompts: [],
      });

      const newPermissions = partial<PermissionsT>({
        backends: [
          {
            uuid: "backend-2",
            widgets: [{ widgetId: "widget-2", access: "access" as const }],
          },
        ],
        files: [{ uuid: "file-2", access: "access" as const }],
        prompts: [],
      });

      act(() => {
        usePermissionsStore.getState().setPermissions(initialPermissions);
      });

      act(() => {
        usePermissionsStore.getState().setPermissions(newPermissions);
      });

      expect(usePermissionsStore.getState().permissions).toEqual(newPermissions);
    });
  });

  describe("hasAccess", () => {
    describe("backend widgets", () => {
      it("should return true when widget has access", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [
                {
                  uuid: "backend-1",
                  widgets: [{ widgetId: "widget-1", access: "access" }],
                },
              ],
              files: [],
              prompts: [],
            }),
          );
        });

        expect(usePermissionsStore.getState().hasAccess("backend-1", "widget-1")).toBe(
          true,
        );
      });

      it("should return false when widget does not have access", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [
                {
                  uuid: "backend-1",
                  widgets: [{ widgetId: "widget-1", access: "no-access" }],
                },
              ],
              files: [],
              prompts: [],
            }),
          );
        });

        expect(usePermissionsStore.getState().hasAccess("backend-1", "widget-1")).toBe(
          false,
        );
      });

      it("should return false when widget is not in backend", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [
                {
                  uuid: "backend-1",
                  widgets: [{ widgetId: "widget-1", access: "access" }],
                },
              ],
              files: [],
              prompts: [],
            }),
          );
        });

        expect(usePermissionsStore.getState().hasAccess("backend-1", "widget-2")).toBe(
          false,
        );
      });

      it("should return false when backend is not found", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [
                {
                  uuid: "backend-1",
                  widgets: [{ widgetId: "widget-1", access: "access" }],
                },
              ],
              files: [],
              prompts: [],
            }),
          );
        });

        expect(usePermissionsStore.getState().hasAccess("backend-2", "widget-1")).toBe(
          false,
        );
      });
    });

    describe("file permissions", () => {
      it("should return true when file has access", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [],
              files: [{ uuid: "file-1", access: "access" }],
              prompts: [],
            }),
          );
        });

        expect(usePermissionsStore.getState().hasAccess("file-1", "")).toBe(true);
      });

      it("should return false when file does not have access", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [],
              files: [{ uuid: "file-1", access: "no-access" }],
              prompts: [],
            }),
          );
        });

        expect(usePermissionsStore.getState().hasAccess("file-1", "")).toBe(false);
      });

      it("should check file permissions when backend not found", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [
                {
                  uuid: "backend-1",
                  widgets: [],
                },
              ],
              files: [{ uuid: "file-1", access: "access" }],
              prompts: [],
            }),
          );
        });

        expect(usePermissionsStore.getState().hasAccess("file-1", "widget-1")).toBe(
          true,
        );
      });
    });

    describe("edge cases", () => {
      it("should return false when sourceId is empty", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [
                {
                  uuid: "backend-1",
                  widgets: [{ widgetId: "widget-1", access: "access" }],
                },
              ],
              files: [],
              prompts: [],
            }),
          );
        });

        expect(usePermissionsStore.getState().hasAccess("", "widget-1")).toBe(false);
      });

      it("should handle multiple backends", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [
                {
                  uuid: "backend-1",
                  widgets: [{ widgetId: "widget-1", access: "access" }],
                },
                {
                  uuid: "backend-2",
                  widgets: [{ widgetId: "widget-2", access: "no-access" }],
                },
              ],
              files: [],
              prompts: [],
            }),
          );
        });

        expect(usePermissionsStore.getState().hasAccess("backend-1", "widget-1")).toBe(
          true,
        );
        expect(usePermissionsStore.getState().hasAccess("backend-2", "widget-2")).toBe(
          false,
        );
      });
    });
  });

  describe("isSharedWidget", () => {
    describe("backend widgets", () => {
      it("should return true when widget has access", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [
                {
                  uuid: "backend-1",
                  widgets: [{ widgetId: "widget-1", access: "access" }],
                },
              ],
              files: [],
              prompts: [],
            }),
          );
        });

        expect(
          usePermissionsStore.getState().isSharedWidget("backend-1", "widget-1"),
        ).toBe(true);
      });

      it("should return false when widget does not have access", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [
                {
                  uuid: "backend-1",
                  widgets: [{ widgetId: "widget-1", access: "no-access" }],
                },
              ],
              files: [],
              prompts: [],
            }),
          );
        });

        expect(
          usePermissionsStore.getState().isSharedWidget("backend-1", "widget-1"),
        ).toBe(false);
      });

      it("should return undefined when widget is not found", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [
                {
                  uuid: "backend-1",
                  widgets: [{ widgetId: "widget-1", access: "access" }],
                },
              ],
              files: [],
              prompts: [],
            }),
          );
        });

        expect(
          usePermissionsStore.getState().isSharedWidget("backend-1", "widget-2"),
        ).toBe(false);
      });
    });

    describe("file permissions", () => {
      it("should return true when file has access", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [],
              files: [{ uuid: "file-1", access: "access" }],
              prompts: [],
            }),
          );
        });

        expect(usePermissionsStore.getState().isSharedWidget("file-1", "")).toBe(true);
      });

      it("should return false when file does not have access", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [],
              files: [{ uuid: "file-1", access: "no-access" }],
              prompts: [],
            }),
          );
        });

        expect(usePermissionsStore.getState().isSharedWidget("file-1", "")).toBe(false);
      });
    });

    describe("not found cases", () => {
      it("should return false when backend not found", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [],
              files: [],
              prompts: [],
            }),
          );
        });

        expect(
          usePermissionsStore.getState().isSharedWidget("backend-1", "widget-1"),
        ).toBe(false);
      });

      it("should return false when neither backend nor file found", () => {
        act(() => {
          usePermissionsStore.getState().setPermissions(
            partial<PermissionsT>({
              backends: [
                {
                  uuid: "backend-1",
                  widgets: [],
                },
              ],
              files: [{ uuid: "file-1", access: "access" }],
              prompts: [],
            }),
          );
        });

        expect(
          usePermissionsStore.getState().isSharedWidget("unknown-source", "widget-1"),
        ).toBe(false);
      });
    });
  });

  describe("complex permission scenarios", () => {
    it("should handle mixed permissions correctly", () => {
      act(() => {
        usePermissionsStore.getState().setPermissions(
          partial<PermissionsT>({
            backends: [
              {
                uuid: "backend-1",
                widgets: [
                  { widgetId: "widget-1", access: "access" },
                  { widgetId: "widget-2", access: "no-access" },
                  { widgetId: "widget-3", access: "access" },
                ],
              },
              {
                uuid: "backend-2",
                widgets: [{ widgetId: "widget-4", access: "access" }],
              },
            ],
            files: [
              { uuid: "file-1", access: "access" },
              { uuid: "file-2", access: "no-access" },
            ],
            prompts: [],
          }),
        );
      });

      expect(usePermissionsStore.getState().hasAccess("backend-1", "widget-1")).toBe(
        true,
      );
      expect(usePermissionsStore.getState().hasAccess("backend-1", "widget-2")).toBe(
        false,
      );
      expect(usePermissionsStore.getState().hasAccess("backend-1", "widget-3")).toBe(
        true,
      );

      expect(usePermissionsStore.getState().hasAccess("backend-2", "widget-4")).toBe(
        true,
      );

      expect(usePermissionsStore.getState().hasAccess("file-1", "")).toBe(true);
      expect(usePermissionsStore.getState().hasAccess("file-2", "")).toBe(false);

      expect(
        usePermissionsStore.getState().isSharedWidget("backend-1", "widget-1"),
      ).toBe(true);
      expect(
        usePermissionsStore.getState().isSharedWidget("backend-1", "widget-2"),
      ).toBe(false);
    });
  });
});
