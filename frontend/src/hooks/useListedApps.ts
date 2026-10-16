import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getUserSubscriptions, SUBSCRIPTIONS_QUERY_KEY } from "~/api/auth.api";
import { getConfig } from "~/lib/runtimeConfig";
import { createURLString } from "~/lib/utils/widgetParams";
import type { ListedApp } from "~/types/listedApps";

/**
 * The marketplace a deployment lists apps from: its own backend, unless `urls.marketplace`
 * names a remote one (which has to allow this origin).
 */
export function getMarketplaceBaseUrl(): string | undefined {
  return getConfig().urls.marketplace || undefined;
}

async function fetchListedApps(): Promise<ListedApp[]> {
  const baseURL = getMarketplaceBaseUrl() ?? getConfig().urls.backend;
  // The listing is public, and the API answers it to any origin: the request carries no
  // Workspace credentials (the browser would refuse that answer to a request with them)
  const response = await fetch(createURLString("marketplace/apps", baseURL), {
    credentials: "omit",
  });
  if (!response.ok) {
    throw new Error(`The marketplace listing failed with status ${response.status}`);
  }
  const data: ListedApp[] = await response.json();
  for (const app of data) {
    for (const img_key of ["img", "img_dark", "img_light"] as const) {
      const image = app?.appImages?.[img_key];
      if (!(image && app.appImages)) continue;
      app.appImages[img_key] = createURLString(image, app.backendUrl);
    }
  }

  return data;
}

export function useListedApps() {
  return useQuery({
    queryKey: ["listedApps"],
    queryFn: fetchListedApps,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });
}

export function useUserSubscriptions() {
  return useQuery({
    queryKey: SUBSCRIPTIONS_QUERY_KEY,
    queryFn: getUserSubscriptions,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5,
  });
}
