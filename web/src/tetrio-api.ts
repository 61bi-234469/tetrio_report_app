import type { DataRow, MatchRow, RoundRow } from "./analysis/types";
import {
  cell,
  firstNested,
  isoToJst,
  jsonCell,
  metricDelta,
  nested,
  normalizeCacheEpoch,
  prefixed,
} from "./utils";

export const BASE_URL = "https://ch.tetr.io/api";
export const PAGE_SIZE = 100;
export const USERNAME_PLACEHOLDER = "your_username";
export const USER_AGENT =
  "tetrio-report-app/1.0 (+https://github.com/61bi-234469/tetrio_report_app) league-report-web/1.0";
export const API_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
export const API_MAX_RETRIES = 4;
export const API_BACKOFF_SECONDS = 2.0;
export const FREE_PLAN_SUBREQUEST_LIMIT = 50;
export const FREE_PLAN_PAGE_LIMIT = Math.floor(FREE_PLAN_SUBREQUEST_LIMIT / (API_MAX_RETRIES + 1));

type FetchLike = typeof fetch;

export interface FetchLeagueOptions {
  fetcher?: FetchLike;
  maxMatches?: number | null;
  maxPages?: number;
  pageDelayMs?: number;
  sessionId?: string;
  onPage?: (info: { pageCount: number; records: number }) => void;
}

export interface FetchLeagueResult {
  records: Record<string, unknown>[];
  cachedUntil: number | null;
  pageCount: number;
  truncated: boolean;
}

export interface FetchLeagueSummaryOptions {
  fetcher?: FetchLike;
  sessionId?: string;
}

export interface LeagueSummaryResult {
  raw: {
    apm: number | null;
    pps: number | null;
    vs: number | null;
    tr: number | null;
    glicko: number | null;
    rd: number | null;
    gameswon: number | null;
    gamesplayed: number | null;
    rank: string | null;
  };
  cachedUntil: number | null;
}

const STAT_FIELDS: Record<string, Array<string | string[]>> = {
  apm: ["apm"],
  pps: ["pps"],
  vs: ["vsscore"],
  pieces: ["pieceplaced"],
  inputs: ["inputs"],
  lines: ["lines"],
  attack: ["attack", ["garbage", "attack"]],
  garbage_sent: ["garbagesent", ["garbage", "sent"]],
  garbage_received: ["garbagereceived", ["garbage", "received"]],
  garbage_cleared: ["garbagecleared", ["garbage", "cleared"]],
  singles: ["singles", ["clears", "singles"]],
  doubles: ["doubles", ["clears", "doubles"]],
  triples: ["triples", ["clears", "triples"]],
  quads: ["quads", ["clears", "quads"]],
  tspins: ["realtspins", ["clears", "realtspins"]],
  mini_tspins: ["minitspins", ["clears", "minitspins"]],
  kills: ["kills"],
  altitude: ["altitude"],
  rank: ["rank"],
  targeting_factor: ["targetingfactor"],
  targeting_grace: ["targetinggrace"],
  btb: ["btb"],
  revives: ["revives"],
  blockrationing_app: ["blockrationing_app"],
  blockrationing_final: ["blockrationing_final"],
  escape_artist: ["escapeartist"],
};

export function validateUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!normalized || normalized === USERNAME_PLACEHOLDER) {
    throw new ApiError(400, "TETR.IOユーザー名を入力してください。");
  }
  return normalized;
}

export async function requestTetrioApi(
  url: string,
  params: Record<string, string | number>,
  sessionId: string,
  fetcher: FetchLike = fetch,
): Promise<Response> {
  const requestUrl = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    requestUrl.searchParams.set(key, String(value));
  }

  for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt += 1) {
    const response = await fetcher(requestUrl.toString(), {
      headers: {
        "X-Session-ID": sessionId,
        "User-Agent": USER_AGENT,
      },
    });
    if (!API_RETRY_STATUSES.has(response.status)) {
      if (!response.ok) {
        throw new ApiError(response.status === 404 ? 404 : 502, `TETR.IO API error: HTTP ${response.status}`);
      }
      return response;
    }
    if (attempt >= API_MAX_RETRIES) {
      throw new ApiError(502, "TETR.IO側が混雑しています。時間をおいて再試行してください。");
    }
    const retryAfter = Number(response.headers.get("Retry-After"));
    const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter
      : API_BACKOFF_SECONDS * 2 ** attempt;
    await sleep(waitSeconds * 1000);
  }

  throw new ApiError(502, "TETR.IO API retry loop ended unexpectedly");
}

export async function fetchAllLeagueRecords(
  usernameInput: string,
  options: FetchLeagueOptions = {},
): Promise<FetchLeagueResult> {
  const username = validateUsername(usernameInput);
  const fetcher = options.fetcher ?? fetch;
  const maxMatches = options.maxMatches ?? null;
  const maxPages = options.maxPages ?? FREE_PLAN_PAGE_LIMIT;
  const pageDelayMs = options.pageDelayMs ?? 1050;
  const sessionId = options.sessionId ?? crypto.randomUUID();

  const records: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();
  const seenAfter = new Set<string>();
  const cachedUntilValues: number[] = [];
  let after: string | null = null;
  let pageCount = 0;
  let truncated = false;

  while (true) {
    if (pageCount >= maxPages) {
      truncated = true;
      break;
    }

    const params: Record<string, string | number> = { limit: PAGE_SIZE };
    if (after) {
      params.after = after;
    }
    const url = `${BASE_URL}/users/${encodeURIComponent(username)}/records/league/recent`;
    const response = await requestTetrioApi(url, params, sessionId, fetcher);
    pageCount += 1;
    const payload = await response.json() as Record<string, unknown>;
    const cachedUntil = normalizeCacheEpoch(nested(payload, "cache", "cached_until"));
    if (cachedUntil !== null) {
      cachedUntilValues.push(cachedUntil);
    }

    if (!payload.success) {
      const message = nested(payload, "error", "msg") ?? nested(payload, "error", "message");
      throw new ApiError(404, String(message || "プレイヤーが見つかりません。"));
    }

    const entries = nested(payload, "data", "entries");
    if (!Array.isArray(entries) || entries.length === 0) {
      break;
    }

    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const recordId = String(record._id ?? "");
      if (recordId && seenIds.has(recordId)) {
        continue;
      }
      if (recordId) {
        seenIds.add(recordId);
      }
      records.push(record);
      if (maxMatches !== null && records.length >= maxMatches) {
        records.length = maxMatches;
        options.onPage?.({ pageCount, records: records.length });
        return {
          records,
          cachedUntil: cachedUntilValues.length ? Math.min(...cachedUntilValues) : null,
          pageCount,
          truncated,
        };
      }
    }

    options.onPage?.({ pageCount, records: records.length });

    if (entries.length < PAGE_SIZE) {
      break;
    }
    const nextAfter = prisecterString(entries[entries.length - 1]);
    if (!nextAfter || seenAfter.has(nextAfter)) {
      break;
    }
    seenAfter.add(nextAfter);
    after = nextAfter;
    await sleep(pageDelayMs);
  }

  return {
    records,
    cachedUntil: cachedUntilValues.length ? Math.min(...cachedUntilValues) : null,
    pageCount,
    truncated,
  };
}

export async function fetchLeagueSummary(
  usernameInput: string,
  options: FetchLeagueSummaryOptions = {},
): Promise<LeagueSummaryResult> {
  const username = validateUsername(usernameInput);
  const fetcher = options.fetcher ?? fetch;
  const sessionId = options.sessionId ?? crypto.randomUUID();
  const response = await requestTetrioApi(
    `${BASE_URL}/users/${encodeURIComponent(username)}/summaries/league`,
    {},
    sessionId,
    fetcher,
  );
  const payload = await response.json() as Record<string, unknown>;
  const cachedUntil = normalizeCacheEpoch(nested(payload, "cache", "cached_until"));

  if (!payload.success) {
    const message = nested(payload, "error", "msg") ?? nested(payload, "error", "message");
    throw new ApiError(404, String(message || "プレイヤーが見つかりません。"));
  }

  const data = isObject(payload.data) ? payload.data : {};
  return {
    raw: {
      apm: numberOrNull(data.apm),
      pps: numberOrNull(data.pps),
      vs: numberOrNull(data.vs ?? data.vsscore),
      tr: numberOrNull(data.tr),
      glicko: numberOrNull(data.glicko),
      rd: numberOrNull(data.rd),
      gameswon: numberOrNull(data.gameswon),
      gamesplayed: numberOrNull(data.gamesplayed),
      rank: data.rank === undefined || data.rank === null ? null : String(data.rank),
    },
    cachedUntil,
  };
}

export function convertToMatchRows(recordsInput: Record<string, unknown>[], username: string): MatchRow[] {
  const records = [...recordsInput].sort((a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")));
  const targetPlayerId = inferTargetPlayerId(records, username);
  const rows: MatchRow[] = [];

  records.forEach((record, index) => {
    const context = playerContext(record, username, targetPlayerId);
    if (!context) {
      return;
    }
    const row: DataRow = baseMatchFields(record, index + 1, context);
    Object.assign(row, flattenProfile(context.targetProfile, "target_"));
    Object.assign(row, flattenProfile(context.opponentProfile, "opponent_"));
    Object.assign(row, flattenPlayerMetadata(context.target, "target_leaderboard_"));
    Object.assign(row, flattenPlayerMetadata(context.opponent, "opponent_leaderboard_"));
    row.target_leaderboard_wins = cell(context.target.wins);
    row.opponent_leaderboard_wins = cell(context.opponent?.wins);
    Object.assign(row, prefixed(flattenStats(context.target, "match_"), "target"));
    Object.assign(row, prefixed(flattenStats(context.opponent, "match_"), "opponent"));
    Object.assign(row, extractLeagueMetrics(record, context.targetId));
    Object.assign(row, prefixed(extractLeagueMetrics(record, context.opponentId), "opponent"));
    rows.push(row as MatchRow);
  });

  return rows;
}

export function convertToRoundRows(recordsInput: Record<string, unknown>[], username: string): RoundRow[] {
  const records = [...recordsInput].sort((a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")));
  const targetPlayerId = inferTargetPlayerId(records, username);
  const rows: RoundRow[] = [];

  records.forEach((record, matchIndex) => {
    const context = playerContext(record, username, targetPlayerId);
    if (!context) {
      return;
    }
    const rounds = nested(record, "results", "rounds");
    if (!Array.isArray(rounds)) {
      return;
    }
    const targetLeague = extractLeagueMetrics(record, context.targetId);
    const opponentLeague = prefixed(extractLeagueMetrics(record, context.opponentId), "opponent");

    rounds.forEach((roundPlayers, roundIndex) => {
      if (!Array.isArray(roundPlayers)) {
        return;
      }
      const roundTarget = roundPlayers.find((player) => isObject(player) && String(player.id ?? "") === context.targetId) as Record<string, unknown> | undefined
        ?? findPlayer(roundPlayers, username, targetPlayerId);
      if (!roundTarget) {
        return;
      }
      const roundOpponent = roundPlayers.find((player) => isObject(player) && context.opponentId && String(player.id ?? "") === context.opponentId) as Record<string, unknown> | undefined
        ?? roundPlayers.find((player) => isObject(player) && String(player.id ?? "") !== String(roundTarget.id ?? "")) as Record<string, unknown> | undefined
        ?? null;
      const row: DataRow = {
        match_number: matchIndex + 1,
        match_id: cell(record._id),
        replay_id: cell(record.replayid),
        replay_stub: cell(record.stub),
        ts_utc: cell(record.ts),
        played_at_jst: isoToJst(record.ts),
        gamemode: cell(record.gamemode),
        disputed: cell(record.disputed),
        match_result: context.matchResult,
        target_score: cell(context.targetWins),
        opponent_score: cell(context.opponentWins),
        leaderboard_count: context.leaderboard.length,
        target_id: context.targetId,
        target_username: cell(context.target.username),
        target_leaderboard_active: cell(context.target.active),
        opponent: cell(context.opponent?.username),
        opponent_id: context.opponentId,
        opponent_leaderboard_active: cell(context.opponent?.active),
        results_leaderboard_json: jsonCell(context.leaderboard),
        round: roundIndex + 1,
        round_player_count: roundPlayers.length,
        round_players_json: jsonCell(roundPlayers),
        round_won: Boolean(roundTarget.alive),
        lifetime_ms: cell(roundTarget.lifetime),
        opponent_round_won: roundOpponent ? Boolean(roundOpponent.alive) : null,
        opponent_lifetime_ms: roundOpponent ? cell(roundOpponent.lifetime) : null,
      };
      Object.assign(row, targetLeague);
      Object.assign(row, opponentLeague);
      Object.assign(row, flattenPlayerMetadata(roundTarget, "target_round_"));
      Object.assign(row, flattenPlayerMetadata(roundOpponent, "opponent_round_"));
      Object.assign(row, flattenStats(roundTarget));
      Object.assign(row, prefixed(flattenStats(roundOpponent), "opponent"));
      rows.push(row as RoundRow);
    });
  });

  return rows;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function prisecterString(entry: unknown): string | null {
  if (!isObject(entry) || !isObject(entry.p)) {
    return null;
  }
  const { pri, sec, ter } = entry.p as Record<string, unknown>;
  if (pri === undefined || sec === undefined || ter === undefined) {
    return null;
  }
  return `${pri}:${sec}:${ter}`;
}

function findPlayer(players: unknown[], username: string, playerId?: string | null): Record<string, unknown> | null {
  if (playerId) {
    const byId = players.find((player) => isObject(player) && String(player.id ?? "") === playerId);
    if (isObject(byId)) {
      return byId;
    }
  }
  const lower = username.toLowerCase();
  const byName = players.find((player) => isObject(player) && String(player.username ?? "").toLowerCase() === lower);
  return isObject(byName) ? byName : null;
}

function inferTargetPlayerId(records: Record<string, unknown>[], username: string): string | null {
  const usernameLower = username.toLowerCase();
  const matchingIds = new Map<string, number>();
  const allIds = new Map<string, number>();
  for (const record of records) {
    const leaderboard = nested(record, "results", "leaderboard");
    if (!Array.isArray(leaderboard)) {
      continue;
    }
    for (const player of leaderboard) {
      if (!isObject(player)) {
        continue;
      }
      const playerId = String(player.id ?? "");
      if (!playerId) {
        continue;
      }
      allIds.set(playerId, (allIds.get(playerId) ?? 0) + 1);
      if (String(player.username ?? "").toLowerCase() === usernameLower) {
        matchingIds.set(playerId, (matchingIds.get(playerId) ?? 0) + 1);
      }
    }
  }
  return maxCountKey(matchingIds) ?? maxCountKey(allIds);
}

interface PlayerContext {
  leaderboard: Record<string, unknown>[];
  target: Record<string, unknown>;
  targetId: string;
  opponent: Record<string, unknown> | null;
  opponentId: string;
  targetWins: number | null;
  opponentWins: number | null;
  matchResult: string;
  targetProfile: Record<string, unknown> | null;
  opponentProfile: Record<string, unknown> | null;
}

function playerContext(record: Record<string, unknown>, username: string, playerId: string | null): PlayerContext | null {
  const leaderboardRaw = nested(record, "results", "leaderboard");
  if (!Array.isArray(leaderboardRaw)) {
    return null;
  }
  const leaderboard = leaderboardRaw.filter(isObject);
  const target = findPlayer(leaderboard, username, playerId);
  if (!target) {
    return null;
  }
  const targetId = String(target.id ?? "");
  const opponent = leaderboard.find((player) => String(player.id ?? "") !== targetId) ?? null;
  const opponentId = opponent ? String(opponent.id ?? "") : "";
  const otherusers = Array.isArray(record.otherusers) ? record.otherusers.filter(isObject) : [];
  const profiles = new Map(otherusers.map((user) => [String(user.id ?? ""), user]));
  const targetWins = numberOrNull(target.wins);
  const opponentWins = numberOrNull(opponent?.wins);
  let matchResult = "";
  if (targetWins !== null && opponentWins !== null) {
    if (targetWins > opponentWins) {
      matchResult = "win";
    } else if (targetWins < opponentWins) {
      matchResult = "loss";
    } else {
      matchResult = "draw";
    }
  }
  return {
    leaderboard,
    target,
    targetId,
    opponent,
    opponentId,
    targetWins,
    opponentWins,
    matchResult,
    targetProfile: profiles.get(targetId) ?? null,
    opponentProfile: profiles.get(opponentId) ?? null,
  };
}

function baseMatchFields(record: Record<string, unknown>, matchNumber: number, context: PlayerContext): DataRow {
  const rounds = nested(record, "results", "rounds");
  const p = isObject(record.p) ? record.p : {};
  return {
    match_number: matchNumber,
    match_id: cell(record._id),
    replay_id: cell(record.replayid),
    ts_utc: cell(record.ts),
    played_at_jst: isoToJst(record.ts),
    gamemode: cell(record.gamemode),
    disputed: cell(record.disputed),
    pb: cell(record.pb),
    oncepb: cell(record.oncepb),
    stub: cell(record.stub),
    p_pri: cell(p.pri),
    p_sec: cell(p.sec),
    p_ter: cell(p.ter),
    match_result: context.matchResult,
    target_score: cell(context.targetWins),
    opponent_score: cell(context.opponentWins),
    round_count: Array.isArray(rounds) ? rounds.length : null,
    leaderboard_count: context.leaderboard.length,
    otherusers_count: Array.isArray(record.otherusers) ? record.otherusers.length : 0,
    target_id: context.targetId,
    target_username: cell(context.target.username),
    opponent: cell(context.opponent?.username),
    opponent_id: context.opponentId,
    revolution_json: jsonCell(record.revolution),
    leaderboards_json: jsonCell(record.leaderboards),
    otherusers_json: jsonCell(record.otherusers),
    extras_json: jsonCell(record.extras),
    results_leaderboard_json: jsonCell(context.leaderboard),
    raw_record_json: jsonCell(record),
  };
}

function flattenStats(player: Record<string, unknown> | null | undefined, prefix = ""): DataRow {
  const rawStats = isObject(player?.stats) ? player.stats : {};
  const row: DataRow = {};
  for (const [name, paths] of Object.entries(STAT_FIELDS)) {
    row[`${prefix}${name}`] = cell(firstNested(rawStats, ...paths));
  }
  row[`${prefix}stats_json`] = jsonCell(rawStats);
  return row;
}

function flattenPlayerMetadata(player: Record<string, unknown> | null | undefined, prefix: string): DataRow {
  const source = player ?? {};
  return {
    [`${prefix}id`]: cell(source.id),
    [`${prefix}username`]: cell(source.username),
    [`${prefix}active`]: cell(source.active),
    [`${prefix}naturalorder`]: cell(source.naturalorder),
    [`${prefix}shadowed_by_json`]: jsonCell(source.shadowedBy),
    [`${prefix}shadows_json`]: jsonCell(source.shadows),
    [`${prefix}player_json`]: jsonCell(source),
  };
}

function flattenProfile(profile: Record<string, unknown> | null | undefined, prefix: string): DataRow {
  const source = profile ?? {};
  return {
    [`${prefix}profile_id`]: cell(source.id),
    [`${prefix}profile_username`]: cell(source.username),
    [`${prefix}country`]: cell(source.country),
    [`${prefix}supporter`]: cell(source.supporter),
    [`${prefix}avatar_revision`]: cell(source.avatar_revision),
    [`${prefix}banner_revision`]: cell(source.banner_revision),
    [`${prefix}profile_json`]: jsonCell(source),
  };
}

function extractLeagueMetrics(record: Record<string, unknown>, playerId: string): DataRow {
  const leagueData = nested(record, "extras", "league");
  const values = isObject(leagueData) ? leagueData[playerId] : undefined;
  const items = Array.isArray(values) ? values : [];
  const before = isObject(items[0]) ? items[0] : {};
  const after = isObject(items[1]) ? items[1] : {};
  return {
    tr_before: cell(before.tr),
    tr_after: cell(after.tr),
    tr_delta: metricDelta(before.tr, after.tr),
    glicko_before: cell(before.glicko),
    glicko_after: cell(after.glicko),
    glicko_delta: metricDelta(before.glicko, after.glicko),
    rd_before: cell(before.rd),
    rd_after: cell(after.rd),
    rd_delta: metricDelta(before.rd, after.rd),
    games_played_before: cell(before.gamesplayed),
    games_played_after: cell(after.gamesplayed),
    games_played_delta: metricDelta(before.gamesplayed, after.gamesplayed),
    games_won_before: cell(before.gameswon),
    games_won_after: cell(after.gameswon),
    games_won_delta: metricDelta(before.gameswon, after.gameswon),
    league_rank_before: cell(before.rank),
    league_rank_after: cell(after.rank),
    placement_before: cell(before.placement),
    placement_after: cell(after.placement),
    placement_delta: metricDelta(before.placement, after.placement),
    league_metrics_json: jsonCell(values),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function maxCountKey(map: Map<string, number>): string | null {
  let bestKey: string | null = null;
  let bestValue = -Infinity;
  for (const [key, value] of map.entries()) {
    if (value > bestValue) {
      bestKey = key;
      bestValue = value;
    }
  }
  return bestKey;
}
