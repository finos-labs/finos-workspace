import type { AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUser,
  deleteUser,
  getEntity,
  getEntityMap,
  getUsers,
  inviteUser,
  resetUserPassword,
  updateEntity,
  updateUser,
} from "~/api/admin.api";
import { apiClient } from "~/api/api";
import type { EntitySettings } from "~/types/entity.type";
import type { User } from "~/types/user.type";

type MockedAxiosMethod<T = unknown> = {
  (url: string, ...args: unknown[]): Promise<AxiosResponse<T>>;
  mockResolvedValueOnce: (value: { data: T }) => void;

  mockRejectedValueOnce: (error: unknown) => void;
};

vi.mock("~/api/api", () => ({
  apiClient: {
    get: vi.fn() as MockedAxiosMethod,
    post: vi.fn() as MockedAxiosMethod,
    patch: vi.fn() as MockedAxiosMethod,
    delete: vi.fn() as MockedAxiosMethod,
  },
}));

const mockData = {
  users: [
    {
      uuid: "1",
      first_name: "Test",
      last_name: "User",
      email: "user@mail.test",
      role: "user",
      status: "active",
      last_login: "2024-01-01",
      last_active: "2024-01-01",
      permissions_uuid: "some-permission-uuid",
      source: "user" as const,
    },
  ],
  baseResponse: { success: true, message: "Success" },
  passwordLinkResponse: {
    success: true,
    link: "http://localhost:3000/reset-password#the-token",
    expires_at: "2026-10-17T12:00:00Z",
  },
  entitySettings: { require_authenticator: true },
  entityMap: [{ uuid: "1", name: "Admin" }],
};

describe("API functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch users", async () => {
    (apiClient.get as MockedAxiosMethod<User[]>).mockResolvedValueOnce({
      data: mockData.users,
    });
    const users = await getUsers();
    expect(apiClient.get).toHaveBeenCalledWith("/admin/users");
    expect(users).toEqual(mockData.users);
  });

  it("should invite a user", async () => {
    const newUser = { email: "test@example.com" };
    (apiClient.post as MockedAxiosMethod).mockResolvedValueOnce({
      data: mockData.baseResponse,
    });
    const response = await inviteUser(newUser);
    expect(apiClient.post).toHaveBeenCalledWith("/admin/register", newUser);
    expect(response).toEqual(mockData.baseResponse);
  });

  it("should create a user", async () => {
    const newUser = { email: "test@example.com" };
    (apiClient.post as MockedAxiosMethod).mockResolvedValueOnce({
      data: mockData.passwordLinkResponse,
    });
    const response = await createUser(newUser);
    expect(apiClient.post).toHaveBeenCalledWith("/admin/create-user", newUser);
    expect(response).toEqual(mockData.passwordLinkResponse);
  });

  it("resets a user's password to a link that sets a new one", async () => {
    (apiClient.post as MockedAxiosMethod).mockResolvedValueOnce({
      data: mockData.passwordLinkResponse,
    });

    const response = await resetUserPassword("1");

    expect(apiClient.post).toHaveBeenCalledWith("/admin/reset-password/1");
    expect(response).toEqual(mockData.passwordLinkResponse);
  });

  it("should update a user", async () => {
    const userId = "1";
    const payload: Partial<User> = { first_name: "Test", last_name: "User" };
    (apiClient.patch as MockedAxiosMethod).mockResolvedValueOnce({
      data: mockData.baseResponse,
    });
    const response = await updateUser(userId, payload);
    expect(apiClient.patch).toHaveBeenCalledWith(`/admin/users/${userId}`, payload);
    expect(response).toEqual(mockData.baseResponse);
  });

  it("should delete a user", async () => {
    const userId = "1";
    (apiClient.delete as MockedAxiosMethod).mockResolvedValueOnce({
      data: mockData.baseResponse,
    });
    const response = await deleteUser(userId, "user");
    expect(apiClient.delete).toHaveBeenCalledWith(`/admin/users/${userId}`);
    expect(response).toEqual(mockData.baseResponse);
  });

  it("should fetch entity settings", async () => {
    (apiClient.get as MockedAxiosMethod).mockResolvedValueOnce({
      data: mockData.entitySettings,
    });
    const entitySettings = await getEntity();
    expect(apiClient.get).toHaveBeenCalledWith("/admin/entity");
    expect(entitySettings).toEqual(mockData.entitySettings);
  });

  it("should update entity settings", async () => {
    const payload: Partial<EntitySettings> = { require_authenticator: false };
    (apiClient.patch as MockedAxiosMethod).mockResolvedValueOnce({
      data: mockData.baseResponse,
    });
    const response = await updateEntity(payload);
    expect(apiClient.patch).toHaveBeenCalledWith("/admin/entity", payload);
    expect(response).toEqual(mockData.baseResponse);
  });

  it("should fetch entity map", async () => {
    (apiClient.get as MockedAxiosMethod).mockResolvedValueOnce({
      data: mockData.entityMap,
    });
    const entityMap = await getEntityMap();
    expect(apiClient.get).toHaveBeenCalledWith("/admin/entity-map");
    expect(entityMap).toEqual(mockData.entityMap);
  });
});
