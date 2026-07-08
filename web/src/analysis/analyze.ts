import type { AnalysisBundle, DataRow, MatchRow, MonthlyRow, RoundRow, Summary, TiebreakRow } from "./types";
import { expectedExcess, groupWinRate } from "./aggregate";
import { applyExpectedWins } from "./expected";
import {
  ABILITY_METRIC_COLUMNS,
  BASE_METRICS,
  DEFAULT_SESSION_GAP_MINUTES,
  NO_CONTEST_RESULTS,
  NULLIFIED_RESULTS,
  OFFICIAL_RESULTS,
  OPPONENT_COLUMN,
  TIE_RESULTS,
  buildMatchRows,
  enrichRounds,
} from "./enrich";
import { RANK_ORDER, RECENT_MATCH_WINDOW, SCORE_STATE_ORDER, STYLE_ORDER, STYLE_PLANE_MIN_MATCHES, STYLE_QUADRANTS, TABLE_SCOPE_WINDOWS } from "./model";
import { buildReplayCandidates } from "./replay";
import { cohensD, mean, quantile, quantileBins, runLengths, std, wilsonInterval } from "./stats";
import { BASE_PARAM_COLUMNS, calculateAverageParams, calculateParams } from "../params";
import type { LeagueSummaryResult } from "../tetrio-api";

const EMPTY_RESULTS = new Set(["nan", "none", ""]);
import { groupBy, toNumber } from "../utils";

export interface AnalyzeOptions {
  username: string;
  fetchedAt?: string;
  maxMatches: number | "all";
  recordsCount: number;
  truncated?: boolean;
  cachedUntil?: number | null;
  sessionGapMinutes?: number;
  leagueSummary?: LeagueSummaryResult | null;
}

export function analyzeReport(roundRows: RoundRow[], options: AnalyzeOptions): AnalysisBundle {
  const sessionGapMinutes = options.sessionGapMinutes ?? DEFAULT_SESSION_GAP_MINUTES;
  const rounds = enrichRounds(roundRows);
  const matches = buildMatchRows(rounds, sessionGapMinutes);
  const model = applyExpectedWins(matches);
  const completed = matches.filter((match) => Boolean(match.completed));
  const regularOnly = matches.filter((match) => Boolean(match.analysis_eligible));
  const completedIds = new Set(completed.map((match) => Number(match.match_number)));
  const eligibleRounds = rounds.filter((round) => completedIds.has(Number(round.match_number)));
  const monthly = buildMonthly(completed);
  const tiebreak = analyzeTiebreaks(eligibleRounds, completed);
  const scoreStates = buildScoreStateRounds(eligibleRounds, completed);
  const overallStreak = runLengths(completed.map((match) => Boolean(match.won)));
  const sessionStreak = sessionMaxRunLengths(completed);
  const recentN = Math.min(RECENT_MATCH_WINDOW, completed.length);
  const recentMatches = completed.slice(-recentN);
  const recentIds = new Set(recentMatches.map((match) => Number(match.match_number)));
  const recentRounds = eligibleRounds.filter((round) => recentIds.has(Number(round.match_number)));
  const windows = recentWindows(completed);
  const metricMeans = metricMeansFor(completed);
  const recentMetricMeans = metricMeansFor(recentMatches);
  const effectSizes = effectSizeRows(completed);
  const baseMeans = baseMetricMeans(completed);
  const deltaMetricBins = buildDeltaMetricBins(completed);
  const trGap = buildTrGap(completed);
  const drawdown = buildDrawdownSummary(completed);
  const sessionPositions = buildSessionPositions(completed, baseMeans);
  const excessByWeekday = buildExcessBreakdown(completed, "weekday", [
    [0, "月"],
    [1, "火"],
    [2, "水"],
    [3, "木"],
    [4, "金"],
    [5, "土"],
    [6, "日"],
  ], baseMeans);
  const excessByHour = buildExcessBreakdown(completed, "__hour_band", [
    ["0–3時", "0–3時"],
    ["4–7時", "4–7時"],
    ["8–11時", "8–11時"],
    ["12–15時", "12–15時"],
    ["16–19時", "16–19時"],
    ["20–23時", "20–23時"],
  ], baseMeans);
  const records = buildRecords(eligibleRounds, completed, overallStreak, sessionStreak, tiebreak.summary);
  const resultCounts = countBy(matches, (match) => String(match.match_result_norm ?? ""));
  const knownResults = new Set([
    ...OFFICIAL_RESULTS,
    ...NULLIFIED_RESULTS,
    ...NO_CONTEST_RESULTS,
    ...TIE_RESULTS,
    ...EMPTY_RESULTS,
  ]);
  const unknownResultCounts = Object.fromEntries(
    Object.entries(resultCounts).filter(([key]) => !knownResults.has(key)),
  );
  const firstTr = firstFinite(completed.map((match) => match.tr_before));
  const currentTr = lastFinite(completed.map((match) => match.tr_after));
  const peakRow = maxRow(completed, "tr_after");
  const drawdownMax = toNumber(drawdown.max);
  const drawdownDate = drawdown.date ?? null;
  const source: Summary["source"] = {
    username: options.username,
    fetched_at: options.fetchedAt ?? new Date().toISOString(),
    max_matches: options.maxMatches,
    rows: {
      records: options.recordsCount,
      matches: matches.length,
      rounds: rounds.length,
    },
    cached_until: options.cachedUntil ?? null,
  };
  if (options.truncated !== undefined) {
    source.truncated = options.truncated;
  }
  const summary: Summary = {
    schema_version: "2.0.0",
    source,
    session_definition: {
      gap_minutes: sessionGapMinutes,
      gap_basis: "previous_match_end_to_next_match_start",
      same_session_rule: `前マッチ完了直後から次マッチ開始までの間隔が${sessionGapMinutes}分以内なら同一セッションです。`,
      match_end_estimate: "played_at_jstに、各ラウンドのmax(lifetime_ms, opponent_lifetime_ms)合計を足してマッチ完了時刻を推定しています。",
      fallback: "マッチ時間を推定できない境界では、前マッチのplayed_at_jstを基準にします。",
    },
    meta: {
      player: options.username,
      start: completed.map((match) => String(match.played_at_jst ?? "")).filter(Boolean).sort()[0] ?? null,
      end: completed.map((match) => String(match.played_at_jst ?? "")).filter(Boolean).sort().at(-1) ?? null,
      matches: completed.length,
      analysis_matches: completed.length,
      rounds: eligibleRounds.length,
      source_rounds: rounds.length,
      synthetic_rounds: 0,
      input_rounds: rounds.length,
      active_days: new Set(completed.map((match) => match.date).filter(Boolean)).size,
      opponents: new Set(completed.map((match) => match.opponent_id || match.opponent).filter(Boolean)).size,
      sessions: new Set(completed.map((match) => match.session_id).filter(Boolean)).size,
      session_gap_minutes: sessionGapMinutes,
      session_gap_basis: "previous_match_end_to_next_match_start",
      result_counts: resultCounts,
      nullified_matches: matches.filter((match) => match.nullified).length,
      no_contest_matches: matches.filter((match) => match.no_contest).length,
      tie_matches: matches.filter((match) => match.tie).length,
      unknown_result_counts: unknownResultCounts,
      dq_wins: matches.filter((match) => match.dq_win).length,
      dq_losses: matches.filter((match) => match.dq_loss).length,
    },
    kpis: {
      wins: completed.filter((match) => match.won).length,
      losses: completed.filter((match) => !match.won).length,
      official_win_rate: groupWinRate(completed),
      normal_win_rate: groupWinRate(regularOnly),
      dq_wins: completed.filter((match) => match.dq_win).length,
      dq_losses: completed.filter((match) => match.dq_loss).length,
      nullified: matches.filter((match) => match.nullified).length,
      no_contest: matches.filter((match) => match.no_contest).length,
      ties: matches.filter((match) => match.tie).length,
      analysis_matches: completed.length,
      first_tr: firstTr,
      current_tr: currentTr,
      tr_change: firstTr !== null && currentTr !== null ? currentTr - firstTr : null,
      peak_tr: toNumber(peakRow?.tr_after),
      peak_date: peakRow?.played_at_jst ?? null,
      max_drawdown: drawdownMax,
      max_drawdown_date: drawdownDate,
    },
    recent_windows: windows,
    metrics: metricMeans,
    metrics_recent: recentMetricMeans,
    current_league: buildCurrentLeague(options.leagueSummary ?? null),
    recent_scope: {
      n_matches: recentMatches.length,
      n_rounds: recentRounds.length,
    },
    growth_window_n: growthWindowN(completed.length),
    growth: buildGrowth(completed),
    growth_windows: buildGrowthWindows(completed),
    stability: buildStability(completed),
    monthly_changes: buildMonthlyChanges(monthly),
    effect_sizes: effectSizes,
    delta_metric_bins: deltaMetricBins,
    delta_vs_bins: deltaMetricBins.VS ?? [],
    dominance: buildDominanceTable(completed, "APM", "delta_APM"),
    pps_vs_dominance: buildDominanceTable(completed, "PPS", "delta_PPS"),
    model,
    styles: buildStyleSummary(completed),
    styles_recent: buildStyleSummary(recentMatches),
    tr_gap: trGap,
    drawdown,
    streaks: {
      max_win: Math.max(0, ...overallStreak.wins),
      max_loss: Math.max(0, ...overallStreak.losses),
      overall_win_runs: overallStreak.wins,
      overall_loss_runs: overallStreak.losses,
      session_max_win: Math.max(0, ...sessionStreak.wins),
      session_max_loss: Math.max(0, ...sessionStreak.losses),
      session_win_runs: sessionStreak.wins,
      session_loss_runs: sessionStreak.losses,
      win_runs: sessionStreak.wins,
      loss_runs: sessionStreak.losses,
      ...afterResultStats(completed),
    },
    streak_states: buildStreakStates(completed, baseMeans),
    psychology: buildPsychology(completed, eligibleRounds),
    tiebreak: tiebreak.summary,
    session_positions: sessionPositions,
    session_dynamics: buildSessionDynamics(matches, completed),
    excess_by_weekday: excessByWeekday,
    excess_by_hour: excessByHour,
    duration_bins: buildDurationBins(eligibleRounds),
    duration_by_result: buildDurationByResult(eligibleRounds),
    score_states: scoreStates,
    pps_bins: buildPpsBins(completed),
    records,
    rank_journey: buildRankJourney(completed),
    session_decay: buildSessionDecay(completed),
    comeback: buildComeback(eligibleRounds, completed),
    style_matchup_plane: buildStyleMatchupPlane(completed),
    rivals: buildRivals(completed),
    replay_candidates: buildReplayCandidates(completed, eligibleRounds),
  };

  // チャート・表示はDQ(不戦勝・不戦敗)を含む公式勝敗マッチ全体を対象にする。
  return {
    rounds: eligibleRounds,
    matches: completed,
    monthly,
    tiebreakRounds: tiebreak.rows,
    summary,
  };
}

function buildCurrentLeague(summary: LeagueSummaryResult | null): Summary["current_league"] {
  const raw = {
    APM: summary?.raw.apm ?? null,
    PPS: summary?.raw.pps ?? null,
    VS: summary?.raw.vs ?? null,
    TR: summary?.raw.tr ?? null,
    Glicko: summary?.raw.glicko ?? null,
    RD: summary?.raw.rd ?? null,
    gameswon: summary?.raw.gameswon ?? null,
    gamesplayed: summary?.raw.gamesplayed ?? null,
    rank: summary?.raw.rank ?? null,
  };
  const available = raw.APM !== null && raw.PPS !== null && raw.VS !== null;
  const emptyDerived = Object.fromEntries(BASE_PARAM_COLUMNS.map((column) => [column, null])) as Record<string, number | null>;
  if (!available) {
    return {
      source: "summaries/league",
      available: false,
      raw,
      derived: emptyDerived,
    };
  }
  try {
    const derived = calculateParams({
      apm: raw.APM,
      pps: raw.PPS,
      vs: raw.VS,
      rd_before: raw.RD,
      games_won_before: raw.gameswon,
    }) as Record<string, number | null>;
    return {
      source: "summaries/league",
      available: true,
      raw,
      derived: Object.fromEntries(BASE_PARAM_COLUMNS.map((column) => [column, derived[column] ?? null])),
    };
  } catch {
    return {
      source: "summaries/league",
      available: false,
      raw,
      derived: emptyDerived,
    };
  }
}

function metricMeansFor(matches: MatchRow[]): Record<string, Record<string, number | null>> {
  const out: Record<string, Record<string, number | null>> = {};
  const selfDerived = averageParamsOrNull(matches, "", "");
  const opponentDerived = averageParamsOrNull(matches, "opponent_", "opponent_");
  for (const [label, col] of Object.entries(BASE_METRICS)) {
    const opponent = opponentColumn(col);
    const self = aggregateMetricMean(matches, col, selfDerived);
    const opp = opponent ? aggregateMetricMean(matches, opponent, opponentDerived) : null;
    out[label] = {
      self,
      opponent: opp,
      difference: self !== null && opp !== null ? self - opp : null,
    };
  }
  return out;
}

// 表スコープの窓列挙。TABLE_SCOPE_WINDOWSのうち全体未満のもの＋全期間（重複・0を除去）。
function tableWindowSizes(matchCount: number): Array<{ n: number; label: string }> {
  const sizes: number[] = TABLE_SCOPE_WINDOWS.filter((n) => n < matchCount);
  sizes.push(matchCount);
  return sizes
    .filter((n, index, list) => n > 0 && list.indexOf(n) === index)
    .map((n) => ({ n, label: n === matchCount ? "全期間" : `直近${n}マッチ` }));
}

function recentWindows(matches: MatchRow[]): Array<Record<string, unknown>> {
  return tableWindowSizes(matches.length).map(({ n, label }) => {
    const group = matches.slice(-n);
    const expected = group.filter((match) => toNumber(match.expected_win) !== null);
    return {
      label,
      n,
      wins: group.filter((match) => match.won).length,
      actual: groupWinRate(group),
      expected_n: expected.length,
      expected_actual: groupWinRate(expected),
      expected: mean(expected.map((match) => match.expected_win)),
      excess_rate: expectedExcess(expected),
      excess_wins: sumFinite(expected.map((match) => {
        const expectedWin = toNumber(match.expected_win);
        return expectedWin === null ? null : (match.won ? 1 : 0) - expectedWin;
      })),
    };
  });
}

// 成長比較の窓幅: 全体の1/3（最小1、最大300マッチ）。growth / stability / growth_window_n で共通。
function growthWindowN(matchCount: number): number {
  return Math.min(300, Math.max(Math.floor(matchCount / 3), 1));
}

function buildGrowth(matches: MatchRow[]): Record<string, unknown> {
  if (!matches.length) {
    return {};
  }
  const windowN = growthWindowN(matches.length);
  const early = matches.slice(0, windowN);
  const recent = matches.slice(-windowN);
  const earlyDerived = averageParamsOrNull(early, "", "");
  const recentDerived = averageParamsOrNull(recent, "", "");
  const out: Record<string, unknown> = {};
  for (const [label, col] of ABILITY_METRIC_COLUMNS) {
    const earlyMean = aggregateMetricMean(early, col, earlyDerived);
    const recentMean = aggregateMetricMean(recent, col, recentDerived);
    out[label] = {
      early: earlyMean,
      recent: recentMean,
      change: earlyMean !== null && recentMean !== null ? recentMean - earlyMean : null,
      growth_rate: earlyMean !== null && earlyMean !== 0 && recentMean !== null ? recentMean / earlyMean - 1 : null,
    };
  }
  return out;
}

function buildGrowthWindows(matches: MatchRow[]): Array<Record<string, unknown>> {
  return tableWindowSizes(matches.length).map(({ n, label }) => {
    const group = matches.slice(-n);
    const derived = averageParamsOrNull(group, "", "");
    const row: Record<string, unknown> = {
      label,
      n,
    };
    for (const [label, col] of ABILITY_METRIC_COLUMNS) {
      row[label] = aggregateMetricMean(group, col, derived);
    }
    return row;
  });
}

function buildStability(matches: MatchRow[]): Record<string, unknown> {
  if (!matches.length) {
    return {};
  }
  const windowN = growthWindowN(matches.length);
  const early = matches.slice(0, windowN);
  const recent = matches.slice(-windowN);
  const out: Record<string, unknown> = {};
  for (const [label, col] of ABILITY_METRIC_COLUMNS) {
    // 分布・ばらつきの統計は代表平均ではなく、各マッチ時点の行単位値を対象にする。
    const earlyMean = mean(early.map((match) => match[col]));
    const recentMean = mean(recent.map((match) => match[col]));
    const earlyStd = std(early.map((match) => match[col]));
    const recentStd = std(recent.map((match) => match[col]));
    out[label] = {
      early_p10: quantile(early.map((match) => match[col]), 0.1),
      early_p50: quantile(early.map((match) => match[col]), 0.5),
      early_p90: quantile(early.map((match) => match[col]), 0.9),
      recent_p10: quantile(recent.map((match) => match[col]), 0.1),
      recent_p50: quantile(recent.map((match) => match[col]), 0.5),
      recent_p90: quantile(recent.map((match) => match[col]), 0.9),
      early_cv: earlyMean ? (earlyStd ?? 0) / earlyMean : null,
      recent_cv: recentMean ? (recentStd ?? 0) / recentMean : null,
    };
  }
  return out;
}

function effectSizeRows(matches: MatchRow[]): Array<Record<string, unknown>> {
  const metricColumns: Array<[string, string]> = [
    ...ABILITY_METRIC_COLUMNS,
    ...STYLE_ORDER.map((style) => [style, style] as [string, string]),
  ];
  const rows = metricColumns.map(([label, col]) => {
    const won = matches.filter((match) => match.won).map((match) => match[col]);
    const lost = matches.filter((match) => !match.won).map((match) => match[col]);
    return {
      metric: label,
      d: cohensD(won, lost),
      win_mean: mean(won),
      loss_mean: mean(lost),
    };
  });
  rows.sort((a, b) => (toNumber(b.d) ?? -Infinity) - (toNumber(a.d) ?? -Infinity));
  return rows;
}

function buildDeltaMetricBins(matches: MatchRow[]): Record<string, Array<Record<string, unknown>>> {
  const out: Record<string, Array<Record<string, unknown>>> = {};
  for (const [label, key] of [
    ["APM", "delta_APM"],
    ["PPS", "delta_PPS"],
    ["VS", "delta_VS"],
    ["Area", "delta_Area"],
  ] as const) {
    out[label] = buildMetricBins(matches, key, 8, 20);
  }
  return out;
}

function buildMetricBins(matches: MatchRow[], key: string, q = 5, minN = 1): Array<Record<string, unknown>> {
  const validValues = matches.map((match) => toNumber(match[key])).filter((value): value is number => value !== null);
  if (validValues.length < minN) {
    return [];
  }
  const unique = new Set(validValues.map((value) => Number(value.toPrecision(12)))).size;
  const values = matches.map((match) => toNumber(match[key]));
  const bins = quantileBins(values, Math.min(q, unique));
  // Python版のビン行は {label, n, delta_mean, win_rate} のみ（ラベル形式のみ相違）。
  return bins.map((bin) => {
    const group = bin.indices.map((index) => matches[index]).filter((match): match is MatchRow => Boolean(match));
    return {
      label: `${bin.low.toFixed(2)}..${bin.high.toFixed(2)}`,
      n: group.length,
      delta_mean: mean(group.map((match) => match[key])),
      win_rate: groupWinRate(group),
    };
  });
}

function buildMonthly(matches: MatchRow[]): MonthlyRow[] {
  const groups = groupBy(matches, (match) => String(match.month ?? ""));
  const rows: MonthlyRow[] = [];
  for (const [month, group] of groups.entries()) {
    if (!month) {
      continue;
    }
    const trAfter = group.map((match) => toNumber(match.tr_after)).filter((value): value is number => value !== null);
    let runningPeak = -Infinity;
    const drawdowns = trAfter.map((value) => {
      runningPeak = Math.max(runningPeak, value);
      return value - runningPeak;
    });
    const nonDq = group.filter((match) => !match.dq_win && !match.dq_loss);
    const expectedValid = group.filter((match) => toNumber(match.expected_win) !== null);
    rows.push({
      month,
      matches: group.length,
      wins: group.filter((match) => match.won).length,
      losses: group.filter((match) => !match.won).length,
      dq_wins: group.filter((match) => match.dq_win).length,
      dq_losses: group.filter((match) => match.dq_loss).length,
      official_win_rate: groupWinRate(group),
      normal_win_rate: groupWinRate(nonDq),
      expected_win_rate: mean(group.map((match) => match.expected_win)),
      expected_excess_rate: expectedExcess(group),
      // pandasのsum()は全欠損でも0.0を返すため既定値は0。
      expected_excess_wins: expectedValid.length
        ? expectedValid.reduce((sum, match) => sum + ((match.won ? 1 : 0) - (toNumber(match.expected_win) ?? 0)), 0)
        : 0,
      tr_start: firstFinite(group.map((match) => match.tr_before)),
      tr_end: lastFinite(group.map((match) => match.tr_after)),
      tr_change: diffFirstLast(group.map((match) => match.tr_before), group.map((match) => match.tr_after)),
      peak_tr: trAfter.length ? Math.max(...trAfter) : null,
      max_drawdown: drawdowns.length ? Math.min(...drawdowns) : null,
      opponent_tr: mean(group.map((match) => match.opponent_tr_before)),
      tr_diff: mean(group.map((match) => match.tr_diff)),
      sessions: new Set(group.map((match) => match.session_id)).size,
      matches_per_session: group.length / Math.max(new Set(group.map((match) => match.session_id)).size, 1),
      active_days: new Set(group.map((match) => match.date).filter(Boolean)).size,
    });
    const row = rows[rows.length - 1];
    if (row) {
      const derived = averageParamsOrNull(group, "", "");
      for (const [label, col] of [
        ["APM", "apm"],
        ["PPS", "pps"],
        ["VS", "vs"],
        ["APP", "APP"],
        ["Area", "Area"],
        ["VS/APM", "VS/APM"],
        ["DS/S", "DS/Second"],
        ["DS/P", "DS/Piece"],
        ["GbE", "Garbage Effi."],
      ] as const) {
        row[label] = aggregateMetricMean(group, col, derived);
      }
      for (const style of STYLE_ORDER) {
        row[style] = aggregateMetricMean(group, style, derived);
      }
    }
  }
  return rows.sort((a, b) => a.month.localeCompare(b.month));
}

function buildMonthlyChanges(monthly: MonthlyRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (monthly.length < 2) {
    return out;
  }
  for (const metric of ["APM", "PPS", "VS", "APP", "Area"]) {
    let best: { month: string; change: number } | null = null;
    for (let i = 1; i < monthly.length; i += 1) {
      const current = toNumber(monthly[i]?.[metric]);
      const previous = toNumber(monthly[i - 1]?.[metric]);
      if (current === null || previous === null) {
        continue;
      }
      const change = current - previous;
      if (!best || Math.abs(change) > Math.abs(best.change)) {
        best = { month: String(monthly[i]?.month ?? ""), change };
      }
    }
    if (best) {
      out[metric] = best;
    }
  }
  return out;
}

function analyzeTiebreaks(rounds: RoundRow[], matches: MatchRow[]): { rows: TiebreakRow[]; summary: Record<string, unknown> } {
  const byMatch = groupBy(rounds, (round) => Number(round.match_number));
  const rows: TiebreakRow[] = [];
  for (const match of matches) {
    const target = toNumber(match.target_score);
    const opponent = toNumber(match.opponent_score);
    if (target === null || opponent === null || Math.abs(target - opponent) !== 1) {
      continue;
    }
    const group = (byMatch.get(Number(match.match_number)) ?? []).sort((a, b) => Number(a.round) - Number(b.round));
    if (group.length < 2) {
      continue;
    }
    let own = 0;
    let opp = 0;
    const leads: number[] = [];
    for (const round of group.slice(0, -1)) {
      leads.push(own - opp);
      if (round.round_won) {
        own += 1;
      } else {
        opp += 1;
      }
    }
    const penultimate = group[group.length - 2];
    const final = group[group.length - 1];
    if (!penultimate || !final) {
      continue;
    }
    const minLead = leads.length ? Math.min(...leads) : 0;
    const maxLead = leads.length ? Math.max(...leads) : 0;
    const penultimateWon = Boolean(penultimate.round_won);
    const route = minLead <= -2 && penultimateWon
      ? "大差ビハインドから追いついた"
      : maxLead >= 2 && !penultimateWon
        ? "大差リードから追いつかれた"
        : penultimateWon
          ? "追いついた側"
          : "追いつかれた側";
    const row: TiebreakRow = {
      match_number: Number(match.match_number),
      played_at_jst: String(match.played_at_jst ?? ""),
      won: Boolean(match.won),
      expected_win: toNumber(match.expected_win),
      route,
      penultimate_won: penultimateWon,
      min_lead_before_final: minLead,
      max_lead_before_final: maxLead,
      final_lifetime_s: toNumber(final.lifetime_s),
    };
    const previous = group.slice(0, -1);
    const priorDerived = averageParamsOrNull(previous, "", "");
    for (const [label, col] of ABILITY_METRIC_COLUMNS) {
      const finalValue = toNumber(final[col]);
      const priorMean = aggregateMetricMean(previous, col, priorDerived);
      row[`final_${label}`] = finalValue;
      row[`prior_${label}`] = priorMean;
      row[`change_${label}`] = finalValue !== null && priorMean !== null ? finalValue - priorMean : null;
    }
    rows.push(row);
  }
  if (!rows.length) {
    return { rows, summary: { n: 0 } };
  }
  const routeSummary = [...groupBy(rows, (row) => row.route).entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([route, group]) => {
      const routeWins = group.filter((row) => row.won).length;
      const [routeLow, routeHigh] = wilsonInterval(routeWins, group.length);
      return {
        route,
        n: group.length,
        wins: routeWins,
        win_rate: routeWins / group.length,
        expected: mean(group.map((row) => row.expected_win)),
        excess: expectedExcess(group.map((row) => ({ won: row.won, expected_win: row.expected_win }))),
        wilson_low: routeLow,
        wilson_high: routeHigh,
      };
    });
  const routeGroup = (group: TiebreakRow[]) => {
    const groupWins = group.filter((row) => row.won).length;
    return {
      n: group.length,
      wins: groupWins,
      win_rate: group.length ? groupWins / group.length : null,
    };
  };
  const finalChanges = Object.fromEntries(ABILITY_METRIC_COLUMNS.map(([label]) => [
    label,
    mean(rows.map((row) => row[`change_${label}`])),
  ]));
  const wins = rows.filter((row) => row.won).length;
  const [wilsonLow, wilsonHigh] = wilsonInterval(wins, rows.length);
  return {
    rows,
    summary: {
      n: rows.length,
      wins,
      win_rate: wins / rows.length,
      expected: mean(rows.map((row) => row.expected_win)),
      excess: expectedExcess(rows.map((row) => ({ won: row.won, expected_win: row.expected_win }))),
      wilson_low: wilsonLow,
      wilson_high: wilsonHigh,
      caught_up: routeGroup(rows.filter((row) => row.penultimate_won)),
      caught_from: routeGroup(rows.filter((row) => !row.penultimate_won)),
      routes: routeSummary,
      final_changes: finalChanges,
    },
  };
}

function buildScoreStateRounds(rounds: RoundRow[], matches: MatchRow[]): Array<Record<string, unknown>> {
  const states = new Map(SCORE_STATE_ORDER.map((label) => [label, { n: 0, wins: 0, diffSum: 0 }]));
  const byMatch = groupBy(rounds, (round) => Number(round.match_number));
  const add = (label: typeof SCORE_STATE_ORDER[number], won: boolean, diff: number) => {
    const state = states.get(label);
    if (!state) return;
    state.n += 1;
    state.wins += won ? 1 : 0;
    state.diffSum += diff;
  };
  for (const match of matches) {
    const group = (byMatch.get(Number(match.match_number)) ?? []).sort((a, b) => Number(a.round) - Number(b.round));
    const target = toNumber(match.target_score);
    const opponent = toNumber(match.opponent_score);
    const hasMp = target !== null && opponent !== null;
    const threshold = hasMp ? Math.max(target, opponent) : null;
    let own = 0;
    let opp = 0;
    for (const round of group) {
      const diff = own - opp;
      add(diff === 0 ? "同点" : diff > 0 ? "リード時" : "ビハインド時", Boolean(round.round_won), diff);
      if (threshold) {
        const ownMp = own === threshold - 1;
        const oppMp = opp === threshold - 1;
        if (ownMp && oppMp) add("双方MP", Boolean(round.round_won), diff);
        else if (ownMp) add("自分MP", Boolean(round.round_won), diff);
        else if (oppMp) add("相手MP", Boolean(round.round_won), diff);
      }
      if (round.round_won) own += 1;
      else opp += 1;
    }
  }
  return SCORE_STATE_ORDER.map((label) => {
    const state = states.get(label) ?? { n: 0, wins: 0, diffSum: 0 };
    return {
      label,
      n: state.n,
      win_rate: state.n ? state.wins / state.n : null,
      score_diff_mean: state.n ? state.diffSum / state.n : null,
    };
  });
}

function buildTrGap(matches: MatchRow[]): Array<Record<string, unknown>> {
  const edges = [-Infinity, -2000, -1000, -500, 0, 500, 1000, 2000, Infinity];
  const labels = ["≤-2000", "-2000~-1000", "-1000~-500", "-500~0", "0~500", "500~1000", "1000~2000", "≥2000"];
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const low = edges[i] ?? -Infinity;
    const high = edges[i + 1] ?? Infinity;
    const group = matches.filter((match) => {
      const value = toNumber(match.tr_diff);
      return value !== null && value >= low && value < high && toNumber(match.expected_win) !== null;
    });
    if (!group.length) {
      continue;
    }
    rows.push({
      label: labels[i] ?? `${low}~${high}`,
      n: group.length,
      tr_diff: mean(group.map((match) => match.tr_diff)),
      actual: groupWinRate(group),
      expected: mean(group.map((match) => match.expected_win)),
      excess: expectedExcess(group),
    });
  }
  return rows;
}

function buildDrawdownSeries(matches: MatchRow[]): Array<Record<string, unknown>> {
  let peak = -Infinity;
  return matches.map((match) => {
    const tr = toNumber(match.tr_after);
    if (tr !== null) {
      peak = Math.max(peak, tr);
    }
    return {
      match_number: match.match_number,
      date: match.played_at_jst,
      tr,
      drawdown: tr !== null && Number.isFinite(peak) ? tr - peak : null,
    };
  });
}

function buildDrawdownSummary(matches: MatchRow[]): Record<string, unknown> {
  const series = buildDrawdownSeries(matches);
  let minRow: Record<string, unknown> | null = null;
  for (const row of series) {
    const value = toNumber(row.drawdown);
    if (value === null) {
      continue;
    }
    if (!minRow || value < (toNumber(minRow.drawdown) ?? Infinity)) {
      minRow = row;
    }
  }
  return {
    max: minRow?.drawdown ?? null,
    date: minRow?.date ?? null,
  };
}

const SESSION_POSITION_LABELS = [
  "1マッチ目", "2マッチ目", "3マッチ目", "4マッチ目", "5マッチ目",
  "6マッチ目", "7マッチ目", "8マッチ目", "9マッチ目", "10マッチ目",
  "11マッチ目以降",
] as const;

function buildSessionPositions(matches: MatchRow[], base: Record<string, number | null | undefined>): Array<Record<string, unknown>> {
  return SESSION_POSITION_LABELS.map((label) => {
    const group = matches.filter((match) => sessionPositionLabel(match) === label && toNumber(match.expected_win) !== null);
    return {
      label,
      n: group.length,
      actual: groupWinRate(group),
      expected: mean(group.map((match) => match.expected_win)),
      excess: expectedExcess(group),
      d_apm: diffMean(group, "apm", base.apm),
      d_pps: diffMean(group, "pps", base.pps),
      d_vs: diffMean(group, "vs", base.vs),
      d_area: diffMean(group, "Area", base.Area),
    };
  }).filter((row) => row.n > 0);
}

function buildRecords(
  rounds: RoundRow[],
  matches: MatchRow[],
  overallStreak: { wins: number[]; losses: number[] },
  sessionStreak: { wins: number[]; losses: number[] },
  tiebreak: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  const add = (name: string, value: unknown, unit: string, row: MatchRow | RoundRow | null, scope: string, note = "") => {
    records.push({
      name,
      value: value ?? null,
      unit,
      date: row?.played_at_jst ?? null,
      match_id: row?.match_id ?? null,
      opponent: row?.opponent ?? null,
      scope,
      note,
    });
  };

  const bestTr = maxRow(matches, "tr_after");
  if (bestTr) add("最高TR", bestTr.tr_after, "TR", bestTr, "マッチ後");
  const ranked = matches
    .map((match) => ({ match, order: rankOrder(String(match.league_rank_after ?? "")) }))
    .filter((item) => item.order >= 0);
  if (ranked.length) {
    let best = ranked[0]!;
    for (const item of ranked) {
      if (item.order > best.order) {
        best = item;
      }
    }
    add("最高ランク", String(best.match.league_rank_after).toUpperCase(), "ランク", best.match, "マッチ後", "初到達日を表示");
  }
  const trDeltaNote = "初期配置期は能力PRとして解釈しない";
  const maxGain = maxRow(matches, "tr_delta");
  if (maxGain) add("最大1マッチTR増加", maxGain.tr_delta, "TR", maxGain, "単マッチ", trDeltaNote);
  const maxLoss = minRow(matches, "tr_delta");
  if (maxLoss) add("最大1マッチTR減少", maxLoss.tr_delta, "TR", maxLoss, "単マッチ", trDeltaNote);
  const bestBeaten = maxRow(matches.filter((match) => match.won), "opponent_tr_before");
  if (bestBeaten) add("勝利した相手最高TR", bestBeaten.opponent_tr_before, "TR", bestBeaten, "単マッチ", "勝利マッチの対戦前相手TRの最大");

  for (const [col, name, unit] of [
    ["apm", "単マッチ最高APM", "APM"],
    ["pps", "単マッチ最高PPS", "PPS"],
    ["vs", "単マッチ最高VS", "VS"],
    ["APP", "単マッチ最高APP", "APP"],
    ["DS/Second", "単マッチ最高DS/S", "DS/S"],
    ["DS/Piece", "単マッチ最高DS/P", "DS/P"],
    ["Garbage Effi.", "単マッチ最高GbE", "GbE"],
    ["Area", "単マッチ最高Area", "Area"],
    ["VS/APM", "単マッチ最高VS/APM", "VS/APM"],
  ] as const) {
    const row = maxRow(matches, col);
    if (row) add(name, row[col], unit, row, "単マッチ平均");
  }
  const singleRoundNote = "単ラウンドPRは切断・DQ・極短ラウンドの影響を受ける場合があります。";
  for (const [col, name, unit] of [
    ["apm", "単ラウンド最高APM", "APM"],
    ["pps", "単ラウンド最高PPS", "PPS"],
    ["vs", "単ラウンド最高VS", "VS"],
    ["APP", "単ラウンド最高APP", "APP"],
    ["Area", "単ラウンド最高Area", "Area"],
  ] as const) {
    const row = maxRow(rounds, col);
    if (row) add(name, row[col], unit, row, "単ラウンド", singleRoundNote);
  }

  const validShort = rounds.filter((round) => (toNumber(round.lifetime_s) ?? -1) >= 5);
  const shortest = minRow(validShort, "lifetime_s");
  if (shortest) add("最短ラウンド", shortest.lifetime_s, "秒", shortest, "単ラウンド", "5秒未満は切断・DQ等のアーティファクト疑いとして除外。");
  const longest = maxRow(rounds, "lifetime_s");
  if (longest) add("最長ラウンド", longest.lifetime_s, "秒", longest, "単ラウンド");

  const rollingN = 50;
  if (matches.length >= rollingN) {
    let bestValue = -Infinity;
    let bestIndex = -1;
    let windowSum = 0;
    for (let i = 0; i < matches.length; i += 1) {
      windowSum += matches[i]?.won ? 1 : 0;
      if (i >= rollingN) {
        windowSum -= matches[i - rollingN]?.won ? 1 : 0;
      }
      if (i >= rollingN - 1) {
        const value = windowSum / rollingN;
        if (value > bestValue) {
          bestValue = value;
          bestIndex = i;
        }
      }
    }
    const row = matches[bestIndex];
    if (row) add(`連続${rollingN}マッチ最高勝率`, bestValue, "%", row, `${rollingN}マッチ窓`);
  }

  add("最長連勝", Math.max(0, ...overallStreak.wins), "マッチ", null, "全期間の連続勝敗");
  add("最長連敗", Math.max(0, ...overallStreak.losses), "マッチ", null, "全期間の連続勝敗");
  add("セッション内最長連勝", Math.max(0, ...sessionStreak.wins), "マッチ", null, "セッション内連勝・連敗");
  add("セッション内最長連敗", Math.max(0, ...sessionStreak.losses), "マッチ", null, "セッション内連勝・連敗");
  add("タイブレーク勝率", tiebreak.win_rate ?? null, "%", null, "タイブレーク", `n=${tiebreak.n ?? 0}`);
  const caughtUp = (tiebreak.caught_up ?? {}) as Record<string, unknown>;
  const caughtFrom = (tiebreak.caught_from ?? {}) as Record<string, unknown>;
  add("タイブレーク勝率（追い付いたとき）", caughtUp.win_rate ?? null, "%", null, "タイブレーク", `n=${caughtUp.n ?? 0}`);
  add("タイブレーク勝率（追い付かれたとき）", caughtFrom.win_rate ?? null, "%", null, "タイブレーク", `n=${caughtFrom.n ?? 0}`);
  return records;
}

function buildStreakStates(matches: MatchRow[], base: Record<string, number | null>): Array<Record<string, unknown>> {
  const defs: Array<[string, (streak: number) => boolean]> = [
    ["4連勝以上", (streak) => streak >= 4],
    ["3連勝", (streak) => streak === 3],
    ["2連勝", (streak) => streak === 2],
    ["1連勝", (streak) => streak === 1],
    ["初戦", (streak) => streak === 0],
    ["1連敗", (streak) => streak === -1],
    ["2連敗", (streak) => streak === -2],
    ["3連敗", (streak) => streak === -3],
    ["4連敗以上", (streak) => streak <= -4],
  ];
  return defs.map(([label, predicate]) => {
    const group = matches.filter((match) => predicate(toNumber(match.streak_before) ?? 0) && toNumber(match.expected_win) !== null);
    return {
      label,
      n: group.length,
      win_rate: groupWinRate(group),
      excess: expectedExcess(group),
      d_apm: diffMean(group, "apm", base.apm),
      d_pps: diffMean(group, "pps", base.pps),
      d_vs: diffMean(group, "vs", base.vs),
      d_area: diffMean(group, "Area", base.Area),
    };
  }).filter((row) => row.n > 0);
}

function sessionMaxRunLengths(matches: MatchRow[]): { wins: number[]; losses: number[] } {
  const wins: number[] = [];
  const losses: number[] = [];
  for (const group of groupBy(matches, (match) => Number(match.session_id)).values()) {
    const sorted = [...group].sort((a, b) => String(a.played_at_jst ?? "").localeCompare(String(b.played_at_jst ?? "")) || Number(a.match_number) - Number(b.match_number));
    const runs = runLengths(sorted.map((match) => Boolean(match.won)));
    wins.push(Math.max(0, ...runs.wins));
    losses.push(Math.max(0, ...runs.losses));
  }
  return { wins, losses };
}

function buildPsychology(matches: MatchRow[], rounds: RoundRow[]): Record<string, unknown> {
  let comeback02 = 0;
  let comebackTwo = 0;
  const byMatch = groupBy(rounds, (round) => Number(round.match_number));
  for (const match of matches.filter((item) => item.won)) {
    const group = (byMatch.get(Number(match.match_number)) ?? []).sort((a, b) => Number(a.round) - Number(b.round));
    let own = 0;
    let opp = 0;
    let minLead = 0;
    group.forEach((round, index) => {
      if (round.round_won) own += 1;
      else opp += 1;
      const lead = own - opp;
      minLead = Math.min(minLead, lead);
      if (index === 1 && lead === -2) {
        comeback02 += 1;
      }
    });
    if (minLead <= -2) {
      comebackTwo += 1;
    }
  }
  return {
    ...afterResultStats(matches),
    comeback_0_2: comeback02,
    comeback_two_points: comebackTwo,
  };
}

// 直前マッチ結果別の次マッチ成績。streaks と psychology の両方に同じ値を載せる。
function afterResultStats(matches: MatchRow[]): Record<string, number | null> {
  const afterWin = matches.filter((match) => match.previous_won === true);
  const afterLoss = matches.filter((match) => match.previous_won === false);
  const after3Losses = matches.filter((match) => Number(match.streak_before) <= -3);
  return {
    after_win_rate: groupWinRate(afterWin),
    after_win_n: afterWin.length,
    after_loss_rate: groupWinRate(afterLoss),
    after_loss_n: afterLoss.length,
    after_3_losses_rate: groupWinRate(after3Losses),
    after_3_losses_n: after3Losses.length,
  };
}

function buildSessionDynamics(allMatches: MatchRow[], completed: MatchRow[]): Record<string, unknown> {
  const sorted = [...allMatches].sort((a, b) => String(a.played_at_jst ?? "").localeCompare(String(b.played_at_jst ?? "")) || Number(a.match_number) - Number(b.match_number));
  const continued = new Map<number, boolean>();
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (current && next) {
      continued.set(Number(current.match_number), current.session_id === next.session_id);
    }
  }
  const observed = completed.filter((match) => continued.has(Number(match.match_number)));
  const afterWin = observed.filter((match) => match.won);
  const afterLoss = observed.filter((match) => !match.won);
  const lastSessionId = sorted.at(-1)?.session_id;
  const sessionIds = new Set(completed.filter((match) => match.session_id !== lastSessionId).map((match) => match.session_id));
  const closedSessionLast = [...sessionIds].map((id) => completed.filter((match) => match.session_id === id).at(-1)).filter((match): match is MatchRow => Boolean(match));
  return {
    after_win_continue_rate: mean(afterWin.map((match) => continued.get(Number(match.match_number)) ? 1 : 0)),
    after_win_n: afterWin.length,
    after_loss_continue_rate: mean(afterLoss.map((match) => continued.get(Number(match.match_number)) ? 1 : 0)),
    after_loss_n: afterLoss.length,
    session_end_on_loss_rate: groupWinRate(closedSessionLast.map((match) => ({ won: !match.won }))),
    session_end_on_win_rate: groupWinRate(closedSessionLast),
    sessions_closed_n: closedSessionLast.length,
    length_winrate: buildSessionLengthWinrate(completed),
  };
}

function buildDurationBins(rounds: RoundRow[]): Array<Record<string, unknown>> {
  const valid = rounds.filter((round) => toNumber(round.lifetime_s) !== null);
  if (!valid.length) {
    return [];
  }
  const maxObserved = Math.max(30, quantile(valid.map((round) => round.lifetime_s), 0.995) ?? 30);
  const maxDuration = Math.ceil(maxObserved / 30) * 30;
  const rows: Array<Record<string, unknown>> = [];
  for (let start = 0; start <= maxDuration; start += 30) {
    const end = start + 30;
    const isLast = start === maxDuration;
    const group = valid.filter((round) => {
      const value = toNumber(round.lifetime_s);
      return value !== null && value >= start && (isLast ? true : value < end);
    });
    if (!group.length) {
      continue;
    }
    const row: Record<string, unknown> = {
      label: isLast ? `${start}秒以上` : `${start}–${end}秒`,
      n: group.length,
      win_rate: mean(group.map((round) => round.round_won ? 1 : 0)),
      duration_mean: mean(group.map((round) => round.lifetime_s)),
    };
    // Python版は (g[own] - g[opp]).mean() — 行単位差分の平均（両方が揃う行のみ）。
    for (const [label, own, opponent] of roundDeltaPairs()) {
      row[`delta_${label}`] = mean(group.map((round) => {
        const ownValue = toNumber(round[own]);
        const opponentValue = toNumber(round[opponent]);
        return ownValue !== null && opponentValue !== null ? ownValue - opponentValue : null;
      }));
    }
    rows.push(row);
  }
  return rows;
}

function buildDurationByResult(rounds: RoundRow[]): Record<string, unknown> {
  return {
    win: durationStats(rounds.filter((round) => round.round_won)),
    loss: durationStats(rounds.filter((round) => !round.round_won)),
  };
}

function buildSessionDecay(matches: MatchRow[]): Array<Record<string, unknown>> {
  // Python版: n・勝率・能力指標はビン内全マッチ、期待・超過は期待勝率のあるマッチ。
  return SESSION_POSITION_LABELS.map((label) => {
    const group = matches.filter((match) => sessionPositionLabel(match) === label);
    return {
      label,
      n: group.length,
      win_rate: groupWinRate(group),
      expected: mean(group.map((match) => match.expected_win)),
      excess: expectedExcess(group),
      apm: mean(group.map((match) => match.apm)),
      pps: mean(group.map((match) => match.pps)),
      vs: mean(group.map((match) => match.vs)),
      area: mean(group.map((match) => match.Area)),
    };
  }).filter((row) => row.n > 0);
}

function buildComeback(rounds: RoundRow[], matches: MatchRow[]): Record<string, unknown> {
  const byMatch = groupBy(rounds, (round) => Number(round.match_number));
  const firstWonIds: number[] = [];
  const firstLostIds: number[] = [];
  const deficitBuckets = new Map<number, boolean[]>([[1, []], [2, []], [3, []], [4, []]]);
  const reverseSweeps: Array<Record<string, unknown>> = [];
  for (const match of matches) {
    const group = (byMatch.get(Number(match.match_number)) ?? []).sort((a, b) => Number(a.round) - Number(b.round));
    const first = group[0];
    if (!first) {
      continue;
    }
    (first.round_won ? firstWonIds : firstLostIds).push(Number(match.match_number));
    let own = 0;
    let opponent = 0;
    let minLead = 0;
    for (const round of group) {
      if (round.round_won) own += 1;
      else opponent += 1;
      minLead = Math.min(minLead, own - opponent);
    }
    const maxDeficit = -minLead;
    if (maxDeficit >= 1) {
      deficitBuckets.get(Math.min(maxDeficit, 4))?.push(Boolean(match.won));
    }
    if (maxDeficit >= 2 && match.won) {
      reverseSweeps.push({
        match_id: match.match_id,
        opponent: match.opponent,
        date: match.played_at_jst,
        max_deficit: maxDeficit,
      });
    }
  }
  const groupByIds = (ids: number[]) => {
    const idSet = new Set(ids);
    const group = matches.filter((match) => idSet.has(Number(match.match_number)));
    return {
      n: group.length,
      win_rate: groupWinRate(group),
      expected: mean(group.map((match) => match.expected_win)),
      excess: expectedExcess(group),
    };
  };
  return {
    by_first_round: {
      won_first: groupByIds(firstWonIds),
      lost_first: groupByIds(firstLostIds),
    },
    by_max_deficit: [...deficitBuckets.entries()].map(([deficit, values]) => ({
      deficit: deficit === 4 ? "4点以上" : `${deficit}点`,
      n: values.length,
      win_rate: values.length ? values.filter(Boolean).length / values.length : null,
    })),
    reverse_sweeps_n: reverseSweeps.length,
    reverse_sweeps: reverseSweeps.slice(-10),
  };
}

function buildStyleMatchupPlane(matches: MatchRow[]): Record<string, unknown> {
  const valid = matches.filter((match) => toNumber(match["opponent_Stride - Plonk"]) !== null && toNumber(match["opponent_Opener - Inf DS"]) !== null);
  // Python版は標本30未満では空のまま（第12章の平面は出さない）。
  if (valid.length < STYLE_PLANE_MIN_MATCHES) {
    return {};
  }
  return {
    n: valid.length,
    quadrants: STYLE_QUADRANTS.map(([label, predicate]) => {
      const group = valid.filter((match) => predicate(match) && toNumber(match.expected_win) !== null);
      return {
        label,
        n: group.length,
        actual: groupWinRate(group),
        expected: mean(group.map((match) => match.expected_win)),
        excess: expectedExcess(group),
        win_rate: groupWinRate(group),
        all_n: valid.filter(predicate).length,
      };
    }),
    self_pos: {
      x: mean(matches.map((match) => match["Stride - Plonk"])),
      y: mean(matches.map((match) => match["Opener - Inf DS"])),
    },
    axis_labels: { x: "Plonk ←→ Stride", y: "Inf DS ←→ Opener" },
  };
}

function buildRivals(matches: MatchRow[]): Array<Record<string, unknown>> {
  const groups = groupBy(matches, (match) => String(match.opponent_id || match.opponent || ""));
  return [...groups.entries()]
    .filter(([opponent]) => Boolean(opponent.trim()))
    .map(([opponent, group]) => {
      const wins = group.filter((match) => match.won).length;
      const label = String(group.find((match) => match.opponent)?.opponent ?? opponent);
      const opponentId = String(group.find((match) => match.opponent_id)?.opponent_id ?? opponent);
      return {
        opponent: label,
        opponent_id: opponentId,
        label,
        n: group.length,
        wins,
        losses: group.length - wins,
        win_rate: groupWinRate(group),
        last_played: group.map((match) => String(match.played_at_jst ?? "")).sort().at(-1) ?? null,
      };
    })
    .sort((a, b) => Number(b.n) - Number(a.n) || Number(b.wins) - Number(a.wins))
    .slice(0, 20);
}

function buildDominanceTable(matches: MatchRow[], metricLabel: string, deltaCol: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const metricAdv of [false, true]) {
    for (const vsAdv of [false, true]) {
      const group = matches.filter((match) => {
        const metricDelta = toNumber(match[deltaCol]);
        const vsDelta = toNumber(match.delta_VS);
        return metricDelta !== null && vsDelta !== null && (metricDelta >= 0) === metricAdv && (vsDelta >= 0) === vsAdv;
      });
      const stats = expectedGroup(group);
      rows.push({
        metric: metricLabel,
        metric_adv: metricAdv,
        vs_adv: vsAdv,
        label: `${metricLabel}${metricAdv ? "優位" : "劣位"}・VS${vsAdv ? "優位" : "劣位"}`,
        win_rate: stats.actual,
        ...stats,
      });
    }
  }
  return rows;
}

function buildStyleSummary(matches: MatchRow[]): Record<string, unknown> {
  const selfDerived = averageParamsOrNull(matches, "", "");
  const opponentDerived = averageParamsOrNull(matches, "opponent_", "opponent_");
  const means = Object.fromEntries(STYLE_ORDER.map((style) => [
    style,
    {
      self: aggregateMetricMean(matches, style, selfDerived),
      opponent: aggregateMetricMean(matches, `opponent_${style}`, opponentDerived),
    },
  ]));
  const representative = STYLE_ORDER.reduce<string>((best, style) => {
    const bestMean = toNumber((means as Record<string, { self: number | null }>)[best]?.self) ?? -Infinity;
    const value = toNumber((means as Record<string, { self: number | null }>)[style]?.self) ?? -Infinity;
    return value > bestMean ? style : best;
  }, STYLE_ORDER[0]);
  const matchups: Array<Record<string, unknown>> = [];
  for (const own of STYLE_ORDER) {
    for (const opponent of STYLE_ORDER) {
      const group = matches.filter((match) => match.self_style === own && match.opponent_style === opponent && toNumber(match.expected_win) !== null);
      matchups.push({
        self_style: own,
        opponent_style: opponent,
        n: group.length,
        actual: groupWinRate(group),
        expected: mean(group.map((match) => match.expected_win)),
        excess: expectedExcess(group),
      });
    }
  }
  return { means, representative, matchups };
}

function buildExcessBreakdown(
  matches: MatchRow[],
  key: string,
  defs: Array<[string | number, string]>,
  base: Record<string, number | null | undefined>,
): Array<Record<string, unknown>> {
  return defs.map(([value, label]) => {
    const group = matches.filter((match) => {
      if (key === "__hour_band") {
        return hourBand(toNumber(match.hour)) === value;
      }
      return match[key] === value;
    }).filter((match) => toNumber(match.expected_win) !== null);
    return {
      label,
      n: group.length,
      actual: groupWinRate(group),
      expected: mean(group.map((match) => match.expected_win)),
      excess: expectedExcess(group),
      d_apm: diffMean(group, "apm", base.apm),
      d_pps: diffMean(group, "pps", base.pps),
      d_vs: diffMean(group, "vs", base.vs),
      d_area: diffMean(group, "Area", base.Area),
    };
  }).filter((row) => row.n > 0);
}

function buildPpsBins(matches: MatchRow[]): Array<Record<string, unknown>> {
  return quantileBins(matches.map((match) => toNumber(match.pps)), 6).map((bin) => {
    const group = bin.indices.map((index) => matches[index]).filter((match): match is MatchRow => Boolean(match));
    const derived = averageParamsOrNull(group, "", "");
    return {
      label: `${bin.low.toFixed(2)}..${bin.high.toFixed(2)}`,
      n: group.length,
      pps: mean(group.map((match) => match.pps)),
      APP: aggregateMetricMean(group, "APP", derived),
      GbE: aggregateMetricMean(group, "Garbage Effi.", derived),
      Area: aggregateMetricMean(group, "Area", derived),
      win_rate: groupWinRate(group),
      expected: mean(group.map((match) => match.expected_win)),
    };
  });
}

function buildRankJourney(matches: MatchRow[]): Record<string, unknown> {
  const transitions: Array<Record<string, unknown>> = [];
  let previous: string | null = null;
  for (const match of matches) {
    const current = String(match.league_rank_after ?? "").trim();
    if (!current) {
      continue;
    }
    if (previous && current !== previous) {
      transitions.push({
        date: match.played_at_jst,
        from: previous,
        to: current,
        direction: rankOrder(current) > rankOrder(previous) ? "up" : "down",
        tr_after: match.tr_after,
      });
    }
    previous = current;
  }
  return { transitions, current: previous };
}

function buildSessionLengthWinrate(matches: MatchRow[]): Array<Record<string, unknown>> {
  const defs: Array<[string, (match: MatchRow) => boolean]> = [
    ["1-3マッチ", (match) => Number(match.session_size) >= 1 && Number(match.session_size) <= 3],
    ["4-7マッチ", (match) => Number(match.session_size) >= 4 && Number(match.session_size) <= 7],
    ["8マッチ以上", (match) => Number(match.session_size) >= 8],
  ];
  return defs.map(([label, predicate]) => {
    const group = matches.filter(predicate).filter((match) => toNumber(match.expected_win) !== null);
    return {
      label,
      sessions: new Set(group.map((match) => match.session_id)).size,
      n: group.length,
      win_rate: groupWinRate(group),
      expected: mean(group.map((match) => match.expected_win)),
      excess: expectedExcess(group),
    };
  }).filter((row) => row.n > 0);
}

function baseMetricMeans(matches: MatchRow[]): Record<string, number | null> {
  const derived = averageParamsOrNull(matches, "", "");
  return {
    apm: mean(matches.map((match) => match.apm)),
    pps: mean(matches.map((match) => match.pps)),
    vs: mean(matches.map((match) => match.vs)),
    Area: aggregateMetricMean(matches, "Area", derived),
  };
}

function expectedGroup(group: MatchRow[]): Record<string, unknown> {
  const eligible = group.filter((match) => toNumber(match.expected_win) !== null);
  return {
    n: eligible.length,
    actual: groupWinRate(eligible),
    expected: mean(eligible.map((match) => match.expected_win)),
    excess: expectedExcess(eligible),
    all_n: group.length,
  };
}

function roundDeltaPairs(): Array<[string, string, string]> {
  return [
    ...ABILITY_METRIC_COLUMNS.map(([label, col]) =>
      [label, col, OPPONENT_COLUMN[col] ?? `opponent_${col}`] as [string, string, string]),
    ...STYLE_ORDER.map((style) => [style, style, `opponent_${style}`] as [string, string, string]),
  ];
}

function durationStats(rounds: RoundRow[]): Record<string, number | null> {
  const values = rounds.map((round) => toNumber(round.lifetime_s)).filter((value): value is number => value !== null);
  return {
    n: values.length,
    mean: mean(values),
    median: quantile(values, 0.5),
    p75: quantile(values, 0.75),
  };
}

function diffMean(group: MatchRow[], key: string, base: number | null | undefined): number | null {
  const value = aggregateMetricMean(group, key, averageParamsOrNull(group, "", ""));
  return value !== null && base != null ? value - base : null;
}

function sessionPositionLabel(match: MatchRow): string {
  const position = Number(match.session_position);
  return position >= 11 ? "11マッチ目以降" : `${position}マッチ目`;
}

function hourBand(hour: number | null): string | null {
  if (hour === null) return null;
  if (hour < 4) return "0–3時";
  if (hour < 8) return "4–7時";
  if (hour < 12) return "8–11時";
  if (hour < 16) return "12–15時";
  if (hour < 20) return "16–19時";
  return "20–23時";
}

function rankOrder(rank: string): number {
  return (RANK_ORDER as readonly string[]).indexOf(rank.trim().toLowerCase());
}

function opponentColumn(col: string): string {
  return OPPONENT_COLUMN[col] ?? `opponent_${col}`;
}

function averageParamsOrNull(rows: DataRow[], sourcePrefix: string, outputPrefix: string): Record<string, number | null> {
  try {
    return calculateAverageParams(rows, undefined, undefined, sourcePrefix, outputPrefix) as Record<string, number | null>;
  } catch {
    return Object.fromEntries(BASE_PARAM_COLUMNS.map((column) => [`${outputPrefix}${column}`, null]));
  }
}

function aggregateMetricMean(
  rows: DataRow[],
  column: string,
  derived: Record<string, number | null>,
): number | null {
  if (column in derived) {
    return derived[column] ?? null;
  }
  return mean(rows.map((row) => row[column]));
}

function sumFinite(values: unknown[]): number | null {
  const xs = values.map(toNumber).filter((value): value is number => value !== null);
  return xs.length ? xs.reduce((sum, value) => sum + value, 0) : null;
}

function firstFinite(values: unknown[]): number | null {
  return values.map(toNumber).find((value) => value !== null) ?? null;
}

function lastFinite(values: unknown[]): number | null {
  return values.map(toNumber).filter((value): value is number => value !== null).at(-1) ?? null;
}

function diffFirstLast(firstValues: unknown[], lastValues: unknown[]): number | null {
  const first = firstFinite(firstValues);
  const last = lastFinite(lastValues);
  return first !== null && last !== null ? last - first : null;
}

function maxRow<T extends Record<string, unknown>>(rows: T[], key: string): T | null {
  return extremumRow(rows, key, "max");
}

function minRow<T extends Record<string, unknown>>(rows: T[], key: string): T | null {
  return extremumRow(rows, key, "min");
}

function extremumRow<T extends Record<string, unknown>>(rows: T[], key: string, mode: "max" | "min"): T | null {
  let best: T | null = null;
  let bestValue = mode === "max" ? -Infinity : Infinity;
  for (const row of rows) {
    const value = toNumber(row[key]);
    if (value === null) continue;
    if ((mode === "max" && value > bestValue) || (mode === "min" && value < bestValue)) {
      best = row;
      bestValue = value;
    }
  }
  return best;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}


