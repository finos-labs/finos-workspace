import axios, { type AxiosError } from "axios";
import { getConfig } from "~/lib/runtimeConfig";
import { isApiUrl, WORKSPACE_CLIENT, WORKSPACE_CLIENT_HEADER } from "~/lib/utils/fetch";

export const apiClient = axios.create({});

let onSessionRefused = () => {};
export function setOnSessionRefused(handler: () => void) {
  onSessionRefused = handler;
}

apiClient.interceptors.request.use((config) => {
  if (!config.baseURL) {
    config.baseURL = getConfig().urls.backend;
  }

  const toApi = isApiUrl(apiClient.getUri(config));
  config.withCredentials = toApi;
  if (toApi) config.headers.set(WORKSPACE_CLIENT_HEADER, WORKSPACE_CLIENT);
  else config.headers.delete(WORKSPACE_CLIENT_HEADER);

  if (import.meta.env.DEV)
    console.info("[API req]", `${config.method?.toUpperCase()} ${config.url}`);

  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    if (import.meta.env.DEV)
      console.info(
        `[API res] ${response.status} ${response.config.url}`,
        response.data,
        response,
      );

    return response;
  },
  (error: AxiosError) => {
    const { response, config } = error;
    const status = response?.status || error?.status || "unknown";

    if (error?.code !== "ERR_CANCELED" && import.meta.env.DEV)
      console.info(`[API err] ${status} ${config?.url}`, error);

    if (
      response?.status === 401 &&
      config &&
      isApiUrl(apiClient.getUri(config)) &&
      !config.url?.includes("/app/logout")
    ) {
      onSessionRefused();
    }

    return Promise.reject(error);
  },
);
