import { describe, expect, it } from "vitest";
import { analyzeReport } from "../src/analysis/analyze";
import type { RoundRow } from "../src/analysis/types";
import { buildChartConfigs, indexTo100, sessionDecayIndexTo100 } from "../src/charts/configs";
import { createAnonymizer } from "../src/render/anonymize";

describe("chart helpers", () => {
  it("uses the first bucket as the fixed 100 index base", () => {
    expect(indexTo100([50, 55, 60])).toEqual([100, 110, 120]);
  });

  it("does not rebase to a later bucket when the first bucket is missing", () => {
    expect(indexTo100([null, 55, 60])).toEqual([null, null, null]);
  });

  it("does not divide by a zero first bucket", () => {
    expect(indexTo100([0, 55, 60])).toEqual([null, null, null]);
  });

  it("indexes session decay metrics to the row labeled as the first match", () => {
    const rows = [
      { label: "1マッチ目", apm: 50 },
      { label: "2マッチ目", apm: 55 },
      { label: "10マッチ目", apm: 60 },
      { label: "11マッチ目以上", apm: 65 },
    ];

    expect(sessionDecayIndexTo100(rows, "apm")).toEqual([100, 110, 120, 130]);
  });

  it("does not index session decay metrics when the first-match row is absent", () => {
    const rows = [
      { label: "2マッチ目", apm: 55 },
      { label: "10マッチ目", apm: 60 },
      { label: "11マッチ目以上", apm: 65 },
    ];

    expect(sessionDecayIndexTo100(rows, "apm")).toEqual([null, null, null]);
  });

  it("keeps labeled chart datasets aligned with their labels", () => {
    const rounds = Array.from({ length: 24 }, (_, index) => {
      const match = index + 1;
      const won = match % 3 !== 0;
      return round(match, 1, won, 52 + match, 1.6 + match / 100, 100 + match * 2);
    });
    const bundle = analyzeReport(rounds, {
      username: "your_username",
      maxMatches: 100,
      recordsCount: rounds.length,
    });
    const configs = buildChartConfigs(bundle, createAnonymizer(false));

    for (const [id, config] of Object.entries(configs)) {
      const labels = config.data.labels;
      if (!labels) {
        continue;
      }
      for (const dataset of config.data.datasets) {
        const data = dataset.data;
        if (Array.isArray(data)) {
          expect(data, `${id}: ${String(dataset.label ?? "dataset")}`).toHaveLength(labels.length);
        }
      }
    }
  });
});

function round(match: number, roundNumber: number, won: boolean, apm: number, pps: number, vs: number): RoundRow {
  return {
    match_number: match,
    match_id: `m${match}`,
    played_at_jst: `2026-07-${String(Math.min(match, 28)).padStart(2, "0")} 12:00:00`,
    match_result: won ? "win" : "loss",
    target_score: won ? 1 : 0,
    opponent_score: won ? 0 : 1,
    target_id: "p1",
    target_username: "your_username",
    opponent: `opponent_${match}`,
    opponent_id: `o${match}`,
    round: roundNumber,
    round_won: won,
    opponent_round_won: !won,
    apm,
    pps,
    vs,
    opponent_apm: apm - 4,
    opponent_pps: pps - 0.05,
    opponent_vs: vs - 8,
    tr_before: 15000 + match * 10,
    tr_after: 15000 + match * 10 + (won ? 12 : -12),
    opponent_tr_before: 14900,
    glicko_before: 1800,
    opponent_glicko_before: 1750,
    opponent_rd_before: 70,
    Opener: 0.5,
    Stride: 0.45,
    "Inf DS": 0.4,
    Plonk: 0.35,
    opponent_Opener: 0.45,
    opponent_Stride: 0.4,
    "opponent_Inf DS": 0.35,
    opponent_Plonk: 0.3,
  };
}
