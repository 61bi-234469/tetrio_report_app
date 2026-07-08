import type { DataRow, MatchRow, RoundRow } from "./types";
import { STYLE_ORDER } from "./model";
import { mean } from "./stats";
import { groupBy, jstParts, toNumber } from "../utils";
import { BASE_PARAM_COLUMNS, calculateParams } from "../params";

export const EST_TR_COLUMN = "Est. TR";
export const LEGACY_EST_TR_COLUMNS = [
  "Est. TR (TetraStats)",
  "Est. TR(S2 sheetBot)",
];

export const WIN_RESULTS = new Set(["win", "victory"]);
export const LOSS_RESULTS = new Set(["loss", "defeat"]);
export const DQ_WIN_RESULTS = new Set(["dqvictory", "dqwin"]);
export const DQ_LOSS_RESULTS = new Set(["dqdefeat", "dqloss"]);
export const NULLIFIED_RESULTS = new Set(["nullified"]);
export const NO_CONTEST_RESULTS = new Set(["nocontest", "no contest", "no_contest"]);
export const TIE_RESULTS = new Set(["tie", "draw"]);
export const OFFICIAL_RESULTS = new Set([...WIN_RESULTS, ...LOSS_RESULTS, ...DQ_WIN_RESULTS, ...DQ_LOSS_RESULTS]);

export const DEFAULT_SESSION_GAP_MINUTES = 10;
export const ABILITY_METRIC_COLUMNS: Array<[string, string]> = [
  ["APM", "apm"],
  ["PPS", "pps"],
  ["VS", "vs"],
  ["APP", "APP"],
  ["DS/Second", "DS/Second"],
  ["DS/Piece", "DS/Piece"],
  ["APP+DS/Piece", "APP+DS/Piece"],
  ["VS/APM", "VS/APM"],
  ["Cheese Index", "Cheese Index"],
  ["Garbage Eff.", "Garbage Effi."],
  ["Area", "Area"],
  ["Est. TR", EST_TR_COLUMN],
];

export const BASE_METRICS: Record<string, string> = {
  APM: "apm",
  PPS: "pps",
  VS: "vs",
  APP: "APP",
  "DS/Second": "DS/Second",
  "DS/Piece": "DS/Piece",
  "APP+DS/Piece": "APP+DS/Piece",
  "VS/APM": "VS/APM",
  "Cheese Index": "Cheese Index",
  "Garbage Eff.": "Garbage Effi.",
  Area: "Area",
  "Est. TR": EST_TR_COLUMN,
};

export const OPPONENT_COLUMN: Record<string, string> = {
  apm: "opponent_apm",
  pps: "opponent_pps",
  vs: "opponent_vs",
  APP: "opponent_APP",
  "DS/Second": "opponent_DS/Second",
  "DS/Piece": "opponent_DS/Piece",
  "APP+DS/Piece": "opponent_APP+DS/Piece",
  "VS/APM": "opponent_VS/APM",
  "Garbage Effi.": "opponent_Garbage Effi.",
  "Cheese Index": "opponent_Cheese Index",
  Area: "opponent_Area",
  [EST_TR_COLUMN]: `opponent_${EST_TR_COLUMN}`,
};

export function enrichRounds(rows: RoundRow[]): RoundRow[] {
  return rows
    .map((row) => normalizeRound({ ...row }))
    .sort((a, b) => {
      const ad = String(a.played_at_jst ?? "");
      const bd = String(b.played_at_jst ?? "");
      return ad.localeCompare(bd) ||
        Number(a.match_number) - Number(b.match_number) ||
        Number(a.round) - Number(b.round);
    });
}

export function buildMatchRows(rounds: RoundRow[], sessionGapMinutes = DEFAULT_SESSION_GAP_MINUTES): MatchRow[] {
  const groups = groupBy(rounds, (row) => Number(row.match_number));
  const matches: MatchRow[] = [];

  for (const [matchNumber, group] of groups.entries()) {
    const first = group[0];
    if (!first) {
      continue;
    }
    const match: DataRow = {};
    const metadata = [
      "match_id",
      "replay_id",
      "replay_stub",
      "played_at_jst",
      "opponent",
      "opponent_id",
      "match_result",
      "target_id",
      "target_username",
      "target_leaderboard_active",
      "opponent_leaderboard_active",
      "target_score",
      "opponent_score",
      "results_leaderboard_json",
      "tr_before",
      "tr_after",
      "tr_delta",
      "opponent_tr_before",
      "opponent_tr_after",
      "opponent_tr_delta",
      "glicko_before",
      "glicko_after",
      "glicko_delta",
      "rd_before",
      "rd_after",
      "rd_delta",
      "games_played_before",
      "games_played_after",
      "games_played_delta",
      "games_won_before",
      "games_won_after",
      "games_won_delta",
      "opponent_glicko_before",
      "opponent_glicko_after",
      "opponent_glicko_delta",
      "opponent_rd_before",
      "opponent_rd_after",
      "opponent_rd_delta",
      "opponent_games_played_before",
      "opponent_games_played_after",
      "opponent_games_played_delta",
      "opponent_games_won_before",
      "opponent_games_won_after",
      "opponent_games_won_delta",
      "league_rank_before",
      "league_rank_after",
      "placement_before",
      "placement_after",
      "placement_delta",
    ];
    // pandas groupby.first() は列ごとに最初の非欠損値を採用する。
    for (const key of metadata) {
      for (const row of group) {
        const value = row[key];
        if (value !== undefined && value !== null && value !== "") {
          match[key] = value;
          break;
        }
      }
      if (match[key] === undefined && first[key] !== undefined) {
        match[key] = first[key];
      }
    }
    // TETR.IO/Tetra Stats同様、マッチ単位の能力値はAPIの試合集計値(leaderboard.stats)を優先する。
    // 欠損時のみラウンド単純平均にフォールバックする。
    const leaderboardEntries = parseLeaderboardEntries(match);
    for (const [statField, matchKey] of LEADERBOARD_METRIC_FIELDS) {
      const targetValue = leaderboardStat(leaderboardEntries.target, statField);
      match[matchKey] = targetValue !== null ? targetValue : mean(group.map((row) => row[matchKey]));
      const opponentValue = leaderboardStat(leaderboardEntries.opponent, statField);
      match[`opponent_${matchKey}`] = opponentValue !== null
        ? opponentValue
        : mean(group.map((row) => row[`opponent_${matchKey}`]));
    }
    assignCalculatedParams(match, "", "");
    assignCalculatedParams(match, "opponent_", "opponent_");

    match.match_number = matchNumber;
    match.round_count = group.length;
    match.rounds_won = group.filter((row) => Boolean(row.round_won)).length;
    match.rounds_lost = group.filter((row) => Boolean(row.opponent_round_won)).length;
    const durations = group.map((row) => Math.max(toNumber(row.lifetime_ms) ?? 0, toNumber(row.opponent_lifetime_ms) ?? 0));
    match.match_duration_ms = durations.some((value) => value > 0)
      ? durations.reduce((sum, value) => sum + value, 0)
      : null;
    const norm = String(match.match_result ?? "").trim().toLowerCase();
    match.match_result_norm = norm;
    match.nullified = NULLIFIED_RESULTS.has(norm);
    match.no_contest = NO_CONTEST_RESULTS.has(norm);
    match.tie = TIE_RESULTS.has(norm);
    const activity = activityFromEntries(leaderboardEntries);
    const inferredDqWin = (inactiveValue(match.opponent_leaderboard_active) || activity.opponentInactive) &&
      (WIN_RESULTS.has(norm) || DQ_WIN_RESULTS.has(norm));
    const inferredDqLoss = (inactiveValue(match.target_leaderboard_active) || activity.targetInactive) &&
      (LOSS_RESULTS.has(norm) || DQ_LOSS_RESULTS.has(norm));
    match.dq_win = DQ_WIN_RESULTS.has(norm) || inferredDqWin;
    match.dq_loss = DQ_LOSS_RESULTS.has(norm) || inferredDqLoss;
    match.regular_result = (WIN_RESULTS.has(norm) || LOSS_RESULTS.has(norm)) && !match.dq_win && !match.dq_loss;
    match.dq_result = Boolean(match.dq_win || match.dq_loss);
    match.won = WIN_RESULTS.has(norm) || DQ_WIN_RESULTS.has(norm);
    match.official_won = match.won;
    match.completed = OFFICIAL_RESULTS.has(norm);
    match.analysis_eligible = Boolean(match.completed && match.regular_result);

    const parts = jstParts(match.played_at_jst);
    match.date = parts.date;
    match.month = parts.month;
    match.weekday = parts.weekday;
    match.hour = parts.hour;
    match.__epoch_ms = parts.epochMs;

    for (const [label, own, opponent] of metricPairs()) {
      const ownValue = toNumber(match[own]);
      const opponentValue = toNumber(match[opponent]);
      if (ownValue !== null && opponentValue !== null) {
        match[`delta_${label}`] = ownValue - opponentValue;
      }
    }
    const trBefore = toNumber(match.tr_before);
    const opponentTrBefore = toNumber(match.opponent_tr_before);
    if (trBefore !== null && opponentTrBefore !== null) {
      match.tr_diff = trBefore - opponentTrBefore;
    }
    if (STYLE_ORDER.every((style) => toNumber(match[style]) !== null)) {
      match["Opener - Inf DS"] = (toNumber(match.Opener) ?? 0) - (toNumber(match["Inf DS"]) ?? 0);
      match["Stride - Plonk"] = (toNumber(match.Stride) ?? 0) - (toNumber(match.Plonk) ?? 0);
      match.self_style = strongestStyle(match, "");
    } else {
      match.self_style = "Unknown";
    }
    if (STYLE_ORDER.every((style) => toNumber(match[`opponent_${style}`]) !== null)) {
      match["opponent_Opener - Inf DS"] = (toNumber(match.opponent_Opener) ?? 0) - (toNumber(match["opponent_Inf DS"]) ?? 0);
      match["opponent_Stride - Plonk"] = (toNumber(match.opponent_Stride) ?? 0) - (toNumber(match.opponent_Plonk) ?? 0);
      match.opponent_style = strongestStyle(match, "opponent_");
    } else {
      match.opponent_style = "Unknown";
    }

    matches.push(match as MatchRow);
  }

  matches.sort((a, b) => Number(a.__epoch_ms ?? 0) - Number(b.__epoch_ms ?? 0) || Number(a.match_number) - Number(b.match_number));
  assignSessions(matches, sessionGapMinutes);
  assignStreaks(matches);
  return matches;
}

function normalizeRound(row: RoundRow): RoundRow {
  for (const legacy of LEGACY_EST_TR_COLUMNS) {
    if (row[EST_TR_COLUMN] === undefined && row[legacy] !== undefined) {
      row[EST_TR_COLUMN] = row[legacy];
    }
    const oldOpponent = `opponent_${legacy}`;
    const newOpponent = `opponent_${EST_TR_COLUMN}`;
    if (row[newOpponent] === undefined && row[oldOpponent] !== undefined) {
      row[newOpponent] = row[oldOpponent];
    }
  }
  row.round_won = Boolean(row.round_won);
  if (row.opponent_round_won === null || row.opponent_round_won === undefined) {
    row.opponent_round_won = !row.round_won;
  } else {
    row.opponent_round_won = Boolean(row.opponent_round_won);
  }
  Object.assign(row, deriveRoundMetrics(toNumber(row.apm), toNumber(row.pps), toNumber(row.vs), ""));
  Object.assign(row, deriveRoundMetrics(toNumber(row.opponent_apm), toNumber(row.opponent_pps), toNumber(row.opponent_vs), "opponent_"));
  assignCalculatedParams(row, "", "");
  assignCalculatedParams(row, "opponent_", "opponent_");
  const lifetime = toNumber(row.lifetime_ms);
  row.lifetime_s = lifetime === null ? null : lifetime / 1000;
  return row;
}

function assignCalculatedParams(row: DataRow, sourcePrefix: string, outputPrefix: string): void {
  try {
    Object.assign(row, calculateParams(row, undefined, undefined, sourcePrefix, outputPrefix));
  } catch {
    for (const column of BASE_PARAM_COLUMNS) {
      if (row[`${outputPrefix}${column}`] === undefined) {
        row[`${outputPrefix}${column}`] = null;
      }
    }
  }
}

// report_analysis.enrich_rounds と同じ列単位のNaN伝播: 分母0や欠損はその列だけnull。
function deriveRoundMetrics(apm: number | null, pps: number | null, vs: number | null, prefix: string): DataRow {
  const div = (numerator: number | null, denominator: number | null): number | null =>
    numerator !== null && denominator !== null && denominator !== 0 ? numerator / denominator : null;
  const app = div(apm, pps === null ? null : pps * 60);
  const dsSecond = vs !== null && apm !== null ? vs / 100 - apm / 60 : null;
  const dsPiece = div(dsSecond, pps);
  const garbageEff = app !== null && dsSecond !== null && pps !== null && pps !== 0
    ? ((app * dsSecond) / pps) * 2
    : null;
  const appDsPiece = app !== null && dsPiece !== null ? app + dsPiece : null;
  const vsApm = div(vs, apm);
  const area = apm !== null && pps !== null && vs !== null && app !== null && dsSecond !== null && dsPiece !== null && garbageEff !== null
    ? apm + pps * 45 + vs * 0.444 + app * 185 + dsSecond * 175 + dsPiece * 450 + garbageEff * 315
    : null;
  return {
    [`${prefix}APP`]: app,
    [`${prefix}DS/Second`]: dsSecond,
    [`${prefix}DS/Piece`]: dsPiece,
    [`${prefix}Garbage Effi.`]: garbageEff,
    [`${prefix}APP+DS/Piece`]: appDsPiece,
    [`${prefix}VS/APM`]: vsApm,
    [`${prefix}Area`]: area,
  };
}

function normId(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim().toLowerCase();
}

function inactiveValue(value: unknown): boolean {
  if (value === false) {
    return true;
  }
  if (typeof value === "number") {
    return value === 0;
  }
  if (typeof value === "string") {
    return ["false", "0", "no"].includes(value.trim().toLowerCase());
  }
  return false;
}

interface LeaderboardEntries {
  target: Record<string, unknown> | null;
  opponent: Record<string, unknown> | null;
}

const EMPTY_LEADERBOARD_ENTRIES: LeaderboardEntries = { target: null, opponent: null };

function parseLeaderboardEntries(row: DataRow): LeaderboardEntries {
  const raw = row.results_leaderboard_json;
  if (typeof raw !== "string" || !raw.trim()) {
    return EMPTY_LEADERBOARD_ENTRIES;
  }
  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch {
    return EMPTY_LEADERBOARD_ENTRIES;
  }
  if (!Array.isArray(entries)) {
    return EMPTY_LEADERBOARD_ENTRIES;
  }

  const targetId = normId(row.target_id);
  const targetUsername = normId(row.target_username);
  const opponentId = normId(row.opponent_id);
  const opponentUsername = normId(row.opponent);
  let target: Record<string, unknown> | null = null;
  let opponent: Record<string, unknown> | null = null;
  const objects = entries.filter((entry): entry is Record<string, unknown> =>
    Boolean(entry && typeof entry === "object" && !Array.isArray(entry)));

  for (const entry of objects) {
    const entryId = normId(entry.id);
    const entryUsername = normId(entry.username);
    if (!target && ((targetId && entryId === targetId) || (targetUsername && entryUsername === targetUsername))) {
      target = entry;
    }
    if (!opponent && ((opponentId && entryId === opponentId) || (opponentUsername && entryUsername === opponentUsername))) {
      opponent = entry;
    }
  }
  if (!target && opponent) {
    target = objects.find((entry) => entry !== opponent) ?? null;
  }
  if (!opponent && target) {
    opponent = objects.find((entry) => entry !== target) ?? null;
  }
  return { target, opponent };
}

function activityFromEntries(entries: LeaderboardEntries): { targetInactive: boolean; opponentInactive: boolean } {
  return {
    targetInactive: Boolean(entries.target && entries.target.active === false),
    opponentInactive: Boolean(entries.opponent && entries.opponent.active === false),
  };
}

// leaderboard.stats のAPIフィールド名は表示名と異なる(例: VSは"vsscore")。
const LEADERBOARD_METRIC_FIELDS: Array<["apm" | "pps" | "vsscore" | "btb", string]> = [
  ["apm", "apm"],
  ["pps", "pps"],
  ["vsscore", "vs"],
  ["btb", "btb"],
];

function leaderboardStat(entry: Record<string, unknown> | null, field: "apm" | "pps" | "vsscore" | "btb"): number | null {
  if (!entry) {
    return null;
  }
  const stats = entry.stats;
  if (!stats || typeof stats !== "object") {
    return null;
  }
  return toNumber((stats as Record<string, unknown>)[field]);
}

export function metricPairs(): Array<[string, string, string]> {
  return [
    ["APM", "apm", "opponent_apm"],
    ["PPS", "pps", "opponent_pps"],
    ["VS", "vs", "opponent_vs"],
    ["APP", "APP", "opponent_APP"],
    ["DS/Second", "DS/Second", "opponent_DS/Second"],
    ["DS/Piece", "DS/Piece", "opponent_DS/Piece"],
    ["APP+DS/Piece", "APP+DS/Piece", "opponent_APP+DS/Piece"],
    ["VS/APM", "VS/APM", "opponent_VS/APM"],
    ["Garbage Eff.", "Garbage Effi.", "opponent_Garbage Effi."],
    ["Cheese Index", "Cheese Index", "opponent_Cheese Index"],
    ["Area", "Area", "opponent_Area"],
    ["Est. TR", EST_TR_COLUMN, `opponent_${EST_TR_COLUMN}`],
  ];
}

function assignSessions(matches: MatchRow[], sessionGapMinutes: number): void {
  let sessionId = 0;
  let previousBoundary: number | null = null;
  for (const match of matches) {
    const start = toNumber(match.__epoch_ms);
    const duration = toNumber(match.match_duration_ms) ?? 0;
    const gap = start !== null && previousBoundary !== null
      ? (start - previousBoundary) / 60000
      : null;
    if (gap === null || gap > sessionGapMinutes) {
      sessionId += 1;
    }
    match.session_break_minutes = gap;
    match.session_id = sessionId;
    previousBoundary = start === null ? previousBoundary : start + duration;
  }
  const sizes = new Map<number, number>();
  const positions = new Map<number, number>();
  for (const match of matches) {
    const id = Number(match.session_id);
    sizes.set(id, (sizes.get(id) ?? 0) + 1);
  }
  for (const match of matches) {
    const id = Number(match.session_id);
    const nextPosition = (positions.get(id) ?? 0) + 1;
    positions.set(id, nextPosition);
    match.session_position = nextPosition;
    match.session_size = sizes.get(id) ?? 1;
  }
}

function assignStreaks(matches: MatchRow[]): void {
  let previous: boolean | null = null;
  let previousSession: number | null = null;
  let run = 0;
  for (const match of matches) {
    const sessionId = Number(match.session_id);
    if (previousSession === null || sessionId !== previousSession) {
      previous = null;
      run = 0;
    }
    if (previous === null) {
      match.previous_won = null;
      match.streak_before = 0;
    } else {
      match.previous_won = previous;
      match.streak_before = previous ? run : -run;
    }
    const won = Boolean(match.won);
    if (won === previous) {
      run += 1;
    } else {
      previous = won;
      run = 1;
    }
    previousSession = sessionId;
  }
}

function strongestStyle(row: DataRow, prefix: string): string {
  let best = "Unknown";
  let bestValue = -Infinity;
  for (const style of STYLE_ORDER) {
    const value = toNumber(row[`${prefix}${style}`]);
    if (value !== null && value > bestValue) {
      best = style;
      bestValue = value;
    }
  }
  return best;
}

