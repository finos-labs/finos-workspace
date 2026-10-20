import { createServer, type Server } from "node:https";
import { localhostTls } from "./tls";

/**
 * A Workspace backend that records every request it receives, for the request mapping
 * of `widgets.json` (docs/widget-plugins/WIDGETS-JSON.md 4). Its one widget uses every
 * location: a path param, a query param, a header param and a body param, and its
 * options come from a POST lookup whose body takes another param's value.
 */

export interface ReceivedRequest {
  method: string;
  /** As sent, still percent-encoded */
  path: string;
  query: string;
  headers: Record<string, string | undefined>;
  body: string;
}

export const ECHO_WIDGETS = {
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
  origin: string,
): Promise<{ server: Server; received: ReceivedRequest[] }> {
  const received: ReceivedRequest[] = [];
  // Over HTTPS, as the stack is: a page on HTTPS may not fetch http://localhost in WebKit
  const server = createServer(localhostTls(), (request, response) => {
    const url = new URL(request.url ?? "/", `https://localhost:${port}`);
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
          "access-control-request-method": request.headers[
            "access-control-request-method"
          ] as string | undefined,
          "access-control-request-headers": request.headers[
            "access-control-request-headers"
          ] as string | undefined,
        },
        body,
      });
      // The CORS the widget's request needs (WIDGETS-JSON 4.5)
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Methods", "GET, POST");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Region");
      const send = (status: number, payload: unknown) =>
        response
          .writeHead(status, { "Content-Type": "application/json" })
          .end(JSON.stringify(payload));
      if (request.method === "OPTIONS") response.writeHead(204).end();
      else if (url.pathname === "/widgets.json") send(200, ECHO_WIDGETS);
      else if (url.pathname === "/apps.json") send(200, []);
      else if (url.pathname === "/teams/search" && request.method === "POST")
        send(200, TEAMS);
      else if (
        /^\/teams\/[^/]+\/report$/.test(url.pathname) &&
        request.method === "POST"
      )
        // The widget shows what arrived
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
    server.listen(port, "127.0.0.1", () => resolve({ server, received })),
  );
}
