import { createServer, type Server } from "node:http";

export interface ReceivedRequest {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string | undefined>;
  body: string;
}

const ECHO_WIDGETS = {
  e2e_team_report: {
    name: "E2E team report",
    description: "Report for one team and period",
    type: "markdown",
    method: "POST",
    endpoint: "/teams/{team}/report",
    params: [
      {
        paramName: "team",
        type: "endpoint",
        label: "Team",
        value: "platform",
        optionsEndpoint: "/teams/search",
        optionsMethod: "POST",
        optionsParams: { active: true, region: "$X-Region" },
      },
      { paramName: "period", type: "text", label: "Period", value: "month" },
      {
        paramName: "X-Region",
        type: "text",
        label: "Region",
        value: "eu",
        in: "header",
      },
      {
        paramName: "filters",
        type: "text",
        label: "Filters",
        value: "active",
        in: "body",
      },
    ],
  },
};

const TEAMS = [
  { label: "Platform", value: "platform" },
  { label: "Data / Science", value: "data/science" },
];

export function startEchoBackend(
  port: number,
  listen: string,
): Promise<{ server: Server; received: ReceivedRequest[] }> {
  const received: ReceivedRequest[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push({
        method: request.method ?? "",
        path: url.pathname,
        query: url.search.slice(1),
        headers: {
          "x-region": request.headers["x-region"] as string | undefined,
          "content-type": request.headers["content-type"],
          "x-api-key": request.headers["x-api-key"] as string | undefined,
          "x-workspace-user": request.headers["x-workspace-user"] as string | undefined,
        },
        body,
      });
      const send = (status: number, payload: unknown) =>
        response
          .writeHead(status, { "Content-Type": "application/json" })
          .end(JSON.stringify(payload));
      if (url.pathname === "/widgets.json") send(200, ECHO_WIDGETS);
      else if (url.pathname === "/apps.json") send(200, []);
      else if (url.pathname === "/teams/search" && request.method === "POST")
        send(200, TEAMS);
      else if (
        /^\/teams\/[^/]+\/report$/.test(url.pathname) &&
        request.method === "POST"
      )
        response
          .writeHead(200, { "Content-Type": "text/plain" })
          .end(
            [
              "# Received",
              "",
              `- path: \`${url.pathname}\``,
              `- query: \`${url.search.slice(1)}\``,
              `- region: \`${request.headers["x-region"]}\``,
              `- body: \`${body}\``,
            ].join("\n"),
          );
      else send(404, { detail: "not found" });
    });
  });
  return new Promise((resolve) =>
    server.listen(port, listen, () => resolve({ server, received })),
  );
}
