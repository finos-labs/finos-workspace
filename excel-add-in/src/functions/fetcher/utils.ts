import { useAuthStore } from "~/store/auth";
import { isExpired } from "./dates";
import { throwSignInError } from "./errors";

export function privateFunc() {
  let token: string | undefined = "";
  let expiration: string | undefined = "";
  try {
    const authData = useAuthStore.getState();
    ({ access_token: token, expiration_date: expiration } =
      authData?.user || {});
  } catch (error) {
    console.error(error);
  }

  if (!token) {
    console.error("🚫 User is not logged in.");
    throwSignInError();
  }

  if (isExpired(expiration)) {
    console.error("🚫 User token has expired.");
    const { logout } = useAuthStore.getState();
    logout();
    throwSignInError();
  }
}

export function isEmpty(obj: object | undefined) {
  return !obj || Object.keys(obj).length === 0;
}

export function processEndpointHeaders(
  endpointHeaders: {
    key?: string;
    value?: string;
    location?: "headers" | "query";
  }[],
) {
  return endpointHeaders.reduce(
    (acc, { key, value, location = "headers" }) => {
      if (key) acc[location][key] = value;
      return acc;
    },
    { headers: {}, query: {} },
  );
}