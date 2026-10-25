import { describe, expect, it } from "vitest";
import { analyzeReport } from "../src/analysis/analyze";
import { buildChartConfigs } from "../src/charts/configs";
import { createAnonymizer } from "../src/render/anonymize";
import type { DataRow, RoundRow } from "../src/analysis/types";

const OPTS = {
  username: "your_username",
  maxMatches: 12,
  recordsCount: 12,
  fetchedAt: "2026-01-01T00:00:00.000Z",
};

describe("TR ledger", () => {
  it("separates the TR gained per win from the TR lost per loss", () => {
    const bundle = analyzeReport([
      round({ match: 1, result: "win", trDelta: 20 }),
      round({ match: 2, result: "win", trDelta: 10 }),
      round({ match: 3, result: "loss", trDelta: -12 }),
      round({ match: 4, result: "loss", trDelta: -18 }),
    ], OPTS);

    const ledger = bundle.summary.tr_ledger;
    expect(ledger.n).toBe(4);
    expect(ledger.wins).toBe(2);
    expect(ledger.losses).toBe(2);
    expect(ledger.avg_gain).toBe(15);
    // 敗北側は負値のまま持つ。
    expect(ledger.avg_loss).toBe(-15);
    expect(ledger.net).toBe(0);
    expect(ledger.net_per_match).toBe(0);
  });

  it("falls back to tr_after minus tr_before when the API omits tr_delta", () => {
    const bundle = analyzeReport([
      round({ match: 1, result: "win", trDelta: null, trBefore: 15000, trAfter: 15024 }),
      round({ match: 2, result: "loss", trDelta: null, trBefore: 15024, trAfter: 15000 }),
    ], OPTS);

    const ledger = bundle.summary.tr_ledger;
    expect(ledger.n).toBe(2);
    expect(ledger.avg_gain).toBe(24);
    expect(ledger.avg_loss).toBe(-24);
    expect(ledger.net).toBe(0);
  });

  it("drops matches with no TR movement available at all", () => {
    const bundle = analyzeReport([
      round({ match: 1, result: "win", trDelta: 20 }),
      round({ match: 2, result: "loss", trDelta: null, trBefore: null, trAfter: null }),
    ], OPTS);

    expect(bundle.summary.tr_ledger.n).toBe(1);
    expect(bundle.summary.tr_ledger.losses).toBe(0);
    expect(bundle.summary.tr_ledger.avg_loss).toBeNull();
  });

  it("keeps matches the expected-win table excludes", () => {
    const bundle = analyzeReport([
      // Glicko欠損のため期待勝率は算出されないが、TRは動いている。
      round({ match: 1, result: "win", trDelta: 20, opponentTrBefore: 14400, glicko: false }),
      round({ match: 2, result: "loss", trDelta: -15, opponentTrBefore: 14400, glicko: false }),
      round({ match: 3, result: "win", trDelta: 25, opponentTrBefore: 15100 }),
    ], OPTS);

    // 収支は期待勝率を使わないため3件すべて対象。
    expect(bundle.summary.tr_ledger.n).toBe(3);
    expect(bundle.summary.tr_ledger.net).toBe(30);
    // 期待勝率を使う tr_gap はGlicko欠損マッチを落とす。
    expect(bundle.summary.tr_gap.map((row) => row.n)).toEqual([1]);
  });

  it("bands by the quantiles of the TR gap actually faced", () => {
    const bundle = analyzeReport(spreadRounds(), OPTS);

    const bands = bundle.summary.tr_ledger.bands as Array<Record<string, unknown>>;
    expect(bands.length).toBeGreaterThan(1);
    // ラベルは分位境界。固定の ±500/1000/2000 ではない。
    for (const band of bands) {
      expect(String(band.label)).toMatch(/^-?\d+~-?\d+$/);
      expect(Number(band.low)).toBeLessThanOrEqual(Number(band.high));
    }
    // 帯は相手TR差の昇順。
    const lows = bands.map((band) => Number(band.low));
    expect([...lows].sort((a, b) => a - b)).toEqual(lows);
    // 全帯の合計が全体と一致する（抑制帯が無い場合）。
    expect(bands.reduce((sum, band) => sum + Number(band.n), 0)).toBe(bundle.summary.tr_ledger.n);
  });

  // 上位ランクでは格下相手の増減が厳密な0ではなく0.0xに張り付く。表示は小数1桁なので
  // 全セルが ±0.0 になり読めない。「増減が全て0」という判定では捕まらない形。
  it("suppresses bands whose TR movement is too small to read, not just exact zeros", () => {
    const bundle = analyzeReport(Array.from({ length: 12 }, (_, index) => {
      const gap = (index + 1) * 100;
      const frozen = gap >= 700;
      return round({
        match: index + 1,
        result: frozen || index % 2 === 0 ? "win" : "loss",
        trDelta: frozen ? 0.02 : (index % 2 === 0 ? 20 : -15),
        opponentTrBefore: 15000 - gap,
      });
    }), { ...OPTS, maxMatches: 12, recordsCount: 12 });

    const ledger = bundle.summary.tr_ledger;
    const bands = ledger.bands as Array<Record<string, unknown>>;
    expect(ledger.n).toBe(12);
    expect(ledger.suppressed_bands).toBeGreaterThan(0);
    expect(ledger.suppressed_matches).toBe(6);
    // 落とした帯の増減は0ではない。合計には残る。
    expect(Number(ledger.net)).toBeCloseTo(6 * 0.02 + 3 * 20 - 3 * 15, 6);
    // 残った帯は読める増減を持つ。
    expect(bands.reduce((sum, band) => sum + Number(band.n), 0)).toBe(6);
    expect(bands.every((band) => Math.abs(Number(band.net_per_match)) >= 0.05)).toBe(true);

    // 抑制した帯はチャートにも出ない。
    const chart = buildChartConfigs(bundle, createAnonymizer(false))["32_tr_ledger"];
    expect(chart.data.labels).toEqual(bands.map((band) => band.label));
  });

  it("leaves the gain bar missing instead of zero for a band with no wins", () => {
    const bundle = analyzeReport(spreadRounds(), OPTS);
    const chart = buildChartConfigs(bundle, createAnonymizer(false))["32_tr_ledger"];
    const bands = bundle.summary.tr_ledger.bands as Array<Record<string, unknown>>;
    const index = bands.findIndex((band) => Number(band.wins) === 0);
    expect(index).toBeGreaterThan(-1);

    const gain = chart.data.datasets.find((dataset) => dataset.label === "勝ち時の平均増減")!;
    expect((gain.data as Array<number | null>)[index]).toBeNull();
    const loss = chart.data.datasets.find((dataset) => dataset.label === "負け時の平均増減")!;
    expect((loss.data as Array<number | null>)[index]).not.toBeNull();
  });

  // ほぼ0の勝ちに紛れた1件の大きな敗北。帯の平均絶対増減は 8.166/167 ≒ 0.049 で
  // しきい値0.05を下回るため、平均で判定すると読める -8.0TR ごと消える。
  it("keeps a band whose loss average is readable even when its wins are near zero", () => {
    const total = 167;
    const rounds = Array.from({ length: total }, (_, index) => round({
      match: index + 1,
      result: index === total - 1 ? "loss" : "win",
      trDelta: index === total - 1 ? -8 : 0.001,
      // TR差を同値にして1帯へ寄せる。
      opponentTrBefore: 14900,
    }));
    const bundle = analyzeReport(rounds, { ...OPTS, maxMatches: total, recordsCount: total });

    const bands = bundle.summary.tr_ledger.bands as Array<Record<string, unknown>>;
    expect(bands).toHaveLength(1);
    expect(Number(bands[0]!.losses)).toBe(1);
    expect(Number(bands[0]!.avg_loss)).toBeCloseTo(-8, 6);
    expect(bundle.summary.tr_ledger.suppressed_bands).toBe(0);
  });

  // TR差が全件同値だと quantileBins は帯を返さない。黙って表とチャートが消えないこと。
  it("falls back to a single band when every TR gap is identical", () => {
    const bundle = analyzeReport(Array.from({ length: 12 }, (_, index) => round({
      match: index + 1,
      result: index % 2 === 0 ? "win" : "loss",
      trDelta: index % 2 === 0 ? 20 : -15,
      opponentTrBefore: 14900,
    })), { ...OPTS, maxMatches: 12, recordsCount: 12 });

    const ledger = bundle.summary.tr_ledger;
    const bands = ledger.bands as Array<Record<string, unknown>>;
    expect(bands).toHaveLength(1);
    expect(Number(bands[0]!.n)).toBe(12);
    expect(Number(bands[0]!.net)).toBe(ledger.net);
    expect(ledger.suppressed_bands).toBe(0);
  });

  // 相手TR差を散らし、最も格上寄りの帯だけ全敗にする。
  function spreadRounds(): RoundRow[] {
    return Array.from({ length: 12 }, (_, index) => round({
      match: index + 1,
      result: index < 2 ? "loss" : (index % 2 === 0 ? "win" : "loss"),
      trDelta: index < 2 ? -30 : (index % 2 === 0 ? 20 : -15),
      opponentTrBefore: 15000 + 600 - index * 100,
    }));
  }
});

interface RoundSpec {
  match: number;
  result: "win" | "loss";
  trDelta: number | null;
  trBefore?: number | null;
  trAfter?: number | null;
  opponentTrBefore?: number;
  glicko?: boolean;
}

function round(spec: RoundSpec): RoundRow {
  const won = spec.result === "win";
  const trBefore = spec.trBefore === undefined ? 15000 : spec.trBefore;
  const trAfter = spec.trAfter === undefined
    ? (trBefore === null || spec.trDelta === null ? null : trBefore + spec.trDelta)
    : spec.trAfter;
  const row: DataRow = {
    match_number: spec.match,
    match_id: `m${spec.match}`,
    played_at_jst: `2026-01-0${spec.match} 12:00:00`,
    match_result: spec.result,
    target_score: won ? 1 : 0,
    opponent_score: won ? 0 : 1,
    target_id: "target",
    target_username: "your_username",
    opponent: `opponent_${spec.match}`,
    opponent_id: `opponent_${spec.match}`,
    round: 1,
    round_won: won,
    opponent_round_won: !won,
    apm: 50,
    pps: 1.5,
    vs: 100,
    opponent_apm: 45,
    opponent_pps: 1.4,
    opponent_vs: 95,
    tr_before: trBefore,
    tr_after: trAfter,
    tr_delta: spec.trDelta,
    opponent_tr_before: spec.opponentTrBefore ?? 14900,
  };
  if (spec.glicko !== false) {
    row.glicko_before = 1700;
    row.opponent_glicko_before = 1680;
    row.opponent_rd_before = 60;
  }
  return row as RoundRow;
}
