import { BackendUser, User, UserProfile, ValidationResponse } from "~/types/user.types.ts";
import { backendClient } from "./api.ts";

/* Auth */

export async function login(
  email: string,
  password: string,
  remember: boolean,
): Promise<User> {
  const { data } = await backendClient.post<BackendUser>("/app/login", {
    email: email,
    password: password,
    remember: remember,
    source: "excel",
  });

  const { user, ...rest } = data;
  return {
    ...rest,
    // rename 'user' to 'profile', the backend schema is confusing with user inside
    profile: user || undefined,
  };
}

export async function validateUser(): Promise<ValidationResponse> {
  const { data } = await backendClient.get("/app/validate");
  return data;
}

export async function logout() {
  const { data } = await backendClient.post("/app/logout");
  return data;
}

export async function getUserProfile(): Promise<UserProfile> {
  const { data } = await backendClient.get<UserProfile>("/app/user");
  return data;
}
