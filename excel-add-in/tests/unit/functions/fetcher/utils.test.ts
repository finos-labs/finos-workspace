import { privateFunc } from "~/functions/fetcher/utils";
import { useAuthStore } from "~/store/auth";

// Tests
describe("privateFunc", () => {
  test("failure.noToken", () => {
    const expected = "Sign in to the add-in.";
    jest.spyOn(useAuthStore, "getState").mockImplementation(() => ({
      user: {
        email: "",
        username: "",
        access_token: "",
        // @ts-expect-error - we don't need the profile
        profile: {
          api_sources: [],
        },
        expiration_date: "2021-09-01T00:00:00.000Z",
      },
      login: jest.fn(),
      logout: jest.fn(),
    }));
    expect(() => {
      privateFunc();
    }).toThrow(expected);
  });

  test("failure.expiredToken", () => {
    const expected = "Sign in to the add-in.";
    jest.spyOn(useAuthStore, "getState").mockImplementation(() => ({
      user: {
        email: "",
        username: "",
        access_token: "testToken",
        // @ts-expect-error - we don't need the profile
        profile: {
          api_sources: [],
        },        
        expiration_date: "2021-09-01T00:00:00.000Z",
      },
      login: jest.fn(),
      logout: jest.fn(),
    }));
    expect(() => {
      privateFunc();
    }).toThrow(expected);
  });

  test("success.validToken", () => {
    const expected = "testToken";
    jest.spyOn(useAuthStore, "getState").mockImplementation(() => ({
      user: {
        email: "",
        username: "",
        access_token: expected,
        // @ts-expect-error - we don't need the profile
        profile: {
          api_sources: [],
        },        
        expiration_date: "2100-09-01T00:00:00.000Z",
      },
      login: jest.fn(),
      logout: jest.fn(),
    }));
    expect(() => {
      privateFunc();
    }).not.toThrow();
  });
});
