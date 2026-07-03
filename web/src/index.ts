import { analyzeReport } from "./analysis/analyze";
import { enrichRowsWithParams } from "./params";
import {
  ApiError,
  BASE_URL,
  PAGE_SIZE,
  USER_AGENT,
  convertToRoundRows,
  fetchAllLeagueRecords,
  validateUsername,
} from "./tetrio-api";
import { renderDocument, renderMessagePage } from "./render/document";
import type { DataRow, RoundRow } from "./analysis/types";

export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request: Request, env?: Env): Promise<Response> {
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
    const result = await fetchAllLeagueRecords(username, {
      maxMatches: maxMatches === "all" ? null : maxMatches,
    });
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
  const jsonError = (status: number, message: string) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  let username: string;
  try {
    username = validateUsername(url.searchParams.get("username") ?? "");
  } catch (error) {
    return jsonError(400, error instanceof ApiError ? error.message : "invalid username");
  }
  if (!/^[a-z0-9_-]{1,32}$/.test(username)) {
    return jsonError(400, "ユーザー名の形式が不正です。");
  }
  const after = url.searchParams.get("after");
  if (after && !/^-?\d+(\.\d+)?:-?\d+(\.\d+)?:-?\d+(\.\d+)?$/.test(after)) {
    return jsonError(400, "afterの形式が不正です。");
  }
  const sessionHeader = request.headers.get("X-Session-ID") ?? "";
  const sessionId = /^[0-9a-fA-F-]{8,64}$/.test(sessionHeader) ? sessionHeader : crypto.randomUUID();
  const upstream = new URL(`${BASE_URL}/users/${encodeURIComponent(username)}/records/league/recent`);
  upstream.searchParams.set("limit", String(PAGE_SIZE));
  if (after) {
    upstream.searchParams.set("after", after);
  }
  // CPU予算(無料枠10ms)のため body は parse せずストリームで素通しする。
  const response = await fetch(upstream.toString(), {
    headers: { "User-Agent": USER_AGENT, "X-Session-ID": sessionId },
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
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
