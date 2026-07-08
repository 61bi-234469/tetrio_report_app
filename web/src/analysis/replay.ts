import type { MatchRow, RoundRow } from "./types";
import { mean, quantile, robustZFactory } from "./stats";
import { expectedExcess, groupWinRate } from "./aggregate";
import { STYLE_PLANE_MIN_MATCHES, STYLE_QUADRANTS } from "./model";
import { groupBy, toNumber } from "../utils";

// 条件ベースのリプレイ選定で使う、ラウンドごとの計算済みシグナル。
interface ReplayRoundStat {
  match: MatchRow;
  roundNumber: number;
  totalRounds: number;
  roundWon: boolean;
  matchWon: boolean;
  scoreBefore: string;
  scoreDiffBefore: number;
  ownMp: boolean;
  opponentMp: boolean;
  finalRound: boolean;
  expected: number | null;
  residual: number | null;
  metricLabel: string | null;
  metricValue: number | null;
  metricZ: number | null;
  metricMedian: number | null;
  metricDigits: number;
  durationZ: number | null;
  lifetimeS: number | null;
  recvRate: number | null;
  recvRateZ: number | null;
  garbageReceived: number | null;
  // high_output_loss用: 「絶対値最大の1指標」に埋もれないよう、APM/VSのzを個別に保持する。
  apmZ: number | null;
  apmValue: number | null;
  apmMedian: number | null;
  vsZ: number | null;
  vsValue: number | null;
  vsMedian: number | null;
}

// 条件ラベル・detail用の指標名（自分の値そのものを表すため「差」は付けない）。
const METRIC_PLAIN_NAMES: Record<string, string> = {
  APM: "火力（APM）",
  PPS: "速度（PPS）",
  VS: "総合火力（VS）",
  Area: "総合力（Area）",
};

type ReplayScene = "勝利" | "敗北";

function replayScene(won: boolean): ReplayScene {
  return won ? "勝利" : "敗北";
}

// ラウンド単位の静的条件。自分の普段の分布に対するロバストz（相手の強さと自分の
// 出来を分離するため、差ではなく自分の値そのものを使う）を軸に据える。
// マッチ単位の条件（スタイル相性・セッション失速・upset・ライバル）と、区分認定に
// 依存する動的条件（勝率の低い時間帯）は buildReplayCandidates 内で組み立てる。
const ROUND_REPLAY_CONDITIONS: Array<{
  key: string;
  label: (r: ReplayRoundStat) => string;
  priority: (r: ReplayRoundStat) => "高" | "中";
  test: (r: ReplayRoundStat) => boolean;
  magnitude: (r: ReplayRoundStat) => number;
  detail: (r: ReplayRoundStat) => string;
  watch: string;
}> = [
  {
    key: "opp_mp_lost",
    label: () => "相手のマッチポイントで落としたラウンド",
    // 接戦だった／勝てるはずだった／指標異常を伴う場合のみ「高」。それ以外は
    // 一方的な敗戦の最終ラウンドに過ぎないため、そもそもヒットさせない。
    priority: (r) => (r.scoreDiffBefore >= -1 || (r.expected !== null && r.expected >= 0.5) ? "高" : "中"),
    test: (r) =>
      r.opponentMp &&
      !r.roundWon &&
      (r.scoreDiffBefore >= -1 || (r.expected !== null && r.expected >= 0.5) || Math.abs(r.metricZ ?? 0) >= 1.5),
    magnitude: (r) => 2 + Math.abs(r.metricZ ?? 0),
    detail: (r) => (r.ownMp ? "双方マッチポイント" : ""),
    watch: "マッチ最終盤の守備。受ける形を作れていたか",
  },
  {
    key: "own_mp_missed",
    label: () => "自分のマッチポイントで取り切れなかったラウンド",
    priority: () => "高",
    // 最終的に逆転負けしたマッチのMP失敗のみ。勝ち切ったマッチでの取り逃しは実害が小さい。
    test: (r) => r.ownMp && !r.opponentMp && !r.roundWon && !r.matchWon,
    magnitude: (r) => 1.5 + Math.abs(r.metricZ ?? 0),
    detail: () => "",
    watch: "取り切りの一手。攻め急ぎや過剰な安全策がないか",
  },
  {
    key: "opp_mp_saved",
    label: () => "相手のマッチポイントをしのいだラウンド",
    priority: () => "高",
    // 逆転勝ちに繋がった凌ぎのみ。
    test: (r) => r.opponentMp && r.roundWon && r.matchWon,
    magnitude: (r) => 1.5 + Math.abs(r.metricZ ?? 0),
    detail: (r) => (r.ownMp ? "双方マッチポイント" : ""),
    watch: "劣勢からの立て直し方。守備から反撃への切り替え",
  },
  {
    key: "metric_low",
    label: (r) => `${METRIC_PLAIN_NAMES[r.metricLabel ?? ""] ?? "指標"}が普段より大きく落ちたラウンド`,
    priority: (r) => ((r.metricZ ?? 0) <= -2.5 ? "高" : "中"),
    // 10秒未満の極短ラウンドはレート系指標がノイズになるため対象外。
    test: (r) => (r.metricZ ?? 0) <= -1.5 && (r.lifetimeS ?? 0) >= 10,
    magnitude: (r) => Math.abs(r.metricZ ?? 0),
    detail: (r) =>
      r.metricLabel && r.metricValue !== null
        ? `${r.metricLabel} ${r.metricValue.toFixed(r.metricDigits)}${r.metricMedian !== null ? `（普段の中央値 ${r.metricMedian.toFixed(r.metricDigits)}）` : ""}`
        : "",
    watch: "普段との違い。手が止まった場面や置きミスの有無",
  },
  {
    key: "metric_high",
    label: (r) => `${METRIC_PLAIN_NAMES[r.metricLabel ?? ""] ?? "指標"}が普段より大きく出たラウンド`,
    priority: () => "中",
    test: (r) => (r.metricZ ?? 0) >= 1.5 && (r.lifetimeS ?? 0) >= 10,
    magnitude: (r) => Math.abs(r.metricZ ?? 0),
    detail: (r) =>
      r.metricLabel && r.metricValue !== null
        ? `${r.metricLabel} ${r.metricValue.toFixed(r.metricDigits)}${r.metricMedian !== null ? `（普段の中央値 ${r.metricMedian.toFixed(r.metricDigits)}）` : ""}`
        : "",
    watch: "良かった動きの再現性。普段と何が違ったか",
  },
  {
    key: "high_output_loss",
    label: () => "火力は出ていたのに落としたラウンド",
    priority: () => "高",
    // metricZ/metricLabelは「絶対値最大の1指標」しか保持しないため、PPS/Areaの低下が
    // APM/VSの上振れより大きいラウンドで取りこぼさないよう、APM・VSのzを個別に見る。
    test: (r) => !r.roundWon && Math.max(r.apmZ ?? -Infinity, r.vsZ ?? -Infinity) >= 1.5,
    magnitude: (r) => Math.max(r.apmZ ?? -Infinity, r.vsZ ?? -Infinity),
    detail: (r) => {
      const useApm = (r.apmZ ?? -Infinity) >= (r.vsZ ?? -Infinity);
      const label = useApm ? "APM" : "VS";
      const value = useApm ? r.apmValue : r.vsValue;
      const median = useApm ? r.apmMedian : r.vsMedian;
      return value !== null ? `${label} ${value.toFixed(1)}${median !== null ? `（普段の中央値 ${median.toFixed(1)}）` : ""}` : "";
    },
    watch: "火力で押し切れなかった理由。相殺のタイミングと撃ち合いの選択",
  },
  {
    key: "pressure_survived",
    label: () => "重い被弾を凌ぎ切ったラウンド",
    priority: (r) => ((r.recvRateZ ?? 0) >= 2.5 ? "高" : "中"),
    test: (r) => r.roundWon && (r.recvRateZ ?? 0) >= 1.5,
    magnitude: (r) => Math.abs(r.recvRateZ ?? 0),
    detail: (r) =>
      r.garbageReceived !== null && r.lifetimeS !== null
        ? `被弾${r.garbageReceived.toFixed(0)}ライン／${r.lifetimeS.toFixed(0)}秒`
        : "",
    watch: "掘りの手順。受けながら攻撃を返せていたか",
  },
  {
    key: "pressure_collapsed",
    label: () => "重い被弾を受けきれなかったラウンド",
    priority: (r) => ((r.recvRateZ ?? 0) >= 2.5 ? "高" : "中"),
    test: (r) => !r.roundWon && (r.recvRateZ ?? 0) >= 1.5,
    magnitude: (r) => Math.abs(r.recvRateZ ?? 0),
    detail: (r) =>
      r.garbageReceived !== null && r.lifetimeS !== null
        ? `被弾${r.garbageReceived.toFixed(0)}ライン／${r.lifetimeS.toFixed(0)}秒`
        : "",
    watch: "掘り切れなかった原因。掘る択と逃げる択の判断",
  },
  {
    key: "behind_recovered",
    label: () => "2点以上ビハインドから取り返したラウンド",
    priority: () => "中",
    test: (r) => r.scoreDiffBefore <= -2 && r.roundWon && !r.opponentMp,
    magnitude: (r) => Math.abs(r.scoreDiffBefore),
    detail: () => "",
    watch: "連敗を止めた切り替え。立て直しの初手",
  },
  {
    key: "long_round",
    label: () => "普段より大きく長引いたラウンド",
    priority: () => "中",
    test: (r) => (r.durationZ ?? 0) >= 2,
    magnitude: (r) => Math.abs(r.durationZ ?? 0),
    detail: (r) => (r.lifetimeS !== null ? `${r.lifetimeS.toFixed(0)}秒` : ""),
    watch: "長期戦の消耗。終盤の精度低下と形の崩れ",
  },
  {
    key: "fast_loss",
    label: () => "開幕からすぐ落としたラウンド",
    priority: () => "中",
    test: (r) => (r.durationZ ?? 0) <= -2 && !r.roundWon,
    magnitude: (r) => Math.abs(r.durationZ ?? 0),
    detail: (r) => (r.lifetimeS !== null ? `${r.lifetimeS.toFixed(0)}秒` : ""),
    watch: "開幕直後の被弾。テンプレ精度と初手の噛み合わせ",
  },
];

// 被弾レート（ライン/分）。10秒未満の極短ラウンドはレートがノイズになるため対象外。
function computeRecvRate(round: RoundRow): number | null {
  const received = toNumber(round.garbage_received);
  const lifetimeS = toNumber(round.lifetime_s);
  return received !== null && lifetimeS !== null && lifetimeS >= 10 ? received / (lifetimeS / 60) : null;
}

export function buildReplayCandidates(matches: MatchRow[], rounds: RoundRow[]): Array<Record<string, unknown>> {
  // 自分の普段の分布に対するロバストz。相手の強さと自分の出来を分離するため、
  // 差ではなく自分の値そのものをスケーリング対象にする。
  const metricKeys = [
    ["APM", "apm", 1],
    ["PPS", "pps", 2],
    ["VS", "vs", 1],
    ["Area", "Area", 1],
  ] as const;
  const scalers = new Map<string, (value: unknown) => number | null>();
  const medians = new Map<string, number | null>();
  for (const [, own] of metricKeys) {
    const values = rounds.map((round) => toNumber(round[own]));
    scalers.set(own, robustZFactory(values));
    medians.set(own, quantile(values.filter((v): v is number => v !== null), 0.5));
  }
  scalers.set("lifetime_s", robustZFactory(rounds.map((round) => round.lifetime_s)));
  const recvRateScaler = robustZFactory(rounds.map((round) => computeRecvRate(round)));
  const roundsByMatch = groupBy(rounds, (round) => Number(round.match_number));
  const matchByNumber = new Map(matches.map((match) => [Number(match.match_number), match]));

  // 1) 各ラウンドのシグナルを先に計算する。リプレイ削除済みマッチも候補に含め、
  //    リンク可否は replay_available で表示側へ伝える。
  const stats: ReplayRoundStat[] = [];
  for (const [matchNumber, group] of roundsByMatch.entries()) {
    const match = matchByNumber.get(Number(matchNumber));
    if (!match) {
      continue;
    }
    const sorted = [...group].sort((a, b) => Number(a.round) - Number(b.round));
    const targetScore = toNumber(match.target_score);
    const opponentScore = toNumber(match.opponent_score);
    const threshold = targetScore !== null && opponentScore !== null ? Math.max(targetScore, opponentScore) : null;
    const expected = toNumber(match.expected_win);
    const residual = expected === null ? null : (match.won ? 1 : 0) - expected;
    let ownScore = 0;
    let opponentScoreBefore = 0;
    for (const round of sorted) {
      let metricLabel: string | null = null;
      let metricValue: number | null = null;
      let metricZ: number | null = null;
      let metricMedian: number | null = null;
      let metricDigits = 1;
      let apmZ: number | null = null;
      let apmValue: number | null = null;
      let vsZ: number | null = null;
      let vsValue: number | null = null;
      for (const [label, own, digits] of metricKeys) {
        const ownValue = toNumber(round[own]);
        const z = scalers.get(own)?.(ownValue) ?? null;
        if (label === "APM") {
          apmZ = z;
          apmValue = ownValue;
        }
        if (label === "VS") {
          vsZ = z;
          vsValue = ownValue;
        }
        if (z === null) {
          continue;
        }
        if (metricZ === null || Math.abs(z) > Math.abs(metricZ)) {
          metricLabel = label;
          metricValue = ownValue;
          metricZ = z;
          metricMedian = medians.get(own) ?? null;
          metricDigits = digits;
        }
      }
      const recvRate = computeRecvRate(round);
      stats.push({
        match,
        roundNumber: Number(round.round),
        totalRounds: sorted.length,
        roundWon: Boolean(round.round_won),
        matchWon: Boolean(match.won),
        scoreBefore: `${ownScore}-${opponentScoreBefore}`,
        scoreDiffBefore: ownScore - opponentScoreBefore,
        ownMp: threshold !== null && ownScore === threshold - 1,
        opponentMp: threshold !== null && opponentScoreBefore === threshold - 1,
        finalRound: round === sorted.at(-1),
        expected,
        residual,
        metricLabel,
        metricValue,
        metricZ,
        metricMedian,
        metricDigits,
        durationZ: scalers.get("lifetime_s")?.(round.lifetime_s) ?? null,
        lifetimeS: toNumber(round.lifetime_s),
        recvRate,
        recvRateZ: recvRateScaler(recvRate),
        garbageReceived: toNumber(round.garbage_received),
        apmZ,
        apmValue,
        apmMedian: medians.get("apm") ?? null,
        vsZ,
        vsValue,
        vsMedian: medians.get("vs") ?? null,
      });
      if (round.round_won) ownScore += 1;
      else opponentScoreBefore += 1;
    }
  }

  // 2) マッチ単位の候補元と、区分認定（全マッチ・全ラウンド）。
  const weakQuadrant = findWeakStyleQuadrant(matches);
  const weakBins = findWeakDurationBins(rounds);
  const sessionBaselines = sessionOpenerBaselines(matches);
  const strugglingRivals = findStrugglingRivals(matches);

  // 3) 条件ヒットを集める。ラウンド単位の静的条件＋動的条件（勝率の低い時間帯）。
  const hits: ReplayHit[] = [];
  for (const stat of stats) {
    const base = {
      kind: "round" as const,
      date: String(stat.match.played_at_jst ?? ""),
      matchNumber: Number(stat.match.match_number),
      roundKey: `${stat.match.match_number}-${stat.roundNumber}`,
      row: roundHitRow(stat),
      score: 0,
    };
    for (const condition of ROUND_REPLAY_CONDITIONS) {
      if (!condition.test(stat)) {
        continue;
      }
      hits.push({
        ...base,
        key: condition.key,
        priority: condition.priority(stat),
        scene: replayScene(stat.roundWon),
        label: condition.label(stat),
        detail: condition.detail(stat),
        magnitude: condition.magnitude(stat),
        watch: condition.watch,
      });
    }
    if (!stat.roundWon && stat.lifetimeS !== null) {
      const bin = weakBins.find((b) => stat.lifetimeS! >= b.start && stat.lifetimeS! < b.end);
      if (bin) {
        hits.push({
          ...base,
          key: "weak_time_loss",
          priority: "中",
          scene: "敗北",
          label: `勝率の低い時間帯（${bin.label}）で落としたラウンド`,
          detail: `この帯のラウンド勝率${Math.round(bin.winRate * 100)}%`,
          magnitude: bin.deficit + Math.min(Math.abs(stat.metricZ ?? 0), 3) * 0.01,
          watch: "この時間帯特有の負け筋の有無",
        });
      }
    }
  }
  for (const match of matches) {
    const matchNumber = Number(match.match_number);
    const group = roundsByMatch.get(matchNumber) ?? [];
    const durations = group.map((round) => toNumber(round.lifetime_s)).filter((v): v is number => v !== null);
    const base = {
      kind: "match" as const,
      date: String(match.played_at_jst ?? ""),
      matchNumber,
      roundKey: null,
      row: matchHitRow(match, group.length, durations.length ? durations.reduce((a, b) => a + b, 0) : null),
      score: 0,
    };
    const expected = toNumber(match.expected_win);
    if (weakQuadrant && weakQuadrant.predicate(match)) {
      const depth =
        Math.abs(Number(match["opponent_Opener - Inf DS"])) + Math.abs(Number(match["opponent_Stride - Plonk"]));
      const detail = `${weakQuadrant.label}／この分類は期待勝率比${Math.round(weakQuadrant.excess * 100)}pt`;
      const watch = "相手スタイルへの対応。序盤にどう合わせたか";
      if (match.won) {
        hits.push({ ...base, key: "style_weak_win", priority: "中", scene: "勝利", label: "相性の悪いスタイルに勝てたマッチ", detail, magnitude: depth, watch });
      } else {
        hits.push({ ...base, key: "style_weak_loss", priority: "高", scene: "敗北", label: "相性の悪いスタイルに落としたマッチ", detail, magnitude: depth, watch });
      }
    }
    const drop = sessionMetricDrop(match, sessionBaselines);
    if (drop && !match.won) {
      hits.push({
        ...base,
        key: "session_fatigue",
        priority: "中",
        scene: "敗北",
        label: "セッション終盤で指標が落ちたマッチ",
        detail: `セッション${drop.position}戦目・${drop.metric}${Math.round(drop.pct * 100)}%`,
        magnitude: Math.abs(drop.pct),
        watch: "セッション終盤の集中力。操作の雑さや判断の遅れ",
      });
    }
    if (expected !== null && !match.won && expected >= 0.6) {
      hits.push({ ...base, key: "upset_loss", priority: "高", scene: "敗北", label: "勝てそうだった相手に落としたマッチ", detail: `マッチ勝ち期待${Math.round(expected * 100)}%`, magnitude: expected, watch: "想定より競った理由。どこで流れを失ったか" });
    }
    if (expected !== null && match.won && expected <= 0.4) {
      hits.push({ ...base, key: "upset_win", priority: "中", scene: "勝利", label: "格上に勝ち切ったマッチ", detail: `マッチ勝ち期待${Math.round(expected * 100)}%`, magnitude: 1 - expected, watch: "格上に通用した動き。何が機能したか" });
    }
    const rival = strugglingRivals.get(String(match.opponent_id ?? ""));
    if (rival && !match.won) {
      hits.push({
        ...base,
        key: "rival_struggle",
        priority: "中",
        scene: "敗北",
        label: "苦手にしているライバルに落としたマッチ",
        detail: `対戦${rival.n}回・勝率${Math.round(rival.winRate * 100)}%`,
        magnitude: 1 - rival.winRate + rival.n * 0.001,
        watch: "毎回同じ負け方をしていないか",
      });
    }
  }

  // 4) 共通スコア化: 条件内の相対順位（中央順位percentile、1件なら0.5）＋優先度「高」は+0.5。
  //    異種の外れ値（σ・期待勝率・低下率）を単位換算せずに比べるための相対化。
  for (const group of groupBy(hits, (hit) => hit.key).values()) {
    group.sort((a, b) => b.magnitude - a.magnitude || b.date.localeCompare(a.date));
    group.forEach((hit, index) => {
      hit.score = (group.length - index - 0.5) / group.length + (hit.priority === "高" ? 0.5 : 0);
    });
  }

  // 4-1) 同一ラウンドの複数条件ヒットを統合する。最高スコアのヒットを代表とし、
  //      他の該当条件をdetailに追記、複数シグナルの分だけ加点する。
  const roundGroups = groupBy(
    hits.filter((hit) => hit.kind === "round"),
    (hit) => hit.roundKey as string,
  );
  const merged: ReplayHit[] = hits.filter((hit) => hit.kind === "match");
  for (const group of roundGroups.values()) {
    const sortedGroup = [...group].sort((a, b) => b.score - a.score);
    const representative = sortedGroup[0]!;
    const others = sortedGroup.slice(1);
    if (others.length > 0) {
      representative.score += 0.25 * Math.min(others.length, 2);
      const extra = `他の該当: ${others.map((o) => o.label).join("、")}`;
      representative.detail = representative.detail ? `${representative.detail}／${extra}` : extra;
    }
    merged.push(representative);
  }

  // 4-2) 新しさの重み。最新マッチ日時を基準に、直近ほど加点する（8週間で0に線形減衰）。
  const latestDate = matches
    .map((match) => String(match.played_at_jst ?? ""))
    .filter((date) => date)
    .sort()
    .at(-1);
  const latestTime = latestDate ? new Date(latestDate.replace(" ", "T")).getTime() : NaN;
  if (!Number.isNaN(latestTime)) {
    for (const hit of merged) {
      const hitTime = new Date(hit.date.replace(" ", "T")).getTime();
      if (Number.isNaN(hitTime)) {
        continue;
      }
      const ageDays = (latestTime - hitTime) / (1000 * 60 * 60 * 24);
      hit.score += 0.3 * Math.max(0, 1 - ageDays / 56);
    }
  }

  const ranked = [...merged].sort(compareReplayHits);

  // 5) 付帯ルール: 勝利・敗北それぞれ最大5件、同一条件2件、同一マッチは種別ごと1件、
  //    種別ごと6件、同一ラウンドの重複なし。
  const selected = [
    ...selectReplayBucket(ranked, "勝利", 5),
    ...selectReplayBucket(ranked, "敗北", 5),
  ];

  return selected
    .sort(compareReplayHits)
    .map((hit) => ({
      ...hit.row,
      kind: hit.kind,
      condition: hit.label,
      condition_key: hit.key,
      scene: hit.scene,
      priority: hit.priority,
      detail: hit.detail,
      watch_point: hit.watch,
    }));
}

function compareReplayHits(a: ReplayHit, b: ReplayHit): number {
  return Number(replayHitAvailable(b)) - Number(replayHitAvailable(a)) || b.score - a.score || b.date.localeCompare(a.date);
}

function selectReplayBucket(ranked: ReplayHit[], scene: ReplayScene, limit: number): ReplayHit[] {
  const selected: ReplayHit[] = [];
  for (const hit of ranked) {
    if (selected.length >= limit) {
      break;
    }
    if (hit.scene === scene && replayHitFits(hit, selected)) {
      selected.push(hit);
    }
  }
  return selected;
}

function replayHitAvailable(hit: ReplayHit): boolean {
  return hit.row.replay_available === true;
}

// 条件ヒット1件。kind=round はラウンド単位、kind=match はマッチ全体を見る候補。
interface ReplayHit {
  key: string;
  kind: "round" | "match";
  priority: "高" | "中";
  scene: ReplayScene;
  label: string;
  detail: string;
  magnitude: number;
  watch: string;
  date: string;
  matchNumber: number;
  roundKey: string | null;
  row: Record<string, unknown>;
  score: number;
}

function roundHitRow(stat: ReplayRoundStat): Record<string, unknown> {
  return {
    match_number: stat.match.match_number,
    round: stat.roundNumber,
    total_rounds: stat.totalRounds,
    date: stat.match.played_at_jst,
    opponent: stat.match.opponent ?? stat.match.opponent_id ?? null,
    opponent_id: stat.match.opponent_id ?? null,
    won: stat.roundWon,
    match_won: stat.matchWon,
    target_score: toNumber(stat.match.target_score),
    opponent_score: toNumber(stat.match.opponent_score),
    score_before: stat.scoreBefore,
    lifetime_s: stat.lifetimeS,
    expected_win: stat.expected,
    replay_id: stat.match.replay_id ?? null,
    replay_available: Boolean(stat.match.replay_id && !stat.match.replay_stub),
    match_id: stat.match.match_id ?? null,
  };
}

function matchHitRow(match: MatchRow, totalRounds: number, durationS: number | null): Record<string, unknown> {
  return {
    match_number: match.match_number,
    round: null,
    total_rounds: totalRounds,
    date: match.played_at_jst,
    opponent: match.opponent ?? match.opponent_id ?? null,
    opponent_id: match.opponent_id ?? null,
    won: match.won,
    match_won: match.won,
    target_score: toNumber(match.target_score),
    opponent_score: toNumber(match.opponent_score),
    score_before: null,
    lifetime_s: null,
    match_duration_s: durationS,
    expected_win: toNumber(match.expected_win),
    replay_id: match.replay_id ?? null,
    replay_available: Boolean(match.replay_id && !match.replay_stub),
    match_id: match.match_id ?? null,
  };
}

// 付帯ルールの制約チェック（追加候補が既選定と両立するか）。
function replayHitFits(hit: ReplayHit, selected: ReplayHit[]): boolean {
  if (selected.filter((s) => s.key === hit.key).length >= 2) {
    return false;
  }
  if (selected.filter((s) => s.kind === hit.kind).length >= 6) {
    return false;
  }
  // 同一マッチは最大2件。マッチ全体の候補は1マッチ1件（ラウンド候補とは併載可）。
  if (selected.filter((s) => s.matchNumber === hit.matchNumber).length >= 2) {
    return false;
  }
  if (hit.kind === "match" && selected.some((s) => s.matchNumber === hit.matchNumber && s.kind === "match")) {
    return false;
  }
  if (hit.roundKey && selected.some((s) => s.roundKey === hit.roundKey)) {
    return false;
  }
  return true;
}

// スタイル4象限のうち期待超過が最も低い象限を「苦手スタイル」と認定する。
// 標本ゲートは第12章の平面と同じ全体30マッチ、象限は10マッチ以上、期待超過-3pt以下。
function findWeakStyleQuadrant(
  matches: MatchRow[],
): { label: string; winRate: number; excess: number; predicate: (match: MatchRow) => boolean } | null {
  const valid = matches.filter(
    (match) => toNumber(match["opponent_Stride - Plonk"]) !== null && toNumber(match["opponent_Opener - Inf DS"]) !== null,
  );
  if (valid.length < STYLE_PLANE_MIN_MATCHES) {
    return null;
  }
  let worst: { label: string; winRate: number; predicate: (match: MatchRow) => boolean; excess: number } | null = null;
  for (const [label, predicate] of STYLE_QUADRANTS) {
    const group = valid.filter((match) => predicate(match) && toNumber(match.expected_win) !== null);
    if (group.length < 10) {
      continue;
    }
    const excess = expectedExcess(group);
    const winRate = groupWinRate(group);
    if (excess === null || winRate === null || excess > -0.03) {
      continue;
    }
    if (!worst || excess < worst.excess) {
      worst = { label, winRate, predicate, excess };
    }
  }
  return worst;
}

// ラウンド勝率が全体より10pt以上低い30秒幅の決着時間帯（標本20以上、全体100ラウンド以上）。
function findWeakDurationBins(
  rounds: RoundRow[],
): Array<{ start: number; end: number; label: string; winRate: number; deficit: number }> {
  const valid = rounds.filter((round) => toNumber(round.lifetime_s) !== null);
  if (valid.length < 100) {
    return [];
  }
  const overall = mean(valid.map((round) => (round.round_won ? 1 : 0)));
  if (overall === null) {
    return [];
  }
  const out: Array<{ start: number; end: number; label: string; winRate: number; deficit: number }> = [];
  for (const [start, group] of groupBy(valid, (round) => Math.floor(Number(round.lifetime_s) / 30) * 30).entries()) {
    if (group.length < 20) {
      continue;
    }
    const winRate = mean(group.map((round) => (round.round_won ? 1 : 0)));
    if (winRate === null || winRate > overall - 0.1) {
      continue;
    }
    out.push({ start, end: start + 30, label: `${start}–${start + 30}秒`, winRate, deficit: overall - winRate });
  }
  return out;
}

// セッション1〜2戦目の平均APM/PPSを、そのセッションの基準値とする。
function sessionOpenerBaselines(matches: MatchRow[]): Map<unknown, { apm: number | null; pps: number | null }> {
  const map = new Map<unknown, { apm: number | null; pps: number | null }>();
  for (const [sessionId, group] of groupBy(matches, (match) => match.session_id).entries()) {
    const openers = group.filter((match) => Number(match.session_position) <= 2);
    map.set(sessionId, { apm: mean(openers.map((match) => match.apm)), pps: mean(openers.map((match) => match.pps)) });
  }
  return map;
}

// セッション5戦目以降で、基準比10%以上落ちた指標があれば最も落ちたものを返す。
function sessionMetricDrop(
  match: MatchRow,
  baselines: Map<unknown, { apm: number | null; pps: number | null }>,
): { position: number; metric: "APM" | "PPS"; pct: number } | null {
  const position = Number(match.session_position);
  if (!Number.isFinite(position) || position < 5) {
    return null;
  }
  const base = baselines.get(match.session_id);
  if (!base) {
    return null;
  }
  let worst: { metric: "APM" | "PPS"; pct: number } | null = null;
  for (const metric of ["APM", "PPS"] as const) {
    const baseline = metric === "APM" ? base.apm : base.pps;
    const value = toNumber(metric === "APM" ? match.apm : match.pps);
    if (baseline === null || baseline <= 0 || value === null) {
      continue;
    }
    const pct = value / baseline - 1;
    if (pct <= -0.1 && (!worst || pct < worst.pct)) {
      worst = { metric, pct };
    }
  }
  return worst ? { position, ...worst } : null;
}

// 3回以上対戦して勝率30%以下の相手。
function findStrugglingRivals(matches: MatchRow[]): Map<string, { n: number; winRate: number }> {
  const map = new Map<string, { n: number; winRate: number }>();
  for (const [opponentId, group] of groupBy(matches, (match) => String(match.opponent_id ?? "")).entries()) {
    if (!opponentId.trim() || group.length < 3) {
      continue;
    }
    const winRate = group.filter((match) => match.won).length / group.length;
    if (winRate <= 0.3) {
      map.set(opponentId, { n: group.length, winRate });
    }
  }
  return map;
}
