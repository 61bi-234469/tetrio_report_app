import type { AnalysisBundle } from "../analysis/types";
import type { Anonymizer } from "../render/anonymize";
import { quantile, rollingMean } from "../analysis/stats";
import { BASE_PARAM_COLUMNS, calculateAverageParams } from "../params";
import {
  EXPECTED_COLOR,
  LOSS_COLOR,
  METRIC_COLORS,
  NEUTRAL_BAR_COLOR,
  PRIMARY_COLOR,
  SERIES_COLORS,
  STYLE_COLORS,
  WIN_COLOR,
  alphaColor,
  winRateColor,
} from "./palette";

export interface ChartConfig {
  type: "line" | "bar" | "radar" | "scatter";
  data: {
    labels?: Array<string | number>;
    datasets: Array<Record<string, unknown>>;
  };
  options?: Record<string, unknown>;
}

export const CHART_IDS = [
  "01_tr_history",
  "02_metric_distributions",
  "03_capability_radar",
  "04_playstyle_radar",
  "05_monthly_normalized_trends",
  "05_monthly_normalized_trends_ds",
  "05_monthly_normalized_trends_attack",
  "05_monthly_normalized_trends_cheese",
  "05_monthly_normalized_trends_rating",
  "07_tr_monthly_stability",
  "08_relative_effect_sizes",
  "09_delta_metric_winrate",
  "10_apm_vs_dominance_scatter",
  "11_pps_vs_dominance_scatter",
  "12_tr_gap_expected_vs_actual",
  "13_tr_drawdown",
  "14_streak_distribution",
  "15_tiebreak_analysis",
  "16_session_position",
  "17_round_duration",
  "18_score_state_next_round",
  "19_duration_metric_deltas",
  "20_playstyle_trend",
  "21_excess_weekday",
  "22_excess_hour",
  "25_style_matchup_plane",
  "27_rivals",
  "28_comeback",
  "29_session_decay",
] as const;

export type ChartId = (typeof CHART_IDS)[number];

// 第3章・第4章で扱う能力指標（render/chapters.ts ABILITY_METRICS と同一順）。
const ABILITY_METRIC_LABELS = [
  "APM", "PPS", "VS", "APP", "DS/Second", "DS/Piece", "APP+DS/Piece",
  "VS/APM", "Cheese Index", "Garbage Eff.", "Area", "Est. TR",
];
// マッチ行の対応カラム（enrich.ts BASE_METRICS と同一対応）。
const ABILITY_METRIC_COLUMNS: Record<string, string> = {
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
  "Est. TR": "Est. TR",
};
// Python版 03_capability_radar と同じ10軸。
const RADAR_LABELS = [
  "APM", "PPS", "VS", "APP", "DS/Second", "DS/Piece", "APP+DS/Piece",
  "VS/APM", "Cheese Index", "Garbage Eff.",
];
const TREND_GROUPS: Array<[ChartId, string, string[]]> = [
  ["05_monthly_normalized_trends", "APM / PPS / VS / VS/APM", ["VS/APM", "APM", "PPS", "VS"]],
  ["05_monthly_normalized_trends_ds", "DS/Second / DS/Piece", ["DS/Second", "DS/Piece"]],
  ["05_monthly_normalized_trends_attack", "APP / APP+DS/Piece / Garbage Eff.", ["APP", "APP+DS/Piece", "Garbage Eff."]],
  ["05_monthly_normalized_trends_cheese", "Cheese Index", ["Cheese Index"]],
  ["05_monthly_normalized_trends_rating", "Area / Est. TR", ["Area", "Est. TR"]],
];
const ROLLING_WINDOW = 10;

export function buildChartConfigs(bundle: AnalysisBundle, anon: Anonymizer): Record<ChartId, ChartConfig> {
  const { matches, monthly, summary } = bundle;
  const dateLabels = matches.map((match) => String(match.played_at_jst ?? "").slice(0, 10));
  const configs = Object.fromEntries(CHART_IDS.map((id) => [id, emptyChart(id)])) as Record<ChartId, ChartConfig>;

  // 01: TR推移（TR実線・Est. TRローリング平均・ランク変化マーカー）。
  configs["01_tr_history"] = buildTrHistory(matches, dateLabels);

  // 02: 主要指標の分布（相手中央値=100、P10-P90範囲と中央値）。
  configs["02_metric_distributions"] = buildMetricBalance(matches);

  // 03: 能力レーダー（各軸を自分・相手平均の絶対値最大で正規化、Python版と同じ10軸）。
  configs["03_capability_radar"] = buildCapabilityRadar(summary.metrics_recent as Record<string, Record<string, unknown>>);

  // 04: 4プレイスタイル（自分と相手平均）。
  const styleMeans = ((summary.styles_recent as Record<string, unknown>).means ?? {}) as Record<string, Record<string, unknown>>;
  configs["04_playstyle_radar"] = buildStyleRadar(styleMeans);

  // 05: 指標推移（初期ローリング平均=100の指数、Python版と同じ5グループ）。
  for (const [id, title, metrics] of TREND_GROUPS) {
    configs[id] = buildNormalizedTrendGroup(matches, dateLabels, title, metrics);
  }

  // 07: マッチ単位TRの分位帯（P10/P50/P90、Python版 07 と同じ）。
  configs["07_tr_monthly_stability"] = buildMonthlyTrBand(matches);

  // 08: 効果量（降順ソート・符号色分け・0基準線）。
  configs["08_relative_effect_sizes"] = buildEffectSizes(summary.effect_sizes as Array<Record<string, unknown>>);

  // 09: 相対差ビン別勝率（%軸・50%基準線・nはツールチップ）。
  const deltaBins = summary.delta_metric_bins as Record<string, Array<Record<string, unknown>>>;
  configs["09_delta_metric_winrate"] = deltaMetricChart(deltaBins);

  // 10/11: 相対優位の散布図（本文どおり自分−相手の差、0基準線つき）。
  configs["10_apm_vs_dominance_scatter"] = scatterByResult(
    matches.map((match) => ({ x: match.delta_APM, y: match.delta_VS, won: match.won })),
    "自分APM − 相手APM",
    "自分VS − 相手VS",
  );
  configs["11_pps_vs_dominance_scatter"] = scatterByResult(
    matches.map((match) => ({ x: match.delta_PPS, y: match.delta_VS, won: match.won })),
    "自分PPS − 相手PPS",
    "自分VS − 相手VS",
  );

  // 12: TR差帯別の実績 vs 期待（%軸・50%基準線）。
  const trGap = summary.tr_gap as Array<Record<string, unknown>>;
  configs["12_tr_gap_expected_vs_actual"] = withRefLines({
    type: "line",
    data: {
      labels: trGap.map((row) => String(row.label ?? labelRange(row))),
      datasets: [
        { ...lineDataset("実績勝率", trGap.map((row) => pctOrNull(row.actual)), WIN_COLOR), pointRadius: 3, $unit: "%", $notes: nNotes(trGap) },
        { ...lineDataset("期待勝率", trGap.map((row) => pctOrNull(row.expected)), EXPECTED_COLOR), pointRadius: 3, borderDash: [6, 4], $unit: "%", $notes: nNotes(trGap) },
      ],
    },
    options: baseOptions({ x: axis("自分TR − 相手TR"), y: pctAxis("勝率（%）") }),
  }, [{ y: 50 }]);

  // 13: TRドローダウン（0基準・面塗り）。
  const drawdown = buildDrawdownSeries(matches);
  configs["13_tr_drawdown"] = withRefLines({
    type: "line",
    data: {
      labels: dateLabels,
      datasets: [{
        ...lineDataset("ドローダウン", drawdown, LOSS_COLOR),
        fill: { target: { value: 0 } },
        backgroundColor: alphaColor(LOSS_COLOR, 0.16),
        borderWidth: 1.4,
      }],
    },
    options: baseOptions({ x: dateAxis(), y: axis("TR差（過去ピーク比）") }),
  }, [{ y: 0, color: "#991b1b", dash: [] }]);

  // 14: セッションごとの最大連勝・最大連敗分布（1〜9、10以上）。
  configs["14_streak_distribution"] = buildStreakDistribution(summary.streaks as Record<string, unknown>);

  // 15: タイブレーク到達経路別の実績 vs 期待（%軸・50%基準線）。
  configs["15_tiebreak_analysis"] = buildTiebreak(summary.tiebreak as Record<string, unknown>);

  // 16: セッション内マッチ位置別の実績 vs 期待（グループ棒、Python版と同形）。
  const sessionPositions = summary.session_positions as Array<Record<string, unknown>>;
  configs["16_session_position"] = actualVsExpectedBars(
    sessionPositions.map((row) => String(row.label)),
    sessionPositions,
    "セッション内のマッチ位置",
  );

  // 17: 決着時間帯別のラウンド勝率（線・左軸%）と標本数（棒・右軸）。
  configs["17_round_duration"] = buildDurationWinRate(summary.duration_bins as Array<Record<string, unknown>>);

  // 18: 開始前スコア状況別ラウンド勝率（状況で色分け）。
  configs["18_score_state_next_round"] = buildScoreStates(summary.score_states as Array<Record<string, unknown>>);

  // 19: 決着時間帯別の能力差分（ΔPPSのみ右軸、0基準線）。
  configs["19_duration_metric_deltas"] = buildDurationDeltas(summary.duration_bins as Array<Record<string, unknown>>);

  // 20: 4スタイル推移（Python版と同じスタイル色）。
  configs["20_playstyle_trend"] = {
    type: "line",
    data: {
      labels: dateLabels,
      datasets: Object.entries(STYLE_COLORS).map(([style, color]) =>
        lineDataset(style, rollingParamColumnMean(matches, style, 20), color)),
    },
    options: baseOptions({ x: dateAxis(), y: axis("スタイル傾向（20マッチ平均）") }),
  };

  // 21/22: 曜日・時間帯別の実績 vs 期待。
  const excessWeekday = summary.excess_by_weekday as Array<Record<string, unknown>>;
  configs["21_excess_weekday"] = actualVsExpectedBars(excessWeekday.map((row) => String(row.label)), excessWeekday, "曜日");
  const excessHour = summary.excess_by_hour as Array<Record<string, unknown>>;
  configs["22_excess_hour"] = actualVsExpectedBars(excessHour.map((row) => String(row.label)), excessHour, "時間帯（JST）");

  // 25: プレイスタイル相性マップ（自分の平均位置マーカーつき）。
  const stylePlane = summary.style_matchup_plane as Record<string, unknown>;
  if (Array.isArray(stylePlane.quadrants) && stylePlane.quadrants.length > 0) {
    configs["25_style_matchup_plane"] = buildStylePlane(matches, stylePlane);
  }

  // 27: ライバル（勝率で赤→緑に塗り分け、ラベルに遭遇回数）。
  configs["27_rivals"] = buildRivals(summary.rivals as Array<Record<string, unknown>>, anon);

  // 28: 最大ビハインド別のマッチ勝率。
  configs["28_comeback"] = buildComeback(summary.comeback as Record<string, unknown>);

  // 29: セッション内の失速曲線（勝率棒＋1マッチ目=100の能力4本線）。
  configs["29_session_decay"] = buildSessionDecay(summary.session_decay as Array<Record<string, unknown>>);

  return configs;
}

function buildTrHistory(matches: AnalysisBundle["matches"], dateLabels: string[]): ChartConfig {
  const trSeries = matches.map((match) => numberOrNull(match.tr_after));
  const estTr = rollingParamColumnMean(matches, "Est. TR", ROLLING_WINDOW);
  const rankPoints: Array<number | null> = matches.map(() => null);
  const rankLabels: Array<string | null> = matches.map(() => null);
  let previousRank = "";
  matches.forEach((match, index) => {
    const rank = String(match.league_rank_after ?? "").trim();
    if (!rank) {
      return;
    }
    if (previousRank && rank !== previousRank) {
      rankPoints[index] = numberOrNull(match.tr_after);
      rankLabels[index] = rank.toUpperCase();
    }
    previousRank = rank;
  });
  const datasets: Array<Record<string, unknown>> = [
    { ...lineDataset("TR", trSeries, "#f97316"), borderWidth: 1.8 },
  ];
  if (estTr.some((value) => value !== null)) {
    datasets.push({
      ...lineDataset(`Est. TR（${ROLLING_WINDOW}マッチ平均）`, estTr, "#38bdf8"),
      borderWidth: 1.2,
    });
  }
  if (rankPoints.some((value) => value !== null)) {
    datasets.push({
      type: "line",
      label: "ランク変化",
      data: rankPoints,
      showLine: false,
      pointRadius: 5,
      pointHoverRadius: 7,
      pointStyle: "rectRot",
      borderColor: "#7c3aed",
      backgroundColor: "#7c3aed",
      spanGaps: false,
      $pointLabels: rankLabels,
      $notes: rankLabels.map((label) => (label ? `新ランク ${label}` : null)),
    });
  }
  return {
    type: "line",
    data: { labels: dateLabels, datasets },
    options: baseOptions({ x: dateAxis(), y: axis("TR") }),
  };
}

function buildMetricBalance(matches: AnalysisBundle["matches"]): ChartConfig {
  const rows = ABILITY_METRIC_LABELS
    .map((label) => {
      const selfColumn = ABILITY_METRIC_COLUMNS[label]!;
      const opponentColumn = opponentMetricColumn(label, selfColumn);
      const self = distributionStats(matches.map((match) => match[selfColumn]));
      const opponent = distributionStats(matches.map((match) => match[opponentColumn]));
      if (self === null || opponent === null) {
        return null;
      }
      const baseline = Math.abs(opponent.p50) > 0 ? Math.abs(opponent.p50) : Math.max(Math.abs(self.p50), 1);
      const scale = (value: number) => round2((value / baseline) * 100);
      return {
        label,
        selfRange: [scale(self.p10), scale(self.p90)],
        selfMedian: scale(self.p50),
        opponentRange: [scale(opponent.p10), scale(opponent.p90)],
      };
    })
    .filter((row): row is {
      label: string;
      selfRange: [number, number];
      selfMedian: number;
      opponentRange: [number, number];
    } => row !== null);
  // 自分と相手の帯を同じ行中心に重ね書きし、中央値マーカーと帯の位置を揃える。
  return withRefLines({
    type: "bar",
    data: {
      labels: rows.map((row) => row.label),
      datasets: [
        {
          label: "自分 P10-P90",
          data: rows.map((row) => row.selfRange),
          backgroundColor: alphaColor(PRIMARY_COLOR, 0.24),
          borderColor: alphaColor(PRIMARY_COLOR, 0.85),
          borderWidth: 1,
          borderSkipped: false,
          borderRadius: 3,
          grouped: false,
          barPercentage: 0.78,
          categoryPercentage: 0.86,
          order: 3,
        },
        {
          label: "相手 P10-P90",
          data: rows.map((row) => row.opponentRange),
          backgroundColor: alphaColor(EXPECTED_COLOR, 0.42),
          borderColor: EXPECTED_COLOR,
          borderWidth: 1,
          borderSkipped: false,
          borderRadius: 2,
          grouped: false,
          barPercentage: 0.3,
          categoryPercentage: 0.86,
          order: 2,
        },
        // 相手中央値はスケール定義上つねに100（基準線と一致）のためデータセットにしない。
        {
          type: "line",
          label: "自分中央値",
          data: rows.map((row) => row.selfMedian),
          showLine: false,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointStyle: "rectRot",
          borderColor: PRIMARY_COLOR,
          backgroundColor: "#ffffff",
          pointBorderWidth: 2,
          order: 0,
        },
      ],
    },
    options: {
      ...baseOptions({
        x: axis("指標内スケール（相手中央値=100）"),
        y: axis(undefined, { grid: { display: false } }),
      }),
      indexAxis: "y",
      $tall: true,
    },
  }, [{ x: 100, color: "#64748b", dash: [4, 4] }]);
}

function buildCapabilityRadar(metricsRecent: Record<string, Record<string, unknown>>): ChartConfig {
  const self = RADAR_LABELS.map((label) => numberOrNull(metricsRecent[label]?.self));
  const opponent = RADAR_LABELS.map((label) => numberOrNull(metricsRecent[label]?.opponent));
  const normalize = (values: Array<number | null>): Array<number | null> =>
    values.map((value, index) => {
      const denom = Math.max(Math.abs(self[index] ?? 0), Math.abs(opponent[index] ?? 0)) || 1;
      return value === null ? null : round2(value / denom);
    });
  return signedRadarConfig(RADAR_LABELS, normalize(self), normalize(opponent), 1.05);
}

function buildStyleRadar(styleMeans: Record<string, Record<string, unknown>>): ChartConfig {
  const labels = Object.keys(STYLE_COLORS);
  const self = labels.map((key) => numberOrNull(styleMeans[key]?.self));
  const opponent = labels.map((key) => numberOrNull(styleMeans[key]?.opponent));
  const radialMax = Math.max(0.8, maxFinite([...self, ...opponent]) * 1.15);
  return signedRadarConfig(labels, self, opponent, radialMax);
}

function signedRadarConfig(labels: string[], self: Array<number | null>, opponent: Array<number | null>, radialMax: number): ChartConfig {
  const limit = Math.max(radialMax, maxAbsFinite([...self, ...opponent]) * 1.1, 0.000001);
  return {
    type: "line",
    data: {
      datasets: [
        signedRadarDataset("自分", labels, self, PRIMARY_COLOR, 0.16),
        signedRadarDataset("相手平均", labels, opponent, EXPECTED_COLOR, 0.08, true),
      ],
    },
    options: signedRadarOptions(labels, limit),
  };
}

function signedRadarDataset(label: string, labels: string[], values: Array<number | null>, color: string, fillAlpha: number, dashed = false): Record<string, unknown> {
  const points = signedRadarPoints(values);
  return {
    type: "line",
    label,
    data: points,
    borderColor: color,
    backgroundColor: alphaColor(color, fillAlpha),
    borderWidth: dashed ? 1.8 : 2.6,
    borderDash: dashed ? [5, 4] : [],
    pointRadius: dashed ? 3 : 4,
    pointHoverRadius: dashed ? 5.5 : 6.5,
    pointBackgroundColor: "#ffffff",
    pointBorderColor: color,
    pointBorderWidth: dashed ? 1.4 : 1.8,
    fill: true,
    tension: 0,
    spanGaps: true,
    $radarValues: closeArray(values),
    $radarLabels: closeArray(labels),
    // レンダラ側で中心→外周の放射グラデーション塗りに置き換えるための基準色。
    $fillColor: color,
    $fillAlpha: fillAlpha,
  };
}

function signedRadarPoints(values: Array<number | null>): Array<{ x: number | null; y: number | null }> {
  const n = values.length;
  return closeArray(values).map((value, index) => {
    if (value === null || n === 0) {
      return { x: null, y: null };
    }
    const angle = Math.PI / 2 - ((index % n) * 2 * Math.PI) / n;
    return {
      x: round2(value * Math.cos(angle)),
      y: round2(value * Math.sin(angle)),
    };
  });
}

function signedRadarOptions(labels: string[], radialMax: number): Record<string, unknown> {
  const limit = radialMax * 1.18;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "nearest", intersect: false },
    plugins: {
      legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 9, boxHeight: 9, padding: 18 } },
      tooltip: { mode: "nearest", intersect: false },
      signedRadar: { labels, radialMax },
    },
    scales: {
      x: { type: "linear", min: -limit, max: limit, display: false },
      y: { type: "linear", min: -limit, max: limit, display: false },
    },
    $signedRadar: true,
  };
}

function buildNormalizedTrendGroup(matches: AnalysisBundle["matches"], dateLabels: string[], title: string, metrics: string[]): ChartConfig {
  const datasets: Array<Record<string, unknown>> = [];
  metrics.forEach((label) => {
    const rolling = rollingMetricMean(matches, label, ROLLING_WINDOW);
    const base = rolling.find((value) => value !== null && value !== 0);
    if (base === null || base === undefined) {
      return;
    }
    datasets.push({
      ...lineDataset(label, rolling.map((value) => (value === null ? null : round2((value / base) * 100))), METRIC_COLORS[label]!),
      borderWidth: 1.4,
      pointRadius: 0,
    });
  });
  return withChartTitle(withRefLines({
    type: "line",
    data: { labels: dateLabels, datasets },
    options: baseOptions({ x: dateAxis(), y: axis("指数（初期ローリング平均=100）") }),
  }, [{ y: 100 }]), title);
}

function rollingMetricMean(matches: AnalysisBundle["matches"], label: string, window: number): Array<number | null> {
  const column = ABILITY_METRIC_COLUMNS[label]!;
  return rollingParamColumnMean(matches, column, window);
}

function rollingParamColumnMean(matches: AnalysisBundle["matches"], column: string, window: number): Array<number | null> {
  if (!isDerivedMetricColumn(column)) {
    return rollingMean(matches.map((match) => numberOrNull(match[column])), window);
  }
  return matches.map((_, index) => {
    const start = Math.max(0, index - window + 1);
    try {
      const params = calculateAverageParams(matches.slice(start, index + 1));
      return numberOrNull(params[column]);
    } catch {
      return null;
    }
  });
}

function buildMonthlyTrBand(matches: AnalysisBundle["matches"]): ChartConfig {
  const window = 50;
  const rows = matches
    .map((match) => ({
      label: String(match.played_at_jst ?? "").slice(0, 10),
      playedAt: String(match.played_at_jst ?? ""),
      tr: numberOrNull(match.tr_after),
    }))
    .filter((row): row is { label: string; playedAt: string; tr: number } => row.tr !== null && row.playedAt.length > 0)
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  const labels = rows.map((row) => row.label);
  const windows = rows.map((_, index) => rows.slice(Math.max(0, index - window + 1), index + 1).map((row) => row.tr));
  const p10 = windows.map((values) => quantile(values, 0.1));
  const p50 = windows.map((values) => quantile(values, 0.5));
  const p90 = windows.map((values) => quantile(values, 0.9));
  return {
    type: "line",
    data: {
      labels,
      datasets: [
        { ...lineDataset("P10", p10.map(roundOrNull), EXPECTED_COLOR), pointRadius: 0, borderDash: [6, 4], borderWidth: 1.2 },
        {
          ...lineDataset("P90", p90.map(roundOrNull), "#8b5cf6"),
          pointRadius: 0,
          borderDash: [6, 4],
          borderWidth: 1.2,
          fill: "-1",
          backgroundColor: alphaColor(PRIMARY_COLOR, 0.14),
        },
        { ...lineDataset("P50", p50.map(roundOrNull), "#4f46e5"), pointRadius: 0, borderWidth: 2 },
      ],
    },
    options: baseOptions({ x: axis("マッチ日"), y: axis("TR") }),
  };
}

function buildEffectSizes(effectRows: Array<Record<string, unknown>>): ChartConfig {
  const rows = effectRows
    .map((row) => ({ metric: String(row.metric), d: numberOrNull(row.d) }))
    .filter((row): row is { metric: string; d: number } => row.d !== null)
    .sort((a, b) => b.d - a.d);
  return withRefLines({
    type: "bar",
    data: {
      labels: rows.map((row) => row.metric),
      datasets: [{
        label: "Cohen's d",
        data: rows.map((row) => round2(row.d)),
        backgroundColor: rows.map((row) => alphaColor(row.d >= 0 ? WIN_COLOR : LOSS_COLOR, 0.75)),
        borderColor: rows.map((row) => (row.d >= 0 ? WIN_COLOR : LOSS_COLOR)),
        borderWidth: 1,
      }],
    },
    options: {
      ...baseOptions({ x: axis("Cohen's d（正：勝利時に高い）"), y: axis(undefined, { ticks: { autoSkip: false } }) }),
      indexAxis: "y",
      $tall: true,
    },
  }, [{ x: 0, color: "#6b7280", dash: [] }]);
}

// Python版 09_delta_* を統合。横軸=各指標の分位ビン順、縦軸=勝率（%）、50%基準線つき。
function deltaMetricChart(deltaBins: Record<string, Array<Record<string, unknown>>>): ChartConfig {
  const metrics = ["APM", "PPS", "VS", "Area"];
  const labels = Array.from(
    { length: Math.max(0, ...metrics.map((metric) => (deltaBins[metric] ?? []).length)) },
    (_, index) => String(index + 1),
  );
  return withRefLines({
    type: "line",
    data: {
      labels,
      datasets: metrics.map((metric) => {
        const rows = deltaBins[metric] ?? [];
        return {
          ...lineDataset(metric, labels.map((_, index) => pctOrNull(rows[index]?.win_rate)), METRIC_COLORS[metric] ?? WIN_COLOR),
          pointRadius: 3,
          $unit: "%",
          $notes: deltaNotes(rows),
        };
      }),
    },
    options: baseOptions({ x: axis("相対差ビン（左ほど相手優位、右ほど自分優位）"), y: pctAxis("勝率（%）") }),
  }, [{ y: 50 }]);
}

function buildStreakDistribution(streaks: Record<string, unknown>): ChartConfig {
  const winRuns = (Array.isArray(streaks.session_win_runs) ? streaks.session_win_runs : Array.isArray(streaks.win_runs) ? streaks.win_runs : []) as number[];
  const lossRuns = (Array.isArray(streaks.session_loss_runs) ? streaks.session_loss_runs : Array.isArray(streaks.loss_runs) ? streaks.loss_runs : []) as number[];
  const lengths = Array.from({ length: 10 }, (_, index) => index + 1);
  const labels = [...lengths.slice(0, 9).map(String), "10以上"];
  const countRuns = (runs: number[], len: number): number =>
    runs.filter((run) => (len === 10 ? run >= 10 : run === len)).length;
  return {
    type: "bar",
    data: {
      labels,
      datasets: [
        barDataset("連勝", lengths.map((len) => countRuns(winRuns, len)), WIN_COLOR),
        barDataset("連敗", lengths.map((len) => countRuns(lossRuns, len)), LOSS_COLOR),
      ],
    },
    options: baseOptions({ x: axis("セッション内の最大連勝・最大連敗マッチ数"), y: axis("セッション数") }),
  };
}

function buildTiebreak(tiebreak: Record<string, unknown>): ChartConfig {
  const routes = (Array.isArray(tiebreak.routes) ? tiebreak.routes : []) as Array<Record<string, unknown>>;
  const rows = routes.length
    ? routes
    : [{ route: "タイブレーク全体", win_rate: tiebreak.win_rate, expected: tiebreak.expected, n: tiebreak.n }];
  return actualVsExpectedBars(
    rows.map((row) => String(row.route)),
    rows.map((row) => ({ actual: row.win_rate, expected: row.expected, n: row.n })),
    "到達経路",
  );
}

function buildDurationWinRate(durationBins: Array<Record<string, unknown>>): ChartConfig {
  const labels = durationBins.map((row) => String(row.label ?? labelRange(row)));
  return withRefLines({
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          ...lineDataset("ラウンド勝率", durationBins.map((row) => pctOrNull(row.win_rate)), WIN_COLOR),
          type: "line",
          pointRadius: 3,
          yAxisID: "y",
          $unit: "%",
          $notes: nNotes(durationBins),
          order: 0,
        },
        {
          ...barDataset("ラウンド数", durationBins.map((row) => numberOrNull(row.n)), NEUTRAL_BAR_COLOR),
          yAxisID: "y2",
          order: 1,
        },
      ],
    },
    options: baseOptions({
      x: axis("ラウンド決着時間帯"),
      y: pctAxis("勝率（%）"),
      y2: y2Axis("ラウンド数"),
    }),
  }, [{ y: 50, axis: "y" }]);
}

function buildScoreStates(scoreStates: Array<Record<string, unknown>>): ChartConfig {
  // Python版 18 の色分け: 前半3状態=中立、自分MP=緑、相手MP=赤、双方MP=琥珀。
  const stateColors = ["#94a3b8", "#94a3b8", "#94a3b8", "#22c55e", "#ef4444", "#f59e0b"];
  return withRefLines({
    type: "bar",
    data: {
      labels: scoreStates.map((row) => String(row.label)),
      datasets: [{
        label: "ラウンド勝率",
        data: scoreStates.map((row) => pctOrNull(row.win_rate)),
        backgroundColor: scoreStates.map((_, index) => alphaColor(stateColors[index] ?? "#94a3b8", 0.75)),
        borderColor: scoreStates.map((_, index) => stateColors[index] ?? "#94a3b8"),
        borderWidth: 1,
        $unit: "%",
        $notes: nNotes(scoreStates),
      }],
    },
    options: baseOptions({ x: axis("開始前スコア状況"), y: pctAxis("ラウンド勝率（%）") }),
  }, [{ y: 50 }]);
}

function buildDurationDeltas(durationBins: Array<Record<string, unknown>>): ChartConfig {
  const rows = durationBins.filter((row) => (numberOrNull(row.n) ?? 0) >= 20);
  return withRefLines({
    type: "line",
    data: {
      labels: rows.map((row) => String(row.label ?? labelRange(row))),
      datasets: [
        { ...lineDataset("ΔAPM", rows.map((row) => numberOrNull(row.delta_APM)), METRIC_COLORS.APM!), pointRadius: 3, yAxisID: "y", $notes: nNotes(rows) },
        { ...lineDataset("ΔVS", rows.map((row) => numberOrNull(row.delta_VS)), METRIC_COLORS.VS!), pointRadius: 3, yAxisID: "y", $notes: nNotes(rows) },
        { ...lineDataset("ΔArea", rows.map((row) => numberOrNull(row.delta_Area)), METRIC_COLORS.Area!), pointRadius: 3, yAxisID: "y", $notes: nNotes(rows) },
        { ...lineDataset("ΔPPS（右軸）", rows.map((row) => numberOrNull(row.delta_PPS)), METRIC_COLORS.PPS!), pointRadius: 3, yAxisID: "y2", $notes: nNotes(rows) },
      ],
    },
    options: baseOptions({
      x: axis("ラウンド決着時間帯"),
      y: axis("差分（自分−相手）"),
      y2: y2Axis("ΔPPS"),
    }),
  }, [{ y: 0, axis: "y", color: "#6b7280" }]);
}

function buildStylePlane(matches: AnalysisBundle["matches"], plane: Record<string, unknown>): ChartConfig {
  const axisLabels = (plane?.axis_labels ?? {}) as Record<string, unknown>;
  const config = scatterByResult(
    matches.map((match) => ({
      x: match["opponent_Stride - Plonk"],
      y: match["opponent_Opener - Inf DS"],
      won: match.won,
    })),
    String(axisLabels.x ?? "Plonk ←→ Stride"),
    String(axisLabels.y ?? "Inf DS ←→ Opener"),
  );
  const selfPos = (plane?.self_pos ?? {}) as Record<string, unknown>;
  const selfX = numberOrNull(selfPos.x);
  const selfY = numberOrNull(selfPos.y);
  if (selfX !== null && selfY !== null) {
    config.data.datasets.push({
      label: "自分の平均位置",
      data: [{ x: round2(selfX), y: round2(selfY) }],
      pointStyle: "rectRot",
      pointRadius: 8,
      pointHoverRadius: 10,
      borderColor: "#111827",
      backgroundColor: "#111827",
      borderWidth: 2,
    });
  }
  return config;
}

function buildRivals(rivals: Array<Record<string, unknown>>, anon: Anonymizer): ChartConfig {
  const rows = rivals.slice(0, 12);
  return withRefLines({
    type: "bar",
    data: {
      labels: rows.map((row) => `${anon.opponent(row.opponent ?? row.opponent_id, row.opponent_id)}（n=${numberOrNull(row.n) ?? 0}）`),
      datasets: [{
        label: "勝率",
        data: rows.map((row) => pctOrNull(row.win_rate)),
        backgroundColor: rows.map((row) => alphaColor(winRateColor(numberOrNull(row.win_rate)), 0.8)),
        borderColor: rows.map((row) => winRateColor(numberOrNull(row.win_rate))),
        borderWidth: 1,
        $unit: "%",
        $notes: rows.map((row) => `${numberOrNull(row.wins) ?? 0}勝${numberOrNull(row.losses) ?? 0}敗`),
      }],
    },
    options: {
      ...baseOptions({ x: pctAxis("勝率（%）"), y: axis() }),
      indexAxis: "y",
    },
  }, [{ x: 50 }]);
}

function buildComeback(comeback: Record<string, unknown>): ChartConfig {
  const rows = (Array.isArray(comeback?.by_max_deficit) ? comeback.by_max_deficit : []) as Array<Record<string, unknown>>;
  return withRefLines({
    type: "bar",
    data: {
      labels: rows.map((row) => String(row.deficit)),
      datasets: [{
        ...barDataset("マッチ勝率", rows.map((row) => pctOrNull(row.win_rate)), "#ef4444"),
        $unit: "%",
        $notes: nNotes(rows),
      }],
    },
    options: baseOptions({ x: axis("マッチ中の最大ビハインド"), y: pctAxis("マッチ勝率（%）") }),
  }, [{ y: 50 }]);
}

function buildSessionDecay(decayRows: Array<Record<string, unknown>>): ChartConfig {
  const labels = decayRows.map((row) => String(row.label));
  const metricSeries: Array<[string, string, string]> = [
    ["APM", "apm", METRIC_COLORS.APM!],
    ["PPS", "pps", METRIC_COLORS.PPS!],
    ["VS", "vs", METRIC_COLORS.VS!],
    ["Area", "area", METRIC_COLORS.Area!],
  ];
  const datasets: Array<Record<string, unknown>> = [{
    ...barDataset("勝率", decayRows.map((row) => pctOrNull(row.win_rate)), "#93c5fd"),
    yAxisID: "y",
    $unit: "%",
    $notes: nNotes(decayRows),
    order: 1,
  }];
  for (const [label, key, color] of metricSeries) {
    datasets.push({
      ...lineDataset(label, sessionDecayIndexTo100(decayRows, key), color),
      type: "line",
      pointRadius: 3,
      yAxisID: "y2",
      order: 0,
    });
  }
  return withRefLines({
    type: "bar",
    data: { labels, datasets },
    options: baseOptions({
      x: axis("セッション内のマッチ位置"),
      y: pctAxis("勝率（%）"),
      y2: y2Axis("能力指標（1マッチ目=100）"),
    }),
  }, [{ y: 50, axis: "y" }, { y: 100, axis: "y2", dash: [2, 3] }]);
}

function emptyChart(id: string): ChartConfig {
  return {
    type: "bar",
    data: { labels: [id], datasets: [barDataset("データなし", [0], NEUTRAL_BAR_COLOR)] },
    options: baseOptions({}),
  };
}

// 実績 vs 期待のグループ棒（%軸・50%基準線・nはツールチップ）。Python版の共通形。
function actualVsExpectedBars(labels: string[], rows: Array<Record<string, unknown>>, xTitle: string): ChartConfig {
  return withRefLines({
    type: "bar",
    data: {
      labels,
      datasets: [
        { ...barDataset("実績", rows.map((row) => pctOrNull(row.actual ?? row.win_rate)), WIN_COLOR), $unit: "%", $notes: nNotes(rows) },
        { ...barDataset("期待", rows.map((row) => pctOrNull(row.expected)), EXPECTED_COLOR), $unit: "%", $notes: nNotes(rows) },
      ],
    },
    options: baseOptions({ x: axis(xTitle), y: pctAxis("勝率（%）") }),
  }, [{ y: 50 }]);
}

function scatterByResult(rows: Array<Record<string, unknown>>, xLabel: string, yLabel: string): ChartConfig {
  const win = rows.filter((row) => Boolean(row.won)).map(point).filter(validPoint);
  const loss = rows.filter((row) => !Boolean(row.won)).map(point).filter(validPoint);
  return withRefLines({
    type: "scatter",
    data: {
      datasets: [
        scatterDataset("勝ち", win, WIN_COLOR),
        scatterDataset("負け", loss, LOSS_COLOR),
      ],
    },
    options: baseOptions({ x: axis(xLabel), y: axis(yLabel) }),
  }, [{ x: 0, color: "#9ca3af", dash: [] }, { y: 0, color: "#9ca3af", dash: [] }]);
}

function scatterDataset(label: string, data: Array<{ x: number | null; y: number | null }>, color: string): Record<string, unknown> {
  return {
    label,
    data,
    borderColor: alphaColor(color, 0.55),
    backgroundColor: alphaColor(color, 0.45),
    pointRadius: 2.6,
    pointHoverRadius: 4,
  };
}

function lineDataset(label: string, data: Array<number | null>, color: string): Record<string, unknown> {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: alphaColor(color, 0.18),
    borderWidth: 1.8,
    pointRadius: 0,
    pointHoverRadius: 4,
    fill: false,
    tension: 0.25,
    spanGaps: true,
  };
}

function barDataset(label: string, data: Array<number | null>, color: string): Record<string, unknown> {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: alphaColor(color, 0.65),
    borderWidth: 1,
  };
}

interface AxisScales {
  x?: Record<string, unknown>;
  y?: Record<string, unknown>;
  y2?: Record<string, unknown>;
}

function baseOptions(scales: AxisScales): Record<string, unknown> {
  const scaleEntries: Record<string, unknown> = {};
  if (scales.x) scaleEntries.x = scales.x;
  if (scales.y) scaleEntries.y = scales.y;
  if (scales.y2) scaleEntries.y2 = scales.y2;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "nearest", intersect: false },
    plugins: {
      legend: { position: "bottom", labels: { boxWidth: 14, boxHeight: 8, padding: 14 } },
      tooltip: { mode: "nearest", intersect: false },
    },
    ...(Object.keys(scaleEntries).length ? { scales: scaleEntries } : {}),
  };
}

function axis(title?: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...(title ? { title: { display: true, text: title } } : {}),
    grid: { color: "#eceef4" },
    ...extra,
  };
}

function dateAxis(): Record<string, unknown> {
  return axis(undefined, { ticks: { maxTicksLimit: 9, maxRotation: 0, autoSkip: true } });
}

// $pct はレンダラ側でティックへ「%」を付けるマーカー。
function pctAxis(title: string): Record<string, unknown> {
  return axis(title, { min: 0, max: 100, $pct: true });
}

function y2Axis(title: string): Record<string, unknown> {
  return axis(title, { position: "right", grid: { drawOnChartArea: false } });
}

interface RefLine {
  x?: number;
  y?: number;
  axis?: string;
  color?: string;
  dash?: number[];
}

// options.refLines はレンダラ側の基準線プラグインが解釈する。
function withRefLines(config: ChartConfig, refLines: RefLine[]): ChartConfig {
  config.options = { ...(config.options ?? {}), refLines };
  return config;
}

function withChartTitle(config: ChartConfig, title: string): ChartConfig {
  const options = config.options ?? {};
  const plugins = ((options.plugins ?? {}) as Record<string, unknown>);
  config.options = {
    ...options,
    plugins: {
      ...plugins,
      title: { display: true, text: title, padding: { bottom: 8 } },
    },
  };
  return config;
}

function nNotes(rows: Array<Record<string, unknown>>): Array<string | null> {
  return rows.map((row) => {
    const n = numberOrNull(row.n);
    return n === null ? null : `n=${n}`;
  });
}

function deltaNotes(rows: Array<Record<string, unknown>>): Array<string | null> {
  return rows.map((row) => {
    const deltaMean = numberOrNull(row.delta_mean);
    const n = numberOrNull(row.n);
    const parts = [];
    if (deltaMean !== null) {
      parts.push(`Δ平均=${deltaMean.toFixed(2)}`);
    }
    if (n !== null) {
      parts.push(`n=${n}`);
    }
    return parts.length ? parts.join("、") : null;
  });
}

export function indexTo100(values: Array<number | null>): Array<number | null> {
  return indexTo100From(values, 0);
}

export function sessionDecayIndexTo100(decayRows: Array<Record<string, unknown>>, key: string): Array<number | null> {
  const values = decayRows.map((row) => numberOrNull(row[key]));
  const openerIndex = decayRows.findIndex((row) => sessionPositionNumber(row) === 1);
  if (openerIndex < 0) {
    return values.map(() => null);
  }
  return indexTo100From(values, openerIndex);
}

function indexTo100From(values: Array<number | null>, baseIndex: number): Array<number | null> {
  const base = values[baseIndex];
  if (base === null || base === undefined || base === 0) {
    return values.map(() => null);
  }
  return values.map((value) => (value === null ? null : round2((value / base) * 100)));
}

function sessionPositionNumber(row: Record<string, unknown>): number | null {
  const match = String(row.label ?? "").match(/^\d+/);
  return match ? Number(match[0]) : null;
}

function opponentMetricColumn(label: string, selfColumn: string): string {
  if (label === "Garbage Eff.") {
    return "opponent_Garbage Effi.";
  }
  return `opponent_${selfColumn}`;
}

function distributionStats(values: unknown[]): { p10: number; p50: number; p90: number } | null {
  const finite = values
    .map(numberOrNull)
    .filter((value): value is number => value !== null);
  if (finite.length === 0) {
    return null;
  }
  const p10 = quantile(finite, 0.1);
  const p50 = quantile(finite, 0.5);
  const p90 = quantile(finite, 0.9);
  if (p10 === null || p50 === null || p90 === null) {
    return null;
  }
  return { p10, p50, p90 };
}

function closeArray<T>(values: T[]): T[] {
  return values.length ? [...values, values[0]!] : [];
}

function maxFinite(values: Array<number | null>): number {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finite.length ? Math.max(...finite) : 0;
}

function maxAbsFinite(values: Array<number | null>): number {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finite.length ? Math.max(...finite.map((value) => Math.abs(value))) : 0;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isDerivedMetricColumn(column: string): boolean {
  return (BASE_PARAM_COLUMNS as readonly string[]).includes(column);
}

function pctOrNull(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed === null ? null : round2(parsed * 100);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : round2(value);
}

function point(row: Record<string, unknown>): { x: number | null; y: number | null } {
  return { x: numberOrNull(row.x), y: numberOrNull(row.y) };
}

function validPoint(p: { x: number | null; y: number | null }): boolean {
  return p.x !== null && p.y !== null;
}

function buildDrawdownSeries(matches: AnalysisBundle["matches"]): Array<number | null> {
  let peak = -Infinity;
  return matches.map((match) => {
    const tr = numberOrNull(match.tr_after);
    if (tr !== null) {
      peak = Math.max(peak, tr);
    }
    return tr !== null && Number.isFinite(peak) ? tr - peak : null;
  });
}

function labelRange(row: Record<string, unknown>): string {
  const low = numberOrNull(row.low);
  const high = numberOrNull(row.high);
  if (low === null || high === null) {
    return String(row.label ?? row.bin ?? "");
  }
  return `${low.toFixed(2)}..${high.toFixed(2)}`;
}
