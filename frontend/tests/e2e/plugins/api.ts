import type { BrowserContext } from "@playwright/test";

export type ApiResponse = {
  ok(): boolean;
  status(): number;
  url(): string;
  text(): Promise<string>;
  // biome-ignore lint/suspicious/noExplicitAny: the API's answer, as Playwright's APIResponse.json() gives it
  json(): Promise<any>;
};

export type PageApi = {
  get(path: string): Promise<ApiResponse>;
  post(path: string, options?: { data?: unknown }): Promise<ApiResponse>;
  put(path: string, options?: { data?: unknown }): Promise<ApiResponse>;
  delete(path: string, options?: { data?: unknown }): Promise<ApiResponse>;
  dispose(): Promise<void>;
};

export async function pageApi(
  context: BrowserContext,
  apiUrl: string,
): Promise<PageApi> {
  const page = await context.newPage();
  await page.goto("/robots.txt");
  const call = async (method: string, path: string, data?: unknown) => {
    const url = new URL(path, apiUrl).toString();
    const answer = await page.evaluate(
      async (request) => {
        const response = await fetch(request.url, {
          method: request.method,
          credentials: "include",
          headers: {
            "X-Workspace-Client": "web",
            ...(request.body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body: request.body,
        });
        return { status: response.status, text: await response.text() };
      },
      { url, method, body: data === undefined ? undefined : JSON.stringify(data) },
    );
    return {
      ok: () => answer.status >= 200 && answer.status < 300,
      status: () => answer.status,
      url: () => url,
      text: async () => answer.text,
      json: async () => JSON.parse(answer.text),
    } satisfies ApiResponse;
  };
  return {
    get: (path) => call("GET", path),
    post: (path, options) => call("POST", path, options?.data),
    put: (path, options) => call("PUT", path, options?.data),
    delete: (path, options) => call("DELETE", path, options?.data),
    dispose: () => page.close(),
  };
}

export async function createRole(
  api: PageApi,
  email: string,
  name: string,
): Promise<string> {
  const uuid = crypto.randomUUID();
  const role = { uuid, name, description: name, users: [email] };
  const created = await api.post("/admin/role", { data: role });
  if (!created.ok()) throw new Error(`${created.url()}: ${created.status()}`);
  return uuid;
}

export async function grantPlugins(
  api: PageApi,
  email: string,
  name: string,
  pluginIds: string[],
): Promise<string> {
  const uuid = await createRole(api, email, name);
  const grants = pluginIds.map((plugin_id) => ({ plugin_id, widget_id: "*" }));
  const granted = await api.put(`/admin/role/${uuid}/plugin-access`, {
    data: { grants },
  });
  if (!granted.ok()) throw new Error(`${granted.url()}: ${granted.status()}`);
  return uuid;
}

export async function grantBackend(
  api: PageApi,
  roleUuid: string,
  entityUuid: string,
  name: string,
  widgetIds: string[] = [],
): Promise<void> {
  const listed = await api.get(`/entity/data-backends/${entityUuid}`);
  if (!listed.ok()) throw new Error(`${listed.url()}: ${listed.status()}`);
  const backend = (await listed.json()).find(
    (item: { name: string }) => item.name === name,
  );
  if (!backend) throw new Error(`The organization has no backend named ${name}`);
  const granted = await api.put(`/admin/role-permissions/${roleUuid}`, {
    data: [
      {
        uuid: backend.uuid,
        type: "backend",
        category: "data-connectors",
        access: "access",
        widgets: widgetIds.map((widgetId) => ({ widgetId, access: "access" })),
      },
    ],
  });
  if (!granted.ok()) throw new Error(`${granted.url()}: ${granted.status()}`);
}
