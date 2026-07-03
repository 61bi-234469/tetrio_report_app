import { describe, expect, it, vi } from "vitest";
import { createProxyFetcher } from "../src/client/proxy-fetcher";

describe("createProxyFetcher", () => {
  it("rewrites the ch.tetr.io league URL to the same-origin proxy endpoint", async () => {
    const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}"));
    const fetcher = createProxyFetcher(mock as unknown as typeof fetch);

    await fetcher("https://ch.tetr.io/api/users/foo/records/league/recent?limit=100&after=1:2:3");

    expect(mock).toHaveBeenCalledTimes(1);
    const [calledUrl] = mock.mock.calls[0]!;
    expect(String(calledUrl)).toContain("/api/league-page?username=foo&after=1%3A2%3A3");
  });

  it("forwards X-Session-ID but never forwards User-Agent", async () => {
    const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}"));
    const fetcher = createProxyFetcher(mock as unknown as typeof fetch);

    await fetcher("https://ch.tetr.io/api/users/foo/records/league/recent?limit=100", {
      headers: { "X-Session-ID": "session-1", "User-Agent": "should-not-forward" },
    });

    const [, init] = mock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Session-ID")).toBe("session-1");
    expect(headers.get("User-Agent")).toBeNull();
  });

  it("throws for unexpected TETR.IO API paths", async () => {
    const mock = vi.fn(async () => new Response("{}"));
    const fetcher = createProxyFetcher(mock as unknown as typeof fetch);

    await expect(fetcher("https://ch.tetr.io/api/users/foo")).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });
});
