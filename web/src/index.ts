import { analyzeReport } from "./analysis/analyze";
import { enrichRowsWithParams } from "./params";
import {
  ApiError,
  BASE_URL,
  PAGE_SIZE,
  USER_AGENT,
  convertToRoundRows,
  fetchAllLeagueRecords,
  fetchLeagueSummary,
  validateUsername,
} from "./tetrio-api";
import { renderDocument, renderMessagePage } from "./render/document";
import type { DataRow, RoundRow } from "./analysis/types";

export interface Env {
  ASSETS: Fetcher;
}

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' https://ch.tetr.io",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
};

const PROXY_RATE_LIMIT_WINDOW_MS = 60_000;
const PROXY_RATE_LIMIT_MAX_REQUESTS = 60;
const proxyRateLimits = new Map<string, { count: number; resetAt: number }>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request: Request, env?: Env): Promise<Response> {
  return withSecurityHeaders(await routeRequest(request, env));
}

async function routeRequest(request: Request, env?: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") {
    return renderMessagePage(405, "Method Not Allowed", "GETでアクセスしてください。");
  }
  if (url.pathname === "/api/report") {
    return handleReport(url);
  }
  if (url.pathname === "/api/league-page") {
    return handleLeaguePage(url, request);
  }
  if (url.pathname === "/api/league-summary") {
    return handleLeagueSummary(url, request);
  }
  if (env?.ASSETS) {
    return env.ASSETS.fetch(request);
  }
  if (url.pathname === "/") {
    return renderMessagePage(200, "戦績レポート for TETR.IO", "静的フォームはwrangler devで配信されます。");
  }
  return renderMessagePage(404, "Not Found", "ページが見つかりません。");
}

async function handleReport(url: URL): Promise<Response> {
  try {
    const username = validateUsername(url.searchParams.get("username") ?? "");
    const maxMatches = parseMaxMatches(url.searchParams.get("max_matches"));
    const anonymize = parseAnonymize(url.searchParams.get("anonymize"));
    const sessionId = crypto.randomUUID();
    const summaryPromise = fetchLeagueSummary(username, { sessionId }).catch((error) => {
      console.warn("league summary unavailable", error);
      return null;
    });
    const result = await fetchAllLeagueRecords(username, {
      maxMatches: maxMatches === "all" ? null : maxMatches,
      sessionId,
    });
    const leagueSummary = await summaryPromise;
    if (!result.records.length) {
      return renderMessagePage(200, "対戦履歴なし", "Tetra League対戦履歴がありません。");
    }
    const rounds = convertToRoundRows(result.records, username);
    const enrichedRounds = enrichRowsWithParams(rounds as DataRow[]) as RoundRow[];
    const bundle = analyzeReport(enrichedRounds, {
      username,
      maxMatches,
      recordsCount: result.records.length,
      truncated: result.truncated,
      cachedUntil: result.cachedUntil,
      leagueSummary,
    });
    return new Response(renderDocument(bundle, { anonymize }), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return renderMessagePage(error.status, error.status === 404 ? "プレイヤーが見つかりません" : "エラー", error.message);
    }
    console.error(error);
    return renderMessagePage(500, "エラー", "予期しないエラーが発生しました。");
  }
}

async function handleLeaguePage(url: URL, request: Request): Promise<Response> {
  return handleTetrioProxy(url, request, (username) => {
    const upstream = new URL(`${BASE_URL}/users/${encodeURIComponent(username)}/records/league/recent`);
    upstream.searchParams.set("limit", String(PAGE_SIZE));
    const after = url.searchParams.get("after");
    if (after) {
      upstream.searchParams.set("after", after);
    }
    return upstream;
  }, validateLeaguePageParams);
}

async function handleLeagueSummary(url: URL, request: Request): Promise<Response> {
  return handleTetrioProxy(
    url,
    request,
    (username) => new URL(`${BASE_URL}/users/${encodeURIComponent(username)}/summaries/league`),
  );
}

async function handleTetrioProxy(
  url: URL,
  request: Request,
  upstreamFor: (username: string) => URL,
  validateParams?: (url: URL) => Response | null,
): Promise<Response> {
  const jsonError = (status: number, message: string) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: jsonHeaders(),
    });
  const rateLimit = consumeProxyRateLimit(request);
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: "rate limit exceeded" }), {
      status: 429,
      headers: jsonHeaders({ "Retry-After": String(rateLimit.retryAfterSeconds) }),
    });
  }
  let username: string;
  try {
    username = validateUsername(url.searchParams.get("username") ?? "");
  } catch (error) {
    return jsonError(400, error instanceof ApiError ? error.message : "invalid username");
  }
  if (!/^[a-z0-9_-]{1,32}$/.test(username)) {
    return jsonError(400, "ユーザー名の形式が不正です。");
  }
  const paramError = validateParams?.(url);
  if (paramError) {
    return paramError;
  }
  const sessionHeader = request.headers.get("X-Session-ID") ?? "";
  const sessionId = /^[0-9a-fA-F-]{8,64}$/.test(sessionHeader) ? sessionHeader : crypto.randomUUID();
  const upstream = upstreamFor(username);
  // CPU予算(無料枠10ms)のため body は parse せずストリームで素通しする。
  const response = await fetch(upstream.toString(), {
    headers: { "User-Agent": USER_AGENT, "X-Session-ID": sessionId },
  });
  return new Response(response.body, {
    status: response.status,
    headers: jsonHeaders(),
  });
}

function validateLeaguePageParams(url: URL): Response | null {
  const after = url.searchParams.get("after");
  if (after && !/^-?\d+(\.\d+)?:-?\d+(\.\d+)?:-?\d+(\.\d+)?$/.test(after)) {
    return new Response(JSON.stringify({ error: "afterの形式が不正です。" }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }
  return null;
}

export function __resetProxyRateLimitForTests(): void {
  proxyRateLimits.clear();
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extra,
  };
}

function consumeProxyRateLimit(request: Request): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const now = Date.now();
  const key = proxyRateLimitKey(request);
  const current = proxyRateLimits.get(key);
  if (!current || current.resetAt <= now) {
    proxyRateLimits.set(key, { count: 1, resetAt: now + PROXY_RATE_LIMIT_WINDOW_MS });
    pruneProxyRateLimits(now);
    return { allowed: true };
  }
  if (current.count >= PROXY_RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true };
}

function proxyRateLimitKey(request: Request): string {
  const ip = request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return ip || "local";
}

function pruneProxyRateLimits(now: number): void {
  if (proxyRateLimits.size < 1000) {
    return;
  }
  for (const [key, value] of proxyRateLimits.entries()) {
    if (value.resetAt <= now) {
      proxyRateLimits.delete(key);
    }
  }
}

function parseAnonymize(value: string | null): boolean {
  return value === "on" || value === "1" || value === "true";
}

function parseMaxMatches(value: string | null): number | "all" {
  if (!value || value === "") {
    return 100;
  }
  if (value === "all") {
    return "all";
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) {
    throw new ApiError(400, "max_matchesは1〜10000またはallを指定してください。");
  }
  return parsed;
}
