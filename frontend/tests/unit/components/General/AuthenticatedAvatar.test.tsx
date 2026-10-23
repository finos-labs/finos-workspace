import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Avatar, { AuthenticatedAvatar } from "~/components/General/Avatar";
import { useJsonData } from "~/lib/api";
import { type Source, useBackendConnectorStore } from "~/lib/state/backendConnector";
import { partial } from "../../mocks";

vi.mock("~/lib/api", () => ({ useJsonData: vi.fn() }));

const SOURCE = partial<Source>({
  id: "src-1",
  uuid: "src-1",
  url: "https://backend.test",
  endpointHeaders: [
    { key: "X-API-KEY", value: "backend-key", location: "headers" },
    { key: "token", value: "backend-token", location: "query" },
  ],
});

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";

const fetchState = (state: { data?: string; isError?: boolean }) =>
  vi.mocked(useJsonData).mockReturnValue({ isError: false, ...state } as never);

const requestFor = (src: string) => {
  vi.mocked(useJsonData).mockClear();
  render(<AuthenticatedAvatar src={src} alt="App" source={SOURCE} />);
  return vi.mocked(useJsonData).mock.calls.at(-1)?.[0].request;
};

const sentAs = (url: string, credentials: Record<string, string>) => ({
  ok: true,
  request: { url, method: "GET", credentials },
});

describe("AuthenticatedAvatar", () => {
  beforeEach(() => {
    fetchState({});
    useBackendConnectorStore.setState({ apiSources: [SOURCE], sourcesLoaded: true });
  });

  it("fetches an image on the backend's origin with its headers, and its query rows as params", () => {
    expect(requestFor("https://backend.test/img/logo.png")).toMatchObject(
      sentAs("https://backend.test/img/logo.png?token=backend-token", {
        "X-API-KEY": "backend-key",
      }),
    );
  });

  it("gives an image anywhere else none of them, a lookalike host included", () => {
    for (const src of [
      "https://backend.test.evil.example/logo.png",
      "https://elsewhere.test/logo.png",
    ]) {
      expect(requestFor(src)).toMatchObject(sentAs(src, {}));
    }
  });

  it("finds an image given as a path on the backend, as its thumbnails are", () => {
    for (const src of ["/thumbnails/numbers", "thumbnails/numbers"]) {
      expect(requestFor(src)).toMatchObject(
        sentAs("https://backend.test/thumbnails/numbers?token=backend-token", {
          "X-API-KEY": "backend-key",
        }),
      );
    }
  });

  it("shows an image given as base64 data as it is", () => {
    render(<AuthenticatedAvatar src={PNG} alt="App" source={SOURCE} />);

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      `data:image/png;base64,${PNG}`,
    );
  });

  it("waits for the backends' credentials before asking for an image on one", () => {
    useBackendConnectorStore.setState({ sourcesLoaded: false });

    expect(requestFor("https://backend.test/img/logo.png")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("Avatar", () => {
  const credentialed = {
    src: "https://backend.test/img/logo.png",
    alt: "App",
    headers: { "X-API-KEY": "backend-key" },
  };

  it("never shows an image that needs credentials from its bare address while it is fetched", () => {
    fetchState({});
    render(<Avatar {...credentialed} />);

    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows the image its fetch brought", () => {
    fetchState({ data: `data:image/png;base64,${PNG}` });
    render(<Avatar {...credentialed} />);

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      `data:image/png;base64,${PNG}`,
    );
  });

  it("tries the address itself when the fetch failed, as a host may not share images with pages", () => {
    fetchState({ isError: true });
    render(<Avatar {...credentialed} />);

    expect(screen.getByRole("img")).toHaveAttribute("src", credentialed.src);
  });

  it("shows a public image from its address while it is fetched", () => {
    fetchState({});
    render(<Avatar src="https://images.test/logo.png" alt="App" />);

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://images.test/logo.png",
    );
  });
});
