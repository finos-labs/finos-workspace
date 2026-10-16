import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { configureFetchPolicy, fetchClientUrl, isBlockedAddress } from "../../../../src/lib/safe-fetch";
import { TEST_FETCH_POLICY } from "../../../setup";
import { logicalUrl } from "../../../helpers/logical-url";

const realFetch = globalThis.fetch;
const PUBLIC_IP = "93.184.216.34";

/** What the stub network answers, by URL; everything fetched is recorded. */
function network(routes: Record<string, () => Response>) {
  const fetched: string[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = logicalUrl(input, init);
    fetched.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch of ${url}`);
    return route();
  }) as unknown as typeof fetch;
  return fetched;
}

beforeEach(() => {
  configureFetchPolicy({ resolve: async () => [PUBLIC_IP] });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  configureFetchPolicy(TEST_FETCH_POLICY);
});

describe("isBlockedAddress", () => {
  it("blocks loopback, private, link-local, shared and reserved addresses", () => {
    for (const address of [
      "127.0.0.1",
      "127.255.255.254",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "::ffff:10.0.0.1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
  });

  it("lets public addresses through", () => {
    for (const address of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "172.15.255.255", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(address)).toBe(false);
    }
  });

  it("blocks what is not an address", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});

describe("fetchClientUrl — what it refuses", () => {
  it("refuses anything but http and https", async () => {
    const fetched = network({});
    for (const url of ["file:///etc/passwd", "ftp://example.org/x", "gopher://example.org/", "data:text/plain,hi"]) {
      await expect(fetchClientUrl(url)).rejects.toThrow("only http and https");
    }
    expect(fetched).toHaveLength(0);
  });

  it("refuses internal names and private addresses without asking DNS", async () => {
    let asked = 0;
    configureFetchPolicy({
      resolve: async () => {
        asked++;
        return [PUBLIC_IP];
      },
    });
    const fetched = network({});
    for (const url of [
      "http://localhost:8000/health",
      "http://api:8000/app/user",
      "http://mysql:3306/",
      "http://redis/",
      "http://service.internal/",
      "http://printer.local/",
      "http://127.0.0.1:8000/",
      "http://10.1.2.3/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]:8000/",
      "http://[fd00::1]/",
    ]) {
      await expect(fetchClientUrl(url)).rejects.toThrow("Refusing to fetch");
    }
    expect(asked).toBe(0);
    expect(fetched).toHaveLength(0);
  });

  it("refuses a public-looking name that resolves to a private address, or to one among several", async () => {
    const fetched = network({});
    configureFetchPolicy({ resolve: async () => ["10.0.0.5"] });
    await expect(fetchClientUrl("http://looks-public.example.org/")).rejects.toThrow("does not resolve to a public address");
    configureFetchPolicy({ resolve: async () => [PUBLIC_IP, "169.254.169.254"] });
    await expect(fetchClientUrl("http://mixed.example.org/")).rejects.toThrow("does not resolve to a public address");
    configureFetchPolicy({ resolve: async () => [] });
    await expect(fetchClientUrl("http://nothing.example.org/")).rejects.toThrow("does not resolve to a public address");
    expect(fetched).toHaveLength(0);
  });

  it("says when a name cannot be looked up", async () => {
    configureFetchPolicy({
      resolve: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    await expect(fetchClientUrl("http://nowhere.example.org/")).rejects.toThrow("Could not look up");
  });

  it("does not put a signature in the message", async () => {
    let message = "";
    try {
      await fetchClientUrl("http://127.0.0.1/file.pdf?Signature=topsecret&Expires=1");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("http://127.0.0.1/file.pdf");
    expect(message).not.toContain("topsecret");
  });

  it("refuses text that is not a URL", async () => {
    await expect(fetchClientUrl("not a url")).rejects.toThrow("Not a URL");
  });
});

describe("fetchClientUrl — what it fetches", () => {
  it("fetches a public page and returns its response", async () => {
    const fetched = network({ "https://docs.example.org/a.csv": () => new Response("a,b\n1,2\n") });
    const res = await fetchClientUrl("https://docs.example.org/a.csv");
    expect(await res.text()).toBe("a,b\n1,2\n");
    expect(fetched).toEqual(["https://docs.example.org/a.csv"]);
  });

  it("follows a redirect to another public page", async () => {
    const fetched = network({
      "https://short.example.org/x": () => new Response(null, { status: 302, headers: { location: "https://docs.example.org/real" } }),
      "https://docs.example.org/real": () => new Response("the page"),
    });
    const res = await fetchClientUrl("https://short.example.org/x");
    expect(await res.text()).toBe("the page");
    expect(fetched).toHaveLength(2);
  });

  it("does not follow a redirect to an internal address", async () => {
    const fetched = network({
      "https://evil.example.org/x": () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
    });
    await expect(fetchClientUrl("https://evil.example.org/x")).rejects.toThrow("Refusing to fetch");
    expect(fetched).toEqual(["https://evil.example.org/x"]);
  });

  it("does not follow redirects for ever", async () => {
    network({ "https://loop.example.org/x": () => new Response(null, { status: 302, headers: { location: "https://loop.example.org/x" } }) });
    await expect(fetchClientUrl("https://loop.example.org/x")).rejects.toThrow("Too many redirects");
  });

  it("passes the request options on (the timeout signal)", async () => {
    let signal: AbortSignal | null | undefined;
    globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal;
      return new Response("ok");
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    await fetchClientUrl("https://docs.example.org/a", { signal: controller.signal });
    expect(signal?.aborted).toBe(false);
    // The caller's signal still stops the request.
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it("gives every request a time limit of its own when the caller sets none", async () => {
    let signal: AbortSignal | null | undefined;
    globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal;
      return new Response("ok");
    }) as unknown as typeof fetch;
    await fetchClientUrl("https://docs.example.org/a");
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });
});

describe("fetchClientUrl — the Workspace's own files", () => {
  beforeEach(() => {
    configureFetchPolicy({
      resolve: async () => [PUBLIC_IP],
      workspace: { publicUrl: "http://localhost:8000", internalUrl: "http://api:8000" },
    });
  });

  it("fetches a file link on the address the browser uses from the address of the API in the deployment", async () => {
    const fetched = network({
      "http://api:8000/app/files/presigned/abc.pdf?Expires=1&Signature=s": () => new Response("%PDF"),
    });
    const res = await fetchClientUrl("http://localhost:8000/app/files/presigned/abc.pdf?Expires=1&Signature=s");
    expect(await res.text()).toBe("%PDF");
    expect(fetched).toEqual(["http://api:8000/app/files/presigned/abc.pdf?Expires=1&Signature=s"]);
  });

  it("is only for files: no other path of the API is reachable that way", async () => {
    const fetched = network({});
    for (const url of ["http://localhost:8000/app/user", "http://localhost:8000/admin/role", "http://localhost:8000/"]) {
      await expect(fetchClientUrl(url)).rejects.toThrow("Refusing to fetch");
    }
    expect(fetched).toHaveLength(0);
  });

  it("is only for the Workspace's address: the API's own address in a request is not a way in", async () => {
    const fetched = network({});
    await expect(fetchClientUrl("http://api:8000/app/files/presigned/abc.pdf")).rejects.toThrow("Refusing to fetch");
    await expect(fetchClientUrl("http://localhost:9999/app/files/presigned/abc.pdf")).rejects.toThrow("Refusing to fetch");
    expect(fetched).toHaveLength(0);
  });

  it("fetches them with the Workspace's origin when one is configured, and nothing else", async () => {
    configureFetchPolicy({
      resolve: async () => [PUBLIC_IP],
      workspace: { publicUrl: "http://localhost:8000", internalUrl: "http://api:8000", origin: "http://localhost:3000" },
    });
    const origins: Record<string, string | null> = {};
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = logicalUrl(input, init);
      origins[url] = new Headers(init?.headers).get("origin");
      return url.startsWith("http://api:8000/")
        ? new Response(null, { status: 302, headers: { location: "https://files.example.org/abc.pdf" } })
        : new Response("%PDF");
    }) as unknown as typeof fetch;
    await fetchClientUrl("http://localhost:8000/app/files/presigned/abc.pdf");
    await fetchClientUrl("https://docs.example.org/a");
    expect(origins).toEqual({
      "http://api:8000/app/files/presigned/abc.pdf": "http://localhost:3000",
      "https://files.example.org/abc.pdf": null,
      "https://docs.example.org/a": null,
    });
  });

  it("does not stay trusted through a redirect", async () => {
    const fetched = network({
      "http://api:8000/app/files/presigned/abc.pdf": () => new Response(null, { status: 302, headers: { location: "http://api:8000/app/user" } }),
    });
    await expect(fetchClientUrl("http://localhost:8000/app/files/presigned/abc.pdf")).rejects.toThrow("Refusing to fetch");
    expect(fetched).toHaveLength(1);
  });
});

describe("fetchClientUrl — size", () => {
  it("refuses a response that says it is too large, without reading it", async () => {
    network({ "https://big.example.org/f": () => new Response("x", { headers: { "content-length": String(10 * 1024 * 1024) } }) });
    await expect(fetchClientUrl("https://big.example.org/f", { maxBytes: 1024 * 1024 })).rejects.toThrow("larger than");
  });

  it("stops reading a response that grows past the limit", async () => {
    const chunk = new Uint8Array(512 * 1024);
    network({
      "https://stream.example.org/f": () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < 8; i++) controller.enqueue(chunk);
              controller.close();
            },
          }),
        ),
    });
    const res = await fetchClientUrl("https://stream.example.org/f", { maxBytes: 1024 * 1024 });
    await expect(res.arrayBuffer()).rejects.toThrow("larger than");
  });

  it("returns a response within the limit whole", async () => {
    network({ "https://small.example.org/f": () => new Response("small") });
    const res = await fetchClientUrl("https://small.example.org/f", { maxBytes: 1024 });
    expect(await res.text()).toBe("small");
  });
});

describe("fetchClientUrl — the address that was checked is the address that is connected to", () => {
  it("connects to the address it looked up, as the name it was asked for, and checks the certificate for the name", async () => {
    let seen: { url: string; host: string | null; serverName?: string } | null = null;
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit & { tls?: { serverName?: string } }) => {
      seen = { url: String(input), host: new Headers(init?.headers).get("host"), serverName: init?.tls?.serverName };
      return new Response("ok");
    }) as unknown as typeof fetch;
    await fetchClientUrl("https://docs.example.org/a.csv?x=1");
    expect(seen as unknown).toEqual({ url: `https://${PUBLIC_IP}/a.csv?x=1`, host: "docs.example.org", serverName: "docs.example.org" });
  });

  it("is not fooled by a name that answers with a public address to the check and an internal one to the connection (DNS rebinding)", async () => {
    let lookups = 0;
    configureFetchPolicy({ resolve: async () => (++lookups === 1 ? [PUBLIC_IP] : ["169.254.169.254"]) });
    const connectedTo: string[] = [];
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      connectedTo.push(new URL(String(input)).hostname);
      return new Response("ok");
    }) as unknown as typeof fetch;
    await fetchClientUrl("https://rebind.example.org/");
    // Looked up once, and connected to what was checked: the second answer was never asked for.
    expect(lookups).toBe(1);
    expect(connectedTo).toEqual([PUBLIC_IP]);
  });

  it("looks a name up again at every redirect, and connects to the address checked for that one", async () => {
    const answers: Record<string, string> = { "a.example.org": "93.184.216.34", "b.example.org": "93.184.216.35" };
    configureFetchPolicy({ resolve: async (name) => [answers[name]] });
    const connected: string[] = [];
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const host = new URL(String(input)).hostname;
      connected.push(host);
      return host === "93.184.216.34" ? new Response(null, { status: 302, headers: { location: "https://b.example.org/next" } }) : new Response("done");
    }) as unknown as typeof fetch;
    expect(await (await fetchClientUrl("https://a.example.org/")).text()).toBe("done");
    expect(connected).toEqual(["93.184.216.34", "93.184.216.35"]);
  });

  it("tries the next address of a name when it cannot connect to the first", async () => {
    configureFetchPolicy({ resolve: async () => ["93.184.216.34", "93.184.216.35"] });
    const tried: string[] = [];
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const host = new URL(String(input)).hostname;
      tried.push(host);
      if (host === "93.184.216.34") throw new Error("connection refused");
      return new Response("ok");
    }) as unknown as typeof fetch;
    expect(await (await fetchClientUrl("https://two.example.org/")).text()).toBe("ok");
    expect(tried).toEqual(["93.184.216.34", "93.184.216.35"]);
  });

  it("brackets an IPv6 address", async () => {
    configureFetchPolicy({ resolve: async () => ["2606:2800:220:1:248:1893:25c8:1946"] });
    let url = "";
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      url = String(input);
      return new Response("ok");
    }) as unknown as typeof fetch;
    await fetchClientUrl("http://v6.example.org:8080/p");
    expect(url).toBe("http://[2606:2800:220:1:248:1893:25c8:1946]:8080/p");
  });

  it("does not pin an address it was given as an address", async () => {
    let seen: { url: string; host: string | null } | null = null;
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(input), host: new Headers(init?.headers).get("host") };
      return new Response("ok");
    }) as unknown as typeof fetch;
    await fetchClientUrl("http://93.184.216.34/x");
    expect(seen as unknown).toEqual({ url: "http://93.184.216.34/x", host: null });
  });

  it("fails when every address fails, with the last error", async () => {
    configureFetchPolicy({ resolve: async () => ["93.184.216.34", "93.184.216.35"] });
    globalThis.fetch = mock(async () => {
      throw new Error("nobody answers");
    }) as unknown as typeof fetch;
    await expect(fetchClientUrl("https://dead.example.org/")).rejects.toThrow("nobody answers");
  });
});
