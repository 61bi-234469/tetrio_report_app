import { describe, expect, it } from "vitest";
import { analyzeReport } from "../src/analysis/analyze";
import { buildChartConfigs } from "../src/charts/configs";
import { createAnonymizer } from "../src/render/anonymize";
import type { DataRow, RoundRow } from "../src/analysis/types";

const OPTS = {
  username: "your_username",
  maxMatches: 6,
  recordsCount: 6,
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

  it("bands the ledger by the TR gap, including matches the expected-win table excludes", () => {
    const bundle = analyzeReport([
      // 相手TRが自分より600低い＝帯「500~1000」。Glicko欠損のため期待勝率は算出されない。
      round({ match: 1, result: "win", trDelta: 20, opponentTrBefore: 14400, glicko: false }),
      round({ match: 2, result: "loss", trDelta: -15, opponentTrBefore: 14400, glicko: false }),
      // 相手TRが自分より100高い＝帯「-500~0」。
      round({ match: 3, result: "win", trDelta: 25, opponentTrBefore: 15100 }),
    ], OPTS);

    const bands = bundle.summary.tr_ledger.bands as Array<Record<string, unknown>>;
    const byLabel = new Map(bands.map((band) => [band.label, band]));
    expect([...byLabel.keys()]).toEqual(["-500~0", "500~1000"]);
    expect(byLabel.get("500~1000")?.n).toBe(2);
    expect(byLabel.get("500~1000")?.net).toBe(5);
    expect(byLabel.get("-500~0")?.net_per_match).toBe(25);

    // 期待勝率を使う tr_gap はGlicko欠損マッチを落とすため、同じ帯を持たない。
    const gapLabels = bundle.summary.tr_gap.map((row) => row.label);
    expect(gapLabels).toEqual(["-500~0"]);
  });

  it("leaves the gain bar missing instead of zero for a band with no wins", () => {
    const bundle = analyzeReport([
      // 帯「500~1000」は敗北1件のみ＝勝ち時平均は存在しない。
      round({ match: 1, result: "loss", trDelta: -15, opponentTrBefore: 14400 }),
      round({ match: 2, result: "win", trDelta: 25, opponentTrBefore: 15100 }),
    ], OPTS);

    const chart = buildChartConfigs(bundle, createAnonymizer(false))["32_tr_ledger"];
    const index = (chart.data.labels ?? []).indexOf("500~1000");
    expect(index).toBeGreaterThan(-1);
    const gain = chart.data.datasets.find((dataset) => dataset.label === "勝ち時の平均増減")!;
    expect((gain.data as Array<number | null>)[index]).toBeNull();
    const loss = chart.data.datasets.find((dataset) => dataset.label === "負け時の平均増減")!;
    expect((loss.data as Array<number | null>)[index]).toBe(-15);
  });
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
