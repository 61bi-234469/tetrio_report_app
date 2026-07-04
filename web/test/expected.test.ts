import { describe, expect, it } from "vitest";
import { applyExpectedWins, glickoExpectedScore } from "../src/analysis/expected";
import type { MatchRow } from "../src/analysis/types";

describe("glicko expected score", () => {
  it("is 50% at equal ratings", () => {
    expect(glickoExpectedScore(1500, 1500, 60)).toBeCloseTo(0.5, 12);
  });

  it("increases with rating advantage", () => {
    expect(glickoExpectedScore(1700, 1500, 60)).toBeGreaterThan(0.5);
    expect(glickoExpectedScore(1300, 1500, 60)).toBeLessThan(0.5);
  });

  it("clips negative RD to zero", () => {
    expect(glickoExpectedScore(1600, 1500, -20)).toBeCloseTo(glickoExpectedScore(1600, 1500, 0), 12);
  });
});

describe("applyExpectedWins", () => {
  function match(overrides: Partial<MatchRow>): MatchRow {
    return {
      match_number: 1,
      match_id: null,
      played_at_jst: null,
      opponent: null,
      opponent_id: null,
      match_result: null,
      target_score: null,
      opponent_score: null,
      won: true,
      completed: true,
      analysis_eligible: true,
      round_count: 1,
      glicko_before: 1500,
      opponent_glicko_before: 1500,
      opponent_rd_before: 60,
      ...overrides,
    } as MatchRow;
  }

  it("computes expected_win for DQ-included completed matches, per the DQ込み一本化 decision", () => {
    const dqWin = match({ completed: true, analysis_eligible: false, won: true });
    const { valid_n } = applyExpectedWins([dqWin]);
    expect(valid_n).toBe(1);
    expect(dqWin.expected_win).not.toBeNull();
  });

  it("leaves expected_win null for matches that are not completed (tie/nullified/no_contest)", () => {
    const notCompleted = match({ completed: false, analysis_eligible: false });
    const { valid_n } = applyExpectedWins([notCompleted]);
    expect(valid_n).toBe(0);
    expect(notCompleted.expected_win).toBeNull();
  });
});
