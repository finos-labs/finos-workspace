import { describe, it } from "node:test";
import { expect } from "expect";
import { addressesGiven, addressesIn, isGivenAddress, urlKey } from "../../../../src/agent/known-urls.ts";
import type { Message, ToolMessage } from "../../../../src/protocol/types.ts";

const human = (content: string): Message => ({ role: "human", content }) as Message;
const ai = (content: string): Message => ({ role: "ai", content }) as Message;
const toolResult = (fn: string, tool: string | undefined, text: string, input: Record<string, unknown> = {}): ToolMessage => ({
  role: "tool",
  function: fn,
  input_arguments: tool ? { tool_name: tool, ...input } : input,
  data: [{ items: [{ content: text }] }],
});
const mcp = (tool: string, text: string, input?: Record<string, unknown>) => toolResult("execute_agent_tool", tool, text, input);

const given = (messages: Message[], extra: { context?: unknown[]; urls?: string[]; pages?: string[] } = {}) =>
  addressesGiven({ messages, context: extra.context, urls: extra.urls }, extra.pages);

const SECRET_URL = "https://attacker.example/collect?d=AAPL,MSFT,my-holdings";

describe("urlKey", () => {
  it("names one address the same under its other spellings", () => {
    const key = urlKey("https://example.com/a/b?x=1");
    expect(urlKey("http://www.EXAMPLE.com/a/b?x=1")).toBe(key);
    expect(urlKey("https://example.com/a/b/?x=1")).toBe(key);
    expect(urlKey("https://example.com/a/b?x=1#section")).toBe(key);
  });

  it("tells apart addresses that differ in what they send", () => {
    const key = urlKey("https://example.com/a?x=1");
    expect(urlKey("https://example.com/a?x=2")).not.toBe(key);
    expect(urlKey("https://example.com/a?x=1&d=secret")).not.toBe(key);
    expect(urlKey("https://example.com/a/secret")).not.toBe(key);
    expect(urlKey("https://example.org/a?x=1")).not.toBe(key);
    expect(urlKey("https://example.com:8443/a?x=1")).not.toBe(key);
  });

  it("is null for what is not a web address", () => {
    expect(urlKey("not a url")).toBeNull();
    expect(urlKey("file:///etc/passwd")).toBeNull();
    expect(urlKey("javascript:alert(1)")).toBeNull();
    expect(urlKey("ftp://example.com/x")).toBeNull();
  });
});

describe("addressesIn", () => {
  const keysOf = (text: string) => {
    const keys = new Set<string>();
    addressesIn(text, keys);
    return keys;
  };

  it("finds an address in a sentence, a markdown link, brackets and quotes, without the punctuation after it", () => {
    for (const text of [
      "read https://example.com/report.",
      "read (https://example.com/report).",
      "[the report](https://example.com/report)",
      '<a href="https://example.com/report">report</a>',
      "see https://example.com/report, then",
      "**https://example.com/report**",
    ]) {
      expect(keysOf(text).has(urlKey("https://example.com/report")!)).toBe(true);
    }
  });

  it("keeps an address with brackets in it", () => {
    const keys = keysOf("https://en.wikipedia.org/wiki/Foo_(bar)");
    expect(keys.has(urlKey("https://en.wikipedia.org/wiki/Foo_(bar)")!)).toBe(true);
  });

  it("finds an address written without its scheme", () => {
    const keys = keysOf("go and check example.com/markets today, and sec.gov");
    expect(keys.has(urlKey("https://example.com/markets")!)).toBe(true);
    expect(keys.has(urlKey("https://sec.gov")!)).toBe(true);
  });

  it("does not make the address of one that was only started", () => {
    const keys = keysOf(`${SECRET_URL.slice(0, 30)}`);
    expect(keys.has(urlKey(SECRET_URL)!)).toBe(false);
  });

  it("reads hostile text in bounded time and keeps the set bounded", () => {
    const hostile = [
      "https://".repeat(200_000),
      `https://a.example/${"x".repeat(2_000_000)}`,
      `${"a-".repeat(500_000)}.com`,
      `https://a.example/x${".".repeat(1_000_000)}`,
      Array.from({ length: 100_000 }, (_, i) => `https://h${i}.example/p`).join(" "),
    ];
    for (const text of hostile) {
      const keys = new Set<string>();
      const start = performance.now();
      addressesIn(text, keys);
      expect(performance.now() - start).toBeLessThan(3000);
      expect(keys.size).toBeLessThanOrEqual(20_000);
    }
  });
});

describe("addressesGiven", () => {
  it("gives what the user wrote, what they attached and the addresses of the request", () => {
    const set = given([human("compare https://a.example/one with b.example/two")], {
      context: [{ text: "my notes: https://c.example/three" }],
      urls: ["https://d.example/four"],
      pages: ["# page\nlinks to https://e.example/five"],
    });
    for (const url of ["https://a.example/one", "https://b.example/two", "https://c.example/three", "https://d.example/four", "https://e.example/five"]) {
      expect(isGivenAddress(url, set)).toBe(true);
    }
  });

  it("gives what a search, a page, a widget and a document returned", () => {
    const set = given([
      human("research this"),
      mcp("web_search", "Result\nhttps://news.example/story\nsnippet"),
      mcp("fetch_webpage", "see [filing](https://sec.example/filing/123)"),
      mcp("inspect_webpage", "Links 1–1 of 1:\n[1] Annual report — https://ir.example/report.pdf"),
      mcp("query_documents", "### Hit 1\nthe appendix is at https://docs.example/appendix"),
      toolResult("get_widget_data", undefined, "link: https://widget.example/row/9"),
    ]);
    for (const url of ["https://news.example/story", "https://sec.example/filing/123", "https://ir.example/report.pdf", "https://docs.example/appendix", "https://widget.example/row/9"]) {
      expect(isGivenAddress(url, set)).toBe(true);
    }
  });

  it("knows a tool by its name with the server in front, as the Workspace may call it", () => {
    const set = given([human("hi"), mcp("Ines Tools_web_search", "https://news.example/story"), mcp("Ines Tools_mermaid_diagram", SECRET_URL), mcp("Ines Tools_not_web_search_at_all", SECRET_URL)]);
    expect(isGivenAddress("https://news.example/story", set)).toBe(true);
    expect(isGivenAddress(SECRET_URL, set)).toBe(false);
  });

  it("does not give what the model wrote, nor what a tool that computes or repeats returned", () => {
    const set = given([
      human("hello"),
      ai(`Here you go: ${SECRET_URL}`),
      mcp("mermaid_diagram", SECRET_URL),
      toolResult("update_widget_in_dashboard", undefined, SECRET_URL),
      toolResult("get_params_options", undefined, "ok", { query: SECRET_URL }),
    ]);
    expect(isGivenAddress(SECRET_URL, set)).toBe(false);
  });

  it("does not give what the model asked a reading tool, only what the tool answered", () => {
    const set = given([
      human("hi"),
      mcp("web_search", "No results found.", { query: SECRET_URL }),
      mcp("fetch_webpage", "Failed", { url: SECRET_URL }),
      mcp("inspect_webpage", "Nothing in the text contains that.", { view: "find", query: SECRET_URL, selector: SECRET_URL, path: SECRET_URL }),
    ]);
    expect(isGivenAddress(SECRET_URL, set)).toBe(false);
  });

  it("does not give an address with the user's data added to one that was given", () => {
    const set = given([human("read https://example.com/page")]);
    expect(isGivenAddress("https://example.com/page", set)).toBe(true);
    expect(isGivenAddress("https://example.com/page?d=AAPL,MSFT", set)).toBe(false);
    expect(isGivenAddress("https://example.com/page/AAPL", set)).toBe(false);
    expect(isGivenAddress("https://example.com.attacker.example/page", set)).toBe(false);
    expect(isGivenAddress("https://attacker.example/?u=https://example.com/page", set)).toBe(false);
  });

  it("reads a request made of a great deal of text in bounded time, the newest first, and gives nothing from what it did not reach", () => {
    const filler = "word ".repeat(20_000);
    const messages: Message[] = [human("the old one: https://old.example/first"), ...Array.from({ length: 2000 }, () => human(filler)), human("the new one: https://new.example/last")];
    const start = performance.now();
    const set = given(messages);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(isGivenAddress("https://new.example/last", set)).toBe(true);
    expect(isGivenAddress("https://old.example/first", set)).toBe(false);
  });

  it("reads what is in data of any shape, to a bounded depth", () => {
    const deep = (n: number): unknown => (n === 0 ? "https://deep.example/x" : { a: [deep(n - 1)] });
    const message: ToolMessage = { role: "tool", function: "get_widget_data", input_arguments: {}, data: deep(3) as ToolMessage["data"] };
    expect(isGivenAddress("https://deep.example/x", given([message as Message]))).toBe(true);
    const tooDeep: ToolMessage = { ...message, data: deep(200) as ToolMessage["data"] };
    expect(isGivenAddress("https://deep.example/x", given([tooDeep as Message]))).toBe(false);
  });
});
