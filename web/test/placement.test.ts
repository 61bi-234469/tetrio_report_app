import { describe, expect, it } from "vitest";
import { analyzeReport } from "../src/analysis/analyze";
import { buildChartConfigs } from "../src/charts/configs";
import { createAnonymizer } from "../src/render/anonymize";
import type { DataRow, RoundRow } from "../src/analysis/types";

const OPTS = {
  username: "your_username",
  maxMatches: 5,
  recordsCount: 5,
  fetchedAt: "2026-01-01T00:00:00.000Z",
};

describe("placement journey", () => {
  it("tracks the best, worst and net change of the world placement", () => {
    const bundle = analyzeReport([
      round(1, "win", 900),
      round(2, "win", 820),
      round(3, "loss", 870),
      round(4, "win", 780),
      round(5, "loss", 810),
    ], OPTS);

    const placement = bundle.summary.placement;
    expect(placement.n).toBe(5);
    expect(placement.first).toBe(900);
    expect(placement.current).toBe(810);
    // 順位は小さいほど上位。
    expect(placement.best).toBe(780);
    expect(placement.worst).toBe(900);
    // 正なら期間中に順位が上がった。
    expect(placement.change).toBe(90);
  });

  it("ignores rows without a positive placement", () => {
    const bundle = analyzeReport([
      round(1, "win", null),
      round(2, "win", 0),
      round(3, "loss", -1),
      round(4, "win", 500),
    ], OPTS);

    const placement = bundle.summary.placement;
    expect(placement.n).toBe(1);
    expect(placement.best).toBe(500);
    expect(placement.current).toBe(500);
    expect(placement.change).toBe(0);
  });

  it("reports no sample when the API never returned a placement", () => {
    const bundle = analyzeReport([round(1, "win", null), round(2, "loss", null)], OPTS);

    expect(bundle.summary.placement.n).toBe(0);
    expect(bundle.summary.placement.current).toBeNull();
    expect(bundle.summary.placement.best).toBeNull();
    expect(bundle.summary.placement.change).toBeNull();
  });

  it("draws gaps for matches without a placement and keeps a lone point visible", () => {
    const bundle = analyzeReport([
      round(1, "win", null),
      round(2, "win", 820),
      round(3, "loss", null),
    ], OPTS);

    const dataset = buildChartConfigs(bundle, createAnonymizer(false))["31_placement_history"].data.datasets[0]!;
    // 欠損は0ではなく線の切れ目。
    expect(dataset.data).toEqual([null, 820, null]);
    // 点が1つだけのときは線が引けないため、点そのものを描く。
    expect(dataset.pointRadius).toBeGreaterThan(0);
  });
});

function round(match: number, result: "win" | "loss", placementAfter: number | null): RoundRow {
  const won = result === "win";
  const row: DataRow = {
    match_number: match,
    match_id: `m${match}`,
    played_at_jst: `2026-01-0${match} 12:00:00`,
    match_result: result,
    target_score: won ? 1 : 0,
    opponent_score: won ? 0 : 1,
    target_id: "target",
    target_username: "your_username",
    opponent: `opponent_${match}`,
    opponent_id: `opponent_${match}`,
    round: 1,
    round_won: won,
    opponent_round_won: !won,
    apm: 50,
    pps: 1.5,
    vs: 100,
    opponent_apm: 45,
    opponent_pps: 1.4,
    opponent_vs: 95,
    tr_before: 15000,
    tr_after: won ? 15010 : 14990,
    opponent_tr_before: 14900,
    glicko_before: 1700,
    opponent_glicko_before: 1680,
    opponent_rd_before: 60,
    placement_after: placementAfter,
  };
  return row as RoundRow;
}
