import type { AnalysisBundle } from "../analysis/types";
import { ABILITY_METRIC_COLUMNS } from "../analysis/enrich";
import { STYLE_ORDER } from "../analysis/model";
import { quantile } from "../analysis/stats";
import { htmlEscape, finiteNumber as num } from "../utils";
import type { Anonymizer } from "./anonymize";
import { advantageTable, block, fig, grain, table } from "./components";
import { metricFmt, nfmt, pct, pp, sgn } from "./format";

// 章タイトル（番号順）。render_report.py CHAPTER_TITLES と一致させる単一の真実。
export const CHAPTER_TITLES = [
  "全体像と基本指標",
  "パーソナルレコード",
  "成長推移と安定性",
  "能力バランス",
  "勝敗に関係しやすい指標",
  "プレイスタイル相性",
  "対戦相手の強さと期待値",
  "ライバル ─ 遭遇回数と対戦結果",
  "接戦・決着局面",
  "逆転・ビハインド展開",
  "ラウンド展開とマッチ時間",
  "連戦の流れとセッション内のマッチ位置",
  "リプレイ確認候補",
];
export const ACTIVE_CHAPTER_NUMBERS = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
// 部（大セクション）。各タプルは [ローマ数字, 部名, 開始章番号]。
export const PARTS: Array<[string, string, number]> = [
  ["Ⅰ", "全体像", 1],
  ["Ⅱ", "成長と能力", 3],
  ["Ⅲ", "勝敗の要因", 5],
  ["Ⅳ", "対戦相手", 7],
  ["Ⅴ", "局面", 9],
  ["Ⅵ", "時間と連戦", 11],
  ["Ⅶ", "振り返り", 13],
];
const PART_AT = new Map<number, [string, string, number]>(
  PARTS.map(([roman, name, start], i) => [start, [roman, name, i + 1]]),
);

const ABILITY_METRICS = ABILITY_METRIC_COLUMNS.map(([label]) => label);
const CURRENT_DERIVED_METRICS: Array<[string, string]> = [
  ["APP", "APP"],
  ["DS/Second", "DS/Second"],
  ["DS/Piece", "DS/Piece"],
  ["VS/APM", "VS/APM"],
  ["Garbage Eff.", "Garbage Effi."],
  ["Cheese Index", "Cheese Index"],
  ["Weighted APP", "Weighted APP"],
  ["APP+DS/Piece", "APP+DS/Piece"],
  ["Area", "Area"],
  ["Est. TR", "Est. TR"],
  ["Opener", "Opener"],
  ["Plonk", "Plonk"],
  ["Stride", "Stride"],
  ["Inf DS", "Inf DS"],
];

function partDivider(num: number): string {
  const part = PART_AT.get(num);
  if (!part) {
    return "";
  }
  const [roman, name, idx] = part;
  return `<h2 class="part" id="part-${idx}"><span class="pno">第${roman}部</span>${htmlEscape(name)}</h2>\n`;
}

function chapterHeader(num: number, title: string, lead: string): string {
  return (
    partDivider(num) +
    `<h2 class="chap" id="c${num}"><span class="no">第${num}章</span>${htmlEscape(title)}<a class="toclink" href="#top">↑ 目次</a></h2>\n<p class="lead">${lead}</p>`
  );
}

function maxBy<T>(rows: T[], key: (row: T) => number): T | undefined {
  return rows.reduce<T | undefined>((best, row) => (best === undefined || key(row) > key(best) ? row : best), undefined);
}

function minBy<T>(rows: T[], key: (row: T) => number): T | undefined {
  return rows.reduce<T | undefined>((best, row) => (best === undefined || key(row) < key(best) ? row : best), undefined);
}

function tetrioProfileLink(value: unknown, text: unknown, anon: Anonymizer): string {
  if (anon.enabled) {
    return htmlEscape(anon.opponent(value, text));
  }
  const id = String(value ?? "").trim();
  const label = String(text ?? value ?? "").trim();
  if (!id || !label) {
    return "—";
  }
  const href = `https://ch.tetr.io/u/${encodeURIComponent(id)}`;
  return `<a href="${htmlEscape(href)}" target="_blank" rel="noopener noreferrer">${htmlEscape(label)}</a>`;
}

function replayLink(value: unknown, anon: Anonymizer): string {
  // 匿名化時はリプレイIDが対象マッチを特定しうるため、リンクを張らず無効表示にする。
  if (anon.enabled) {
    return "—";
  }
  const id = String(value ?? "").trim();
  if (!id) {
    return "—";
  }
  const href = `https://tetr.io/#R:${encodeURIComponent(id)}`;
  return `<a href="${htmlEscape(href)}" target="_blank" rel="noopener noreferrer">リプレイ</a>`;
}

function currentLeagueTable(currentLeague: Record<string, any>): string {
  if (!currentLeague?.available) {
    return block(
      "summary API 由来の現在値を取得不可。履歴分析のみ表示。",
      ["summaryRecentSplit"],
      "summary APIを取得できない場合、recent records由来の直近値では代替しない。",
    );
  }
  const raw = currentLeague.raw ?? {};
  const derived = currentLeague.derived ?? {};
  const rawRows = [
    ["APM", metricFmt("APM", raw.APM)],
    ["PPS", metricFmt("PPS", raw.PPS)],
    ["VS", metricFmt("VS", raw.VS)],
    ["TR", nfmt(raw.TR, 0, true)],
    ["Glicko", nfmt(raw.Glicko, 0, true)],
    ["RD", nfmt(raw.RD, 1)],
    ["gameswon", nfmt(raw.gameswon, 0)],
  ];
  const derivedRows = CURRENT_DERIVED_METRICS.map(([label, key]) => [label, metricFmt(label, derived[key])]);
  return [
    table(["基礎値", "値"], rawRows, { minWidth: 420 }),
    table(["派生指標", "値"], derivedRows, { minWidth: 520 }),
    block(
      `summary APIのAPM/PPS/VSから派生指標を再計算。Est. TRは${metricFmt("Est. TR", derived["Est. TR"])}。`,
      ["derivedMetric", "summaryRecentSplit"],
      "履歴分析の直近窓とは取得元が異なる。",
    ),
  ].join("");
}

// 直近50マッチ窓のマッチ後TR分位帯（P10/P50/P90）を bundle.matches から算出する。
function trMonthlyBandResult(matches: AnalysisBundle["matches"]): string {
  const window = 50;
  const rows = matches
    .map((match) => ({ playedAt: String(match.played_at_jst ?? ""), tr: num(match.tr_after) }))
    .filter((row): row is { playedAt: string; tr: number } => row.tr !== null && row.playedAt.length > 0)
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  if (rows.length === 0) {
    return "マッチ単位TR分位帯を集計不可。";
  }
  const latest = rows.slice(-window).map((row) => row.tr);
  const p10 = quantile(latest, 0.1);
  const p50 = quantile(latest, 0.5);
  const p90 = quantile(latest, 0.9);
  if (p10 === null || p50 === null || p90 === null) {
    return "マッチ単位TR分位帯を集計不可。";
  }
  return `直近${Math.min(window, rows.length)}マッチ窓のP50は${nfmt(p50, 0, true)}、P10-P90幅は${nfmt(p90 - p10, 0, true)}。`;
}

export function renderChapters(bundle: AnalysisBundle, anon: Anonymizer): string {
  const s = bundle.summary as any;
  const kpi = s.kpis;
  const scope = s.recent_scope ?? {};
  const recentTag = `直近${scope.n_matches ?? 100}マッチ（マッチ単位）`;
  const parts: string[] = [];

  // 第1章 全体像と基本指標
  const windows = s.recent_windows as Array<Record<string, any>>;
  const windowRows = windows.map((w) => [
    w.label,
    `${w.wins}/${w.n}`,
    pct(w.expected_actual),
    pct(w.expected),
    w.expected_n,
    pp(w.excess_rate),
    nfmt(w.excess_wins, 1),
  ]);
  const recent = windows[0]!;
  const peakGap = kpi.peak_tr !== null && kpi.peak_tr !== undefined ? Math.abs(Number(kpi.current_tr) - Number(kpi.peak_tr)) : NaN;
  const rj = s.rank_journey ?? {};
  const transitions: Array<Record<string, any>> = rj.transitions ?? [];
  const ups = transitions.filter((t) => t.direction === "up").length;
  const downs = transitions.filter((t) => t.direction === "down").length;
  const rankParts: string[] = [];
  if (rj.current) {
    rankParts.push(`現在のランクは${htmlEscape(String(rj.current).toUpperCase())}`);
  }
  if (transitions.length) {
    rankParts.push(`昇格${ups}回・降格${downs}回`);
  }
  const rankSentence = rankParts.length ? `${rankParts.join("、")}。` : "";
  let c1 = chapterHeader(1, "全体像と基本指標", "対象期間全体の規模・TRの長期推移・直近の実績と対戦前期待値の差。");
  c1 += fig("01_tr_history", "TR推移");
  c1 += block(
    `確認できる最初のTRは${nfmt(kpi.first_tr, 0, true)}、現在は${nfmt(kpi.current_tr, 0, true)}、差は${nfmt(kpi.tr_change, 0, true)}。ピークは${nfmt(kpi.peak_tr, 0, true)}（${dateText(kpi.peak_date)}、現在はここから${nfmt(peakGap, 0)}）、最大ドローダウンは${nfmt(kpi.max_drawdown, 0, true)}。${rankSentence}`,
    ["cohortBias"],
    "縦軸TR・Est. TR。ランク切替点に新ランクを表示。",
  );
  c1 += "<h3>直近窓別の実績 vs 期待</h3>" + table(["期間", "勝数", "実績", "期待", "期待対象", "期待超過", "超過勝数"], windowRows, { mobileColumns: [0, 2, 3, 5] });
  c1 += block(
    `${recent.label}は実績${pct(recent.expected_actual)}、期待${pct(recent.expected)}、差は${pp(recent.excess_rate)}・${nfmt(recent.excess_wins, 1)}勝分。全期間の公式勝率は${pct(kpi.official_win_rate)}。`,
    ["glickoMissing"],
    "実績−期待＝期待超過。期待は対戦前Glicko/RDの標準Glicko期待スコア。",
  );
  parts.push(chapterSection(1, c1));

  // 第3章 成長推移と安定性
  const growth = s.growth as Record<string, any>;
  const growthWindows = (s.growth_windows ?? []) as Array<Record<string, any>>;
  const growthRows = ABILITY_METRICS.map((m) => [m, ...growthWindows.map((w) => metricFmt(m, w[m]))]);
  const bestGrowth = maxBy(Object.entries(growth), ([, row]) => {
    const rate = num(row.growth_rate);
    return rate === null ? -999 : rate;
  })!;
  let c3 = chapterHeader(3, "成長推移と安定性", "マッチ日時ベースの指標推移と、直近10・50・100マッチ・全期間の指標平均。");
  c3 += fig("05_monthly_normalized_trends", "APM / PPS / VS / VS/APM");
  c3 += fig("05_monthly_normalized_trends_ds", "DS/Second / DS/Piece");
  c3 += fig("05_monthly_normalized_trends_attack", "APP / APP+DS/Piece / Garbage Eff.");
  c3 += fig("05_monthly_normalized_trends_cheese", "Cheese Index");
  c3 += fig("05_monthly_normalized_trends_rating", "Area / Est. TR");
  c3 += block(
    `初期から直近で最も伸びた指標は${bestGrowth[0]}で${pct(bestGrowth[1].growth_rate, 1, true)}。APMは${nfmt(growth.APM.early, 1)}→${nfmt(growth.APM.recent, 1)}、PPSは${nfmt(growth.PPS.early, 2)}→${nfmt(growth.PPS.recent, 2)}、APPは${nfmt(growth.APP.early, 3)}→${nfmt(growth.APP.recent, 3)}。`,
    ["normalized", "cohortBias"],
    "初期ローリング平均を100とした指数。指標グループ別。",
  );
  c3 += "<h3>4プレイスタイルの推移</h3>" + fig("20_playstyle_trend", "4プレイスタイル推移");
  c3 += block(
    "線が上下に入れ替わる時期は、プレイスタイルの重心が移ったことを示す。",
    ["derivedMetric", "cohortBias"],
    "Opener・Stride・Inf DS・Plonkのローリング平均を4本重ね表示。",
  );
  c3 += "<h3>主要指標の直近窓別平均</h3>" + table(["指標", ...growthWindows.map((w) => String(w.label))], growthRows, { minWidth: 760 });
  c3 += "<h3>TRの安定性・上振れ・下振れ</h3>" + grain("マッチ単位。各マッチ時点の直近50マッチ後TRをP10・P50・P90で見る。") + fig("07_tr_monthly_stability", "TRの安定性・上振れ・下振れ");
  c3 += block(
    trMonthlyBandResult(bundle.matches),
    ["smallSample", "cohortBias"],
    "直近50マッチ後TRのP10/P50/P90。帯が狭いほど安定。",
  );
  c3 += "<h3>TRドローダウン</h3>" + grain("マッチ単位。各マッチ後TRが、それまでのピークからどれだけ下がったかを見る。") + fig("13_tr_drawdown", "TRドローダウン");
  c3 += block(
    `最大ドローダウンは${nfmt(kpi.max_drawdown, 0, true)}、底は${dateText(kpi.max_drawdown_date)}。現在TRは${nfmt(kpi.current_tr, 0, true)}。`,
    ["cohortBias"],
    "0=その時点の最高TR、負値=ピークからの下落幅。",
  );
  parts.push(chapterSection(3, c3));

  // 第4章 能力バランス
  const metrics = s.metrics as Record<string, any>;
  const mr = s.metrics_recent as Record<string, any>;
  const metricRows = ABILITY_METRICS.filter((m) => m in mr).map((m) => [
    m,
    metricFmt(m, mr[m].self),
    metricFmt(m, mr[m].opponent),
    metricFmt(m, mr[m].difference),
  ]);
  const strongest = maxBy(Object.entries(mr), ([, row]) => (num(row.difference) ?? -999))![0];
  let c4 = chapterHeader(4, "能力バランス", "summary API 由来の現在値と、履歴分析による能力バランス。レーダーとスタイルは保存済み recent records の直近100マッチをマッチ単位で集計。");
  c4 += "<h3>summary API 由来の現在値</h3>" + currentLeagueTable(s.current_league ?? {});
  c4 += fig("02_metric_distributions", "主要指標分布");
  c4 += block(
    `平均APMは自分${nfmt(metrics.APM.self, 1)}・相手${nfmt(metrics.APM.opponent, 1)}、PPSは自分${nfmt(metrics.PPS.self, 2)}・相手${nfmt(metrics.PPS.opponent, 2)}、VSは自分${nfmt(metrics.VS.self, 1)}・相手${nfmt(metrics.VS.opponent, 1)}。相手平均との差が大きい軸の一つは${strongest}で、範囲の重なりが大きい指標は平均差があっても単独の勝敗判別力は限定的。`,
    ["aggregation"],
    "太帯=自分/細帯=相手のP10-P90、◆=自分の中央値、基準線100=相手中央値。",
  );
  c4 += `<h3>能力レーダーと4プレイスタイル（履歴分析・${recentTag}）</h3>` + fig("03_capability_radar", "能力レーダー");
  c4 += block(
    `APPは${nfmt(mr.APP.self, 3)}対${nfmt(mr.APP.opponent, 3)}、GbEは${nfmt(mr["Garbage Eff."].self, 3)}対${nfmt(mr["Garbage Eff."].opponent, 3)}、PPSは${nfmt(mr.PPS.self, 2)}対${nfmt(mr.PPS.opponent, 2)}。`,
    ["normalized"],
    `自分と相手平均の大きい方を1.0に正規化（履歴分析・${recentTag}）。負値は0参照円の内側。`,
  );
  c4 += fig("04_playstyle_radar", "4プレイスタイル");
  const srMeans = s.styles_recent.means as Record<string, any>;
  const representative = s.styles_recent.representative as string;
  c4 += block(
    `自分の最大値は${representative} ${nfmt(srMeans[representative].self, 2)}。Opener ${nfmt(srMeans.Opener.self, 2)}、Stride ${nfmt(srMeans.Stride.self, 2)}、Inf DS ${nfmt(srMeans["Inf DS"].self, 2)}、Plonk ${nfmt(srMeans.Plonk.self, 2)}。`,
    ["derivedMetric"],
    `能力指標から推定したスタイル傾向（履歴分析・${recentTag}平均）。負値は0参照円の内側。`,
  );
  c4 += `<h3>履歴分析の主要指標（${recentTag}）</h3>` + table(["指標", "自分", "相手平均", "差"], metricRows, { minWidth: 620 });
  c4 += block(
    "履歴分析の直近窓は保存済みrecent recordsから集計。",
    ["summaryRecentSplit"],
    "summary API 由来の現在値とは対象範囲・取得タイミングが異なる。",
  );
  parts.push(chapterSection(4, c4));

  // 第5章 勝敗に関係しやすい指標
  const effects = s.effect_sizes as Array<Record<string, any>>;
  const topEffect = effects[0];
  let c5 = chapterHeader(5, "勝敗に関係しやすい指標", "勝利時と敗北時の能力差、相手との相対優位。");
  c5 += fig("08_relative_effect_sizes", "効果量");
  c5 += block(
    topEffect
      ? `勝利時に高い側の先頭は${htmlEscape(String(topEffect.metric))}でd=${nfmt(topEffect.d, 2)}。勝利時平均${nfmt(topEffect.win_mean, 3)}、敗北時平均${nfmt(topEffect.loss_mean, 3)}。`
      : "効果量を集計不可。",
    ["posthocMetric", "reverseCausation"],
    "Cohen's d=勝利群−敗北群の平均差÷共通SD。正で勝利時に高い（killsは除外）。",
  );
  const deltaVs = (s.delta_vs_bins ?? []) as Array<Record<string, any>>;
  const deltaVsSpan = deltaVs.length >= 2 ? (num(deltaVs[deltaVs.length - 1]!.win_rate) ?? 0) - (num(deltaVs[0]!.win_rate) ?? 0) : null;
  c5 += "<h3>相対差と勝率（マッチ単位）</h3>" + grain("マッチ単位。自分−相手の差を分位ビンに分け、APM・PPS・VS・Areaの勝率を見る。");
  c5 += fig("09_delta_metric_winrate", "相対差と勝率");
  c5 += block(
    `最左ビンから最右ビンまでの勝率差は${pp(deltaVsSpan)}。各点のマッチ数（n）はツールチップで確認できる。`,
    ["binBoundary"],
    "横軸=自分−相手の差を指標ごとに並べた分位ビン、縦軸=勝率。右ほど自分優位。",
  );
  const dominance = s.dominance as Array<Record<string, any>>;
  const domBest = dominance.length ? maxBy(dominance, (x) => num(x.actual) ?? -1)! : null;
  c5 += "<h3>APM・VS相対優位による勝率（マッチ単位）</h3>" + grain("マッチ単位。横軸は自分APM−相手APM、縦軸は自分VS−相手VS。緑が勝ち、赤が負け。") + fig("10_apm_vs_dominance_scatter", "APM・VS相対優位による勝敗分布");
  c5 += advantageTable(dominance);
  c5 += block(
    domBest
      ? `最も実績勝率が高い分類は${htmlEscape(String(domBest.label))}で、実績${pct(domBest.actual)}・期待${pct(domBest.expected)}・期待超過${pp(domBest.excess)}（期待対象n=${domBest.n}）。`
      : "APM・VS分類を集計不可。",
    ["cohortBias", "glickoMissing"],
    "散布図=相対APM差×相対VS差の勝敗。表=4分類の実績/期待/期待超過。期待対象はGlicko/RD欠損を除く。",
  );
  const ppsDom = (s.pps_vs_dominance ?? []) as Array<Record<string, any>>;
  const ppsBest = ppsDom.length ? maxBy(ppsDom, (x) => num(x.actual) ?? -1)! : null;
  c5 += "<h3>PPS・VS相対優位による勝率（マッチ単位）</h3>" + grain("マッチ単位。横軸は自分PPS−相手PPS、縦軸は自分VS−相手VS。緑が勝ち、赤が負け。") + fig("11_pps_vs_dominance_scatter", "PPS・VS相対優位による勝敗分布");
  if (ppsDom.length) {
    c5 += advantageTable(ppsDom);
  }
  c5 += block(
    ppsBest
      ? `最も実績勝率が高い分類は${htmlEscape(String(ppsBest.label))}で、実績${pct(ppsBest.actual)}・期待${pct(ppsBest.expected)}・期待超過${pp(ppsBest.excess)}（期待対象n=${ppsBest.n}）。`
      : "PPS・VS分類を集計不可。",
    ["cohortBias", "glickoMissing"],
    "散布図=相対PPS差×相対VS差の勝敗。4分類の実績/期待/期待超過。期待対象はGlicko/RD欠損を除く。",
  );
  parts.push(chapterSection(5, c5));

  // 第6章 プレイスタイル相性
  const plane = (s.style_matchup_plane ?? {}) as Record<string, any>;
  const quadrants = (plane.quadrants ?? []) as Array<Record<string, any>>;
  const sp = (plane.self_pos ?? {}) as Record<string, any>;
  let c6 = chapterHeader(6, "プレイスタイル相性", "相手スタイルと勝敗の関係。相手のスタイルを2軸平面に置き、勝敗と期待超過をマッチ単位で見る。");
  c6 += "<h3>プレイスタイル相性マップ（マッチ単位）</h3>" + grain("マッチ単位。相手のスタイルを横軸（左Plonk↔右Stride）と縦軸（下Inf DS↔上Opener）の2軸平面に置き、各マッチの勝敗を緑（勝ち）・赤（負け）で色分け。") + fig("25_style_matchup_plane", "プレイスタイル相性マップ");
  if (quadrants.length) {
    c6 += advantageTable(quadrants);
  }
  const usableQ = quadrants.filter((q) => q.n >= 20).length ? quadrants.filter((q) => q.n >= 20) : quadrants;
  let planeResult: string;
  if (usableQ.length) {
    const best = maxBy(usableQ, (q) => (num(q.actual) ?? -1))!;
    const worst = minBy(usableQ, (q) => (num(q.actual) ?? 2))!;
    const spTxt = sp.x !== null && sp.x !== undefined ? `Stride−Plonk${sgn(sp.x, 1)}・Opener−Inf DS${sgn(sp.y, 1)}` : "—";
    planeResult = `自分の平均スタイル位置は${spTxt}。相手スタイルの4分類では、${htmlEscape(String(best.label))}で最高${pct(best.actual)}（期待超過${pp(best.excess)}、期待対象n=${best.n}）、${htmlEscape(String(worst.label))}で最低${pct(worst.actual)}（期待超過${pp(worst.excess)}、期待対象n=${worst.n}）。`;
  } else {
    planeResult = "相性マップに十分な標本なし。";
  }
  c6 += block(
    planeResult,
    ["derivedMetric", "smallSample", "glickoMissing"],
    "点=4スタイル値を2軸要約した相手位置。表=4分類の勝率と期待超過。期待対象はGlicko/RD欠損を除く。",
  );
  parts.push(chapterSection(6, c6));

  // 第7章 対戦相手の強さと期待値
  const trGap = s.tr_gap as Array<Record<string, any>>;
  const reliableGap = trGap.filter((x) => x.n >= 20);
  const bestGap = reliableGap.length ? maxBy(reliableGap, (x) => num(x.excess) ?? -Infinity)! : null;
  const worstGap = reliableGap.length ? minBy(reliableGap, (x) => num(x.excess) ?? Infinity)! : null;
  let c7 = chapterHeader(7, "対戦相手の強さと期待値", "格上・同格・格下を細分化し、実績勝率が対戦前期待値からどこで外れたか。");
  c7 += fig("12_tr_gap_expected_vs_actual", "TR差別実績と期待");
  c7 += block(
    bestGap && worstGap
      ? `標本20以上では、期待超過が最大の帯は${htmlEscape(String(bestGap.label))}で${pp(bestGap.excess)}（n=${bestGap.n}）、最小は${htmlEscape(String(worstGap.label))}で${pp(worstGap.excess)}（n=${worstGap.n}）。`
      : "TR差を算出できる十分な標本の帯が不足。",
    ["glickoMissing", "smallSample", "cohortBias"],
    "横軸=自分TR−相手TRの帯。2線=実績勝率とGlicko/RD期待勝率。",
  );
  parts.push(chapterSection(7, c7));

  // 第8章 ライバル ─ 遭遇回数と対戦結果
  const rivals = (s.rivals ?? []) as Array<Record<string, any>>;
  let c8 = chapterHeader(8, "ライバル ─ 遭遇回数と対戦結果", "よく対戦した相手をプレイヤーIDで並べ、勝敗の結果を見る。");
  c8 += fig("27_rivals", "ライバル（遭遇回数Top10）");
  if (rivals.length) {
    c8 += table(
      ["相手", "遭遇", "勝", "敗", "勝率", "最終対戦"],
      rivals.slice(0, 15).map((r) => [
        tetrioProfileLink(r.label ?? r.opponent_id ?? r.opponent, r.label ?? r.opponent ?? "?", anon),
        r.n,
        r.wins,
        r.losses,
        pct(r.win_rate),
        dateText(r.last_played),
      ]),
      { showDirection: false },
    );
  }
  const most = rivals[0];
  c8 += block(
    most ? `最も多く対戦した相手とは${most.n}回（${most.wins}勝${most.losses}敗・${pct(most.win_rate)}）。` : "対戦相手別の集計不可。",
    ["privacy"],
  );
  parts.push(chapterSection(8, c8));

  // 第9章 接戦・決着局面
  const tb = s.tiebreak as Record<string, any>;
  const scoreStates = (s.score_states ?? []) as Array<Record<string, any>>;
  const ssMap = new Map(scoreStates.map((x) => [x.label, x]));
  let c9 = chapterHeader(9, "接戦・決着局面", "接戦になったマッチをどう閉じたか。タイブレークはマッチ単位、開始前スコア状況別のラウンド勝率と最終ラウンドの能力変化はラウンド単位。");
  const ssRows = ["同点", "リード時", "ビハインド時"].filter((l) => ssMap.has(l)).map((l) => {
    const x = ssMap.get(l)!;
    return [x.label, x.n, pct(x.win_rate), nfmt(x.score_diff_mean, 2)];
  });
  const leadSs = ssMap.get("リード時");
  const behindSs = ssMap.get("ビハインド時");
  const evenSs = ssMap.get("同点");
  c9 += "<h3>開始前スコア状況別ラウンド勝率（ラウンド単位）</h3>" + grain("ラウンド単位。各ラウンドの開始前スコア状況ごとに、そのラウンドを取った率を見る。") + fig("18_score_state_next_round", "開始前スコア状況別ラウンド勝率");
  if (ssRows.length) {
    c9 += table(["状況", "標本", "ラウンド勝率", "平均スコア差"], ssRows, { showDirection: false });
  }
  c9 += block(
    leadSs && behindSs && evenSs
      ? `同点時は${pct(evenSs.win_rate)}（n=${evenSs.n}）、リード時は${pct(leadSs.win_rate)}（n=${leadSs.n}）、ビハインド時は${pct(behindSs.win_rate)}（n=${behindSs.n}）。`
      : "スコア状況別の標本を集計不可。",
    ["reverseCausation"],
    "開始前スコアでリード/同点/ビハインドに分けたラウンド勝率。",
  );
  const mpRows = ["自分MP", "相手MP", "双方MP"].filter((l) => ssMap.has(l)).map((l) => {
    const x = ssMap.get(l)!;
    return [x.label, x.n, pct(x.win_rate)];
  });
  const ownMp = ssMap.get("自分MP");
  const oppMp = ssMap.get("相手MP");
  c9 += "<h3>マッチポイント到達後の勝率（ラウンド単位）</h3>" + grain("マッチ内のマッチポイント局面を、ラウンド単位で集計。");
  if (mpRows.length) {
    c9 += table(["状況", "標本", "ラウンド勝率"], mpRows, { showDirection: false });
  }
  c9 += block(
    ownMp && oppMp ? `自分MP時は${pct(ownMp.win_rate)}（n=${ownMp.n}）、相手MP時は${pct(oppMp.win_rate)}（n=${oppMp.n}）。` : "マッチポイント局面の標本を集計不可。",
    ["smallSample"],
    "あと1本の局面を自分MP/相手MP/双方MPに分けたラウンド勝率。決着本数は最終スコア推定。",
  );
  c9 += "<h3>タイブレーク（マッチ単位）</h3>" + grain("マッチ単位。双方があと1ラウンドで勝利する最終決着局面だけを抽出。") + fig("15_tiebreak_analysis", "タイブレーク分析");
  const tbResult = (tb.n ?? 0)
    ? `タイブレークは${tb.n}マッチ、実績${pct(tb.win_rate)}、期待${pct(tb.expected)}、期待超過${pp(tb.excess)}。95% Wilson区間は${pct(tb.wilson_low)}〜${pct(tb.wilson_high)}。`
    : "タイブレーク該当マッチを抽出不可。";
  c9 += block(
    tbResult,
    ["selectionBias"],
    "最終スコア差1・双方あと1本のマッチ。棒=追いつき/追いつかれ経路別の実績と期待。",
  );
  if (tb.final_changes) {
    const changes = tb.final_changes as Record<string, any>;
    c9 += "<h3>最終ラウンドの能力変化（ラウンド単位）</h3>" + grain("ラウンド単位。同じマッチ内の最終ラウンドと、それ以前のラウンド平均を比べる。") + table(
      ["指標", "最終−それ以前"],
      ABILITY_METRICS.filter((m) => m in changes).map((m) => [m, metricFmt(m, changes[m], true)]),
    );
  }
  parts.push(chapterSection(9, c9));

  // 第10章 逆転・ビハインド展開
  const cb = (s.comeback ?? {}) as Record<string, any>;
  const fr = (cb.by_first_round ?? {}) as Record<string, any>;
  const wonFirst = (fr.won_first ?? {}) as Record<string, any>;
  const lostFirst = (fr.lost_first ?? {}) as Record<string, any>;
  const deficit = (cb.by_max_deficit ?? []) as Array<Record<string, any>>;
  let c10 = chapterHeader(10, "逆転・ビハインド展開", "第1ラウンド後の展開と、最大ビハインドからどこまで戻せたか。いずれもマッチ単位。");
  c10 += "<h3>逆転・リバーススイープ（マッチ単位）</h3>" + grain("マッチ単位。第1ラウンドの勝敗別マッチ勝率と、マッチ中に負った最大ビハインド本数別の勝率を見る。") + fig("28_comeback", "逆転・リバーススイープ");
  if (deficit.length) {
    c10 += table(["最大ビハインド", "標本", "マッチ勝率"], deficit.map((d) => [d.deficit, d.n, pct(d.win_rate)]), { showDirection: false });
  }
  const cbResult = wonFirst.n && lostFirst.n
    ? `第1ラウンドを取ったマッチは実績${pct(wonFirst.win_rate)}・期待${pct(wonFirst.expected)}・期待超過${pp(wonFirst.excess)}（n=${wonFirst.n}）、落としたマッチは実績${pct(lostFirst.win_rate)}・期待${pct(lostFirst.expected)}・期待超過${pp(lostFirst.excess)}（n=${lostFirst.n}）。2点以上のビハインドからの逆転勝ちは${cb.reverse_sweeps_n ?? 0}回。`
    : "第1ラウンド別の標本を集計不可。";
  c10 += block(
    cbResult,
    ["reverseCausation", "glickoMissing"],
    "第1ラウンド勝敗別のマッチ勝率と、最大ビハインド本数別の勝率。",
  );
  parts.push(chapterSection(10, c10));

  // 第11章 ラウンド展開とマッチ時間
  const durations = (s.duration_bins ?? []) as Array<Record<string, any>>;
  const durationFiltered = durations.filter((d) => d.n >= 20);
  const worstDuration = durationFiltered.length ? minBy(durationFiltered, (x) => num(x.win_rate) ?? Infinity)! : null;
  const dbr = (s.duration_by_result ?? {}) as Record<string, any>;
  const winDur = (dbr.win ?? {}) as Record<string, any>;
  const lossDur = (dbr.loss ?? {}) as Record<string, any>;
  let c11 = chapterHeader(11, "ラウンド展開とマッチ時間", "ラウンドが長短どの帯に入ったとき何が起きたか。決着時間分布・ラウンド時間別勝率・時間帯別の能力差分をいずれもラウンド単位で扱う。");
  c11 += "<h3>勝敗別の決着時間分布（ラウンド単位）</h3>" + grain("ラウンド単位。1本ごとの継続時間を、勝ちラウンドと負けラウンドで比べる。");
  if (Object.keys(winDur).length || Object.keys(lossDur).length) {
    c11 += table(
      ["ラウンド結果", "標本", "平均秒", "中央値秒", "P75秒"],
      [
        ["勝ちラウンド", winDur.n ?? "—", nfmt(winDur.mean, 1), nfmt(winDur.median, 1), nfmt(winDur.p75, 1)],
        ["負けラウンド", lossDur.n ?? "—", nfmt(lossDur.mean, 1), nfmt(lossDur.median, 1), nfmt(lossDur.p75, 1)],
      ],
      { showDirection: false },
    );
  }
  c11 += block(
    Object.keys(winDur).length && Object.keys(lossDur).length
      ? `勝ちラウンドの中央値は${nfmt(winDur.median, 1)}秒、負けラウンドは${nfmt(lossDur.median, 1)}秒。`
      : "勝敗別の決着時間を集計不可。",
    ["reverseCausation"],
  );
  c11 += "<h3>ラウンド決着時間別勝率（ラウンド単位）</h3>" + grain("ラウンド単位。30秒幅の決着時間帯ごとにラウンド勝率を見る。") + fig("17_round_duration", "ラウンド決着時間別勝率");
  c11 += block(
    worstDuration ? `標本20以上で最も低い帯は${htmlEscape(String(worstDuration.label))}、勝率${pct(worstDuration.win_rate)}（n=${worstDuration.n}）。` : "十分な標本の時間帯なし。",
    ["reverseCausation", "smallSample"],
    "30秒幅の決着時間帯ごとのラウンド勝率と標本数。",
  );
  const durationDeltaMetrics = [...ABILITY_METRICS, ...STYLE_ORDER];
  const deltaRows = durationFiltered.map((d) => [d.label, d.n, ...durationDeltaMetrics.map((m) => metricFmt(m, d[`delta_${m}`], true))]);
  c11 += "<h3>ラウンド決着時間帯別の能力差分（ラウンド単位）</h3>" + grain("ラウンド単位。各時間帯に入ったラウンドで、自分と相手の指標差を見る。") + fig("19_duration_metric_deltas", "ラウンド決着時間帯別の能力差分");
  if (deltaRows.length) {
    // モバイルは図と同じ主要4指標（ΔAPM/ΔPPS/ΔVS/ΔArea）＋時間帯・標本だけ残す。
    const keepMetrics = new Set(["APM", "PPS", "VS", "Area"]);
    const durationMobileCols = [0, 1, ...durationDeltaMetrics.flatMap((m, i) => (keepMetrics.has(m) ? [i + 2] : []))];
    c11 += table(["時間帯", "標本", ...durationDeltaMetrics.map((m) => `Δ${m}`)], deltaRows, { showDirection: false, minWidth: 1900, mobileColumns: durationMobileCols });
  }
  c11 += block(
    "正の差分はその時間帯で相手より優位、負は劣位。時間帯ごとに優劣がどう変わるかを見る。",
    ["smallSample", "cohortBias"],
    "各時間帯の自分−相手の指標・スタイル差の平均。図は主要4指標、表は全指標。",
  );
  parts.push(chapterSection(11, c11));

  // 第12章 連戦の流れとセッション内のマッチ位置
  const streak = s.streaks as Record<string, any>;
  const positions = (s.session_positions ?? []) as Array<Record<string, any>>;
  const streakStates = (s.streak_states ?? []) as Array<Record<string, any>>;
  const sessionDefinition = (s.session_definition ?? {}) as Record<string, any>;
  const sessionGapMinutes = sessionDefinition.gap_minutes ?? 10;
  const worstPos = positions.length ? minBy(positions, (x) => num(x.excess) ?? Infinity)! : null;
  let c12 = chapterHeader(12, "連戦の流れとセッション内のマッチ位置", "マッチとマッチの間で続く流れ。全期間の連続勝敗、同一セッション内の直前結果、セッション内のマッチ位置をマッチ単位で集計。");
  c12 += "<h3>連勝・連敗と前マッチ結果（マッチ単位）</h3>" + grain("マッチ単位。全期間の連続勝敗は個人記録、同一セッション内の直前連勝・連敗段階は次の1マッチの結果を見る。") + fig("14_streak_distribution", "連勝連敗分布");
  if (streakStates.length) {
    c12 += table(
      ["直前段階", "次マッチ勝率", "期待超過", "ΔAPM", "ΔPPS", "ΔVS", "ΔArea", "期待対象"],
      streakStates.map((r) => [r.label, pct(r.win_rate), pp(r.excess), sgn(r.d_apm, 1), sgn(r.d_pps, 2), sgn(r.d_vs, 1), sgn(r.d_area, 1), r.n]),
      { leftCols: new Set([0]), mobileColumns: [0, 1, 2, 7] },
    );
  }
  const afterLossStates = streakStates.filter((r) => ["1連敗", "2連敗", "3連敗", "4連敗以上"].includes(r.label));
  c12 += block(
    `全期間の最長連勝は${streak.max_win}、最長連敗は${streak.max_loss}。セッション内最大は連勝${streak.session_max_win ?? streak.max_win}、連敗${streak.session_max_loss ?? streak.max_loss}。` +
      (afterLossStates.length
        ? "連敗段階の期待超過は" + afterLossStates.map((r) => `${r.label}${pp(r.excess)}（期待対象n=${r.n}）`).join("、") + "。"
        : "段階別の標本が不足。"),
    ["cohortBias", "glickoMissing"],
    "棒=セッション別の最大連勝/連敗（縦軸=セッション数）。表=同一セッション内の直前段階別の次マッチ実績/期待超過/指標差分。期待対象はGlicko/RD欠損を除く。",
  );
  c12 += "<h3>セッション内のマッチ位置（マッチ単位）</h3>" + grain(`セッション内のマッチ位置。前マッチ完了直後から次マッチ開始までの間隔が${sessionGapMinutes}分以内の連戦で、何マッチ目かを見る。`) + fig("16_session_position", "セッション位置");
  if (positions.length) {
    c12 += table(
      ["区分", "実績", "期待", "期待超過", "ΔAPM", "ΔPPS", "ΔVS", "ΔArea", "期待対象"],
      positions.map((p) => [p.label, pct(p.actual), pct(p.expected), pp(p.excess), sgn(p.d_apm, 1), sgn(p.d_pps, 2), sgn(p.d_vs, 1), sgn(p.d_area, 1), p.n]),
      { leftCols: new Set([0]), mobileColumns: [0, 1, 2, 3, 8] },
    );
  }
  c12 += block(
    worstPos ? `期待超過が最も低い区分は${htmlEscape(String(worstPos.label))}で${pp(worstPos.excess)}（期待対象n=${worstPos.n}）、実績${pct(worstPos.actual)}・期待${pct(worstPos.expected)}。` : "セッション位置を集計不可。",
    ["cohortBias", "smallSample", "glickoMissing"],
    "1〜10マッチ目は各1、11以降はまとめ。指標差分=各区分平均と全完了マッチ平均の差。期待対象はGlicko/RD欠損を除く。",
  );
  const decay = (s.session_decay ?? []) as Array<Record<string, any>>;
  c12 += "<h3>セッション内の失速曲線（マッチ単位）</h3>" + grain("マッチ単位。セッション内のマッチ位置ごとに、勝率とAPM・PPS・VS・Areaがどう変わるかを見る。") + fig("29_session_decay", "セッション内の失速曲線");
  if (decay.length) {
    c12 += table(
      ["位置", "勝率", "APM", "PPS", "VS", "Area", "標本"],
      decay.map((r) => [r.label, pct(r.win_rate), nfmt(r.apm, 1), nfmt(r.pps, 2), nfmt(r.vs, 1), nfmt(r.area, 1), r.n]),
      { leftCols: new Set([0]), mobileColumns: [0, 1, 2, 6] },
    );
  }
  const decayValid = decay.filter((r) => r.n >= 20);
  const decayLow = decayValid.length ? minBy(decayValid, (r) => num(r.win_rate) ?? Infinity)! : null;
  c12 += block(
    decayLow ? `標本20以上で勝率が最も低い位置は${htmlEscape(String(decayLow.label))}で${pct(decayLow.win_rate)}（APM ${nfmt(decayLow.apm, 1)}、n=${decayLow.n}）。` : "位置別の失速を集計不可。",
    ["selectionBias", "smallSample", "normalized"],
    "位置別の勝率（棒）とAPM/PPS/VS/Area（1マッチ目=100で正規化した4線）。",
  );
  parts.push(chapterSection(12, c12));

  // 第13章 リプレイ確認候補
  const replayCandidates = (s.replay_candidates ?? []) as Array<Record<string, any>>;
  const topReplay = replayCandidates[0];
  let c13 = chapterHeader(13, "リプレイ確認候補", "接戦の分岐点や普段と挙動が違ったラウンドを、リプレイで振り返る候補として並べる。各候補に見るポイントを付す。");
  if (replayCandidates.length) {
    const replayItems = replayCandidates.map((r) => {
      const opponent = tetrioProfileLink(r.opponent ?? r.opponent_id, r.opponent ?? r.opponent_id ?? "?", anon);
      const score = r.target_score !== null && r.target_score !== undefined && r.opponent_score !== null && r.opponent_score !== undefined
        ? `${r.target_score}-${r.opponent_score}`
        : r.match_won ? "勝ち" : "負け";
      const priority = String(r.priority ?? "中");
      const priorityBadge = `<span class="badge ${priority === "高" ? "hi" : "mid"}">${htmlEscape(priority)}</span>`;
      const scene = String(r.scene ?? "");
      const resultBadge = scene
        ? `<span class="badge ${scene === "勝利" ? "good" : "bad"}">${htmlEscape(scene)}</span>`
        : "—";
      const condition = htmlEscape(String(r.condition ?? ""));
      const detailText = r.detail ? htmlEscape(String(r.detail)) : "";
      const detail = detailText ? `<br><span class="muted">${detailText}</span>` : "";
      const watch = r.watch_point ? htmlEscape(String(r.watch_point)) : "";
      const watchLine = watch ? `<br><span class="muted">見るポイント: ${watch}</span>` : "";
      const matchLine = `<span class="muted">${dateText(r.date)} ${score} vs</span> ${opponent}`;
      let targetLabel: string;
      if (String(r.kind ?? "round") === "match") {
        const facts = [
          r.match_won ? "勝ち" : "負け",
          `全${htmlEscape(String(r.total_rounds ?? "?"))}R`,
          durationText(r.match_duration_s),
        ].filter(Boolean).join("・");
        targetLabel = `<b>マッチ全体</b>（${facts}）<br>${matchLine}`;
      } else {
        const roundFacts = [
          r.won ? "勝ち" : "負け",
          r.score_before ? `開始${htmlEscape(String(r.score_before))}` : "",
          r.lifetime_s !== null && r.lifetime_s !== undefined ? `${nfmt(r.lifetime_s, 1)}秒` : "",
        ].filter(Boolean).join("・");
        targetLabel =
          `<b>R${htmlEscape(String(r.round ?? "?"))}</b>／全${htmlEscape(String(r.total_rounds ?? "?"))}R（${roundFacts}）` +
          `<br>${matchLine}`;
      }
      const link = r.replay_available ? replayLink(r.replay_id, anon) : `<span class="muted">削除済み</span>`;
      return { scene, priorityBadge, resultBadge, condition, detail, detailText, watch, watchLine, targetLabel, link };
    });
    const replaySection = (title: string, scene: "勝利" | "敗北") => {
      const items = replayItems.filter((it) => it.scene === scene);
      if (!items.length) {
        return `<h3>${title}</h3><p class="muted">表示できる${title}なし。</p>`;
      }
      // デスクトップは一覧表、モバイルは1候補=1カードで縦のスクロール距離を抑える。
      const desktopTable = table(
        ["優先度", "見るリプレイ（条件）", "対象", "リプレイ"],
        items.map((it) => [it.priorityBadge, it.condition + it.detail + it.watchLine, it.targetLabel, it.link]),
        { leftCols: new Set([0, 1, 2, 3]), minWidth: 820, showDirection: false },
      );
      const mobileCards = items
        .map((it) =>
          `<div class="rc-card">` +
          `<div class="rc-head">${it.priorityBadge}${it.resultBadge}<span class="rc-cond">${it.condition}</span></div>` +
          `<div class="rc-detail">${it.detailText}</div>` +
          `${it.watch ? `<div class="rc-watch muted">見るポイント: ${it.watch}</div>` : ""}` +
          `<div class="rc-target">${it.targetLabel}</div>` +
          `<div class="rc-link">${it.link}</div>` +
          `</div>`,
        )
        .join("");
      return `<h3>${title}</h3><div class="only-desktop">${desktopTable}</div><div class="only-mobile rc-list">${mobileCards}</div>`;
    };
    c13 += replaySection("勝利したリプレイ", "勝利");
    c13 += replaySection("敗北したリプレイ", "敗北");
  } else {
    c13 += `<p class="muted">表示できるリプレイ確認候補なし。</p>`;
  }
  c13 += block(
    topReplay
      ? `最上位候補は${dateText(topReplay.date)}の${htmlEscape(anon.opponent(topReplay.opponent ?? topReplay.opponent_id, "相手不明"))}戦${topReplay.round ? `R${htmlEscape(String(topReplay.round))}` : "マッチ全体"}（${htmlEscape(String(topReplay.condition ?? ""))}）。`
      : "候補を抽出不可。",
    ["replayExpiry", "replayNotInspected"],
    "条件×優先度で勝利・敗北それぞれ最大5件。削除済みも参考表示。",
  );
  parts.push(chapterSection(13, c13));

  return parts.join("");
}

function chapterSection(number: number, inner: string): string {
  return `<section class="chapter" id="chapter-${number}">${inner}</section>`;
}

function dateText(value: unknown): string {
  return value ? String(value).slice(0, 10) : "—";
}

function durationText(value: unknown): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}分${rest}秒` : `${rest}秒`;
}
