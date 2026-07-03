import { afterEach, describe, expect, it, vi } from "vitest";
import { USER_AGENT } from "../src/tetrio-api";
import { __resetProxyRateLimitForTests, handleRequest } from "../src/index";

describe("league-page proxy", () => {
  afterEach(() => {
    __resetProxyRateLimitForTests();
    vi.unstubAllGlobals();
  });

  it("streams the upstream response through without parsing it", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://ch.tetr.io/api/users/player/records/league/recent?limit=100");
      const headers = new Headers(init?.headers);
      expect(headers.get("User-Agent")).toBe(USER_AGENT);
      expect(headers.get("X-Session-ID")).toBe("11111111-1111-1111-1111-111111111111");
      return new Response(JSON.stringify({ ok: 1 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRequest(
      new Request("http://worker.test/api/league-page?username=player", {
        headers: { "X-Session-ID": "11111111-1111-1111-1111-111111111111" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(JSON.stringify({ ok: 1 }));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forwards a valid after cursor to upstream", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://ch.tetr.io/api/users/player/records/league/recent?limit=100&after=1%3A2%3A3");
      return new Response(JSON.stringify({ ok: 1 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRequest(
      new Request("http://worker.test/api/league-page?username=player&after=1:2:3"),
    );

    expect(response.status).toBe(200);
  });

  it.each(["your_username", "", "a b!"])("rejects invalid username %j", async (username) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRequest(
      new Request(`http://worker.test/api/league-page?username=${encodeURIComponent(username)}`),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid after cursor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRequest(
      new Request("http://worker.test/api/league-page?username=player&after=abc"),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes through upstream 429 without retrying", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRequest(new Request("http://worker.test/api/league-page?username=player"));

    expect(response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rate limits repeated proxy requests by client address", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 })));
    vi.stubGlobal("fetch", fetchMock);

    for (let i = 0; i < 60; i += 1) {
      const response = await handleRequest(
        new Request("http://worker.test/api/league-page?username=player", {
          headers: { "CF-Connecting-IP": "203.0.113.10" },
        }),
      );
      expect(response.status).toBe(200);
    }

    const limited = await handleRequest(
      new Request("http://worker.test/api/league-page?username=player", {
        headers: { "CF-Connecting-IP": "203.0.113.10" },
      }),
    );

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(60);
  });

  it("replaces an invalid X-Session-ID with a generated UUID", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const sessionId = headers.get("X-Session-ID");
      expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
      return new Response(JSON.stringify({ ok: 1 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRequest(
      new Request("http://worker.test/api/league-page?username=player", {
        headers: { "X-Session-ID": "<script>" },
      }),
    );

    expect(response.status).toBe(200);
  });
});
