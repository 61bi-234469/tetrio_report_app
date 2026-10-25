import { describe, expect, it } from "vitest";
import { analyzeReport } from "../src/analysis/analyze";
import { renderChapters } from "../src/render/chapters";
import { buildChartConfigs } from "../src/charts/configs";
import { createAnonymizer } from "../src/render/anonymize";
import type { DataRow, RoundRow } from "../src/analysis/types";

const OPTS = {
  username: "your_username",
  maxMatches: 12,
  recordsCount: 12,
  fetchedAt: "2026-01-01T00:00:00.000Z",
};

describe("PPS bins expected excess", () => {
  // Glicko欠損マッチは期待勝率を持たない。実績勝率は全試合、期待勝率はその部分集合で出るため、
  // 単純な引き算は母集団の違う値を比べてしまう。
  it("computes the excess on the expectation-eligible subset, not the whole bin", () => {
    const bins = analyzeReport(mixedRounds(), OPTS).summary.pps_bins;

    expect(bins.length).toBeGreaterThan(0);
    for (const bin of bins) {
      // 各帯は「期待勝率を持つ敗北1件＋持たない勝利1件」。
      expect(bin.n).toBe(2);
      expect(bin.expected_n).toBe(1);
      expect(bin.win_rate).toBe(0.5);
      expect(bin.expected).toBeCloseTo(0.5, 6);
      // 期待対象だけなら0勝1敗で -50pt。全体の勝率0.5から引くと0ptになってしまう。
      expect(bin.excess).toBeCloseTo(-0.5, 6);
    }
  });

  it("renders the subset excess and its sample count in chapter 5", () => {
    const html = renderChapters(analyzeReport(mixedRounds(), OPTS), createAnonymizer(false));
    const start = html.indexOf("PPS帯別の効率と勝率");
    expect(start).toBeGreaterThan(-1);
    const section = html.slice(start, html.indexOf("</section>", start));

    expect(section).toContain("期待対象");
    expect(section).toContain("-50.0pt");
    expect(section).not.toContain(">0.0pt<");
  });

  it("draws a gap instead of 0% when a band has no expectation-eligible match", () => {
    // 最初のペアだけ両方Glicko欠損＝その帯の期待勝率は存在しない。
    const rounds = mixedRounds().map((row, index) => (index < 2
      ? { ...row, glicko_before: null, opponent_glicko_before: null, opponent_rd_before: null }
      : row));
    const bundle = analyzeReport(rounds, OPTS);

    expect(bundle.summary.pps_bins[0]!.expected_n).toBe(0);
    expect(bundle.summary.pps_bins[0]!.expected).toBeNull();
    expect(bundle.summary.pps_bins[0]!.excess).toBeNull();

    const chart = buildChartConfigs(bundle, createAnonymizer(false))["30_pps_efficiency"];
    const expected = chart.data.datasets.find((dataset) => dataset.label === "期待勝率")!;
    // 欠損は0%ではなく線の切れ目。
    expect((expected.data as Array<number | null>)[0]).toBeNull();
  });

  // PPS分位が帯を作れるよう同値を2件ずつ並べる。各ペアの敗北だけが期待勝率を持つ。
  function mixedRounds(): RoundRow[] {
    return Array.from({ length: 12 }, (_, index) => round({
      match: index + 1,
      result: index % 2 === 0 ? "loss" : "win",
      pps: 1 + Math.floor(index / 2) / 10,
      glicko: index % 2 === 0,
    }));
  }
});

interface RoundSpec {
  match: number;
  result: "win" | "loss";
  pps: number;
  glicko?: boolean;
}

function round(spec: RoundSpec): RoundRow {
  const won = spec.result === "win";
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
    pps: spec.pps,
    vs: 100,
    opponent_apm: 45,
    opponent_pps: 1.4,
    opponent_vs: 95,
    tr_before: 15000,
    tr_after: won ? 15020 : 14980,
    tr_delta: won ? 20 : -20,
    opponent_tr_before: 15000,
  };
  if (spec.glicko !== false) {
    // 自分と相手が同Glicko=期待勝率0.5。
    row.glicko_before = 1700;
    row.opponent_glicko_before = 1700;
    row.opponent_rd_before = 0;
  }
  return row as RoundRow;
}
