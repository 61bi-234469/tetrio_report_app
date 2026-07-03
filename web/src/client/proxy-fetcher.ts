export function createProxyFetcher(baseFetch: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const source = new URL(String(input));
    // /users/{username}/records/league/recent → /api/league-page
    const match = source.pathname.match(/^\/api\/users\/([^/]+)\/records\/league\/recent$/);
    if (!match) {
      throw new Error(`unexpected TETR.IO API path: ${source.pathname}`);
    }
    const proxied = new URL("/api/league-page", globalThis.location?.href ?? "http://localhost/");
    proxied.searchParams.set("username", decodeURIComponent(match[1]!));
    const after = source.searchParams.get("after");
    if (after) {
      proxied.searchParams.set("after", after);
    }
    const headers = new Headers(init?.headers);
    const sessionId = headers.get("X-Session-ID");
    return baseFetch(proxied.toString(), {
      headers: sessionId ? { "X-Session-ID": sessionId } : {},
    });
  }) as typeof fetch;
}
