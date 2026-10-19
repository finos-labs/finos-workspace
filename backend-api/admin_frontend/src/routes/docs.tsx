import React, { useEffect, useRef } from "react";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import { type AuthStore, useAuthStore } from "utils/auth";

interface ForSwagger {
  Authorization: string;
}

type SwaggerRequest = Record<string, ForSwagger>;

export default function Docs(): JSX.Element {
  const user = useAuthStore((state: AuthStore) => state.user);
  const token = user === null ? "" : user.accessToken;
  const requestInterceptor = (
    req: SwaggerRequest,
  ): SwaggerRequest | Promise<SwaggerRequest> => ({
    ...req,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const url = `${import.meta.env.VITE_API_URL}/openapi.json`;
  const swaggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = swaggerRef.current;
    if (!root) return;
    // Swagger renders its own <main>, which would nest inside the page main.
    // Move its children into a div so listeners on those children stay put.
    const demoteNestedMain = (): void => {
      root.querySelectorAll("main").forEach((element) => {
        const replacement = document.createElement("div");
        for (const attribute of element.attributes) {
          replacement.setAttribute(attribute.name, attribute.value);
        }
        while (element.firstChild) replacement.appendChild(element.firstChild);
        element.replaceWith(replacement);
      });
      root.querySelectorAll("h1.title").forEach((heading) => {
        const h2 = document.createElement("h2");
        for (const attribute of heading.attributes) {
          h2.setAttribute(attribute.name, attribute.value);
        }
        while (heading.firstChild) h2.appendChild(heading.firstChild);
        heading.replaceWith(h2);
      });
    };
    demoteNestedMain();
    const observer = new MutationObserver(demoteNestedMain);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="ws-card overflow-hidden">
      <div className="ws-card-header">
        <h1 className="ws-admin-title">API Documentation</h1>
      </div>
      <div ref={swaggerRef} className="ws-docs-swagger ws-card-content">
        <SwaggerUI url={url} requestInterceptor={requestInterceptor} />
      </div>
    </div>
  );
}
