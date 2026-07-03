import type { MatchRow } from "./types";
import { mean } from "./stats";
import { toNumber } from "../utils";

export function glickoExpectedScore(
  ownGlicko: number,
  opponentGlicko: number,
  opponentRd: number,
): number {
  const q = Math.log(10) / 400;
  const rd = Math.max(0, opponentRd);
  const gRd = 1 / Math.sqrt(1 + (3 * q * q * rd * rd) / (Math.PI * Math.PI));
  const diff = ownGlicko - opponentGlicko;
  const exponent = clamp((-gRd * diff) / 400, -20, 20);
  return 1 / (1 + 10 ** exponent);
}

export function applyExpectedWins(matches: MatchRow[]): {
  baseline: Record<string, number | string | null>;
  valid_n: number;
} {
  const valid: MatchRow[] = [];
  for (const match of matches) {
    const own = toNumber(match.glicko_before);
    const opponent = toNumber(match.opponent_glicko_before);
    const rd = toNumber(match.opponent_rd_before);
    if (match.analysis_eligible && own !== null && opponent !== null && rd !== null) {
      const expected = glickoExpectedScore(own, opponent, rd);
      match.expected_win = expected;
      valid.push(match);
    } else {
      match.expected_win = null;
    }
  }

  return {
    valid_n: valid.length,
    baseline: {
      method: "glicko_rd",
      n: valid.length,
      mean_expected: mean(valid.map((match) => match.expected_win)),
      mean_actual: mean(valid.map((match) => (match.won ? 1 : 0))),
      mean_glicko_diff: mean(valid.map((match) => {
        const own = toNumber(match.glicko_before);
        const opponent = toNumber(match.opponent_glicko_before);
        return own !== null && opponent !== null ? own - opponent : null;
      })),
      mean_opponent_rd: mean(valid.map((match) => match.opponent_rd_before)),
    },
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
