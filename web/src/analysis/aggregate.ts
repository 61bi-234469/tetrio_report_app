import type { MatchRow } from "./types";
import { toNumber } from "../utils";
import { mean } from "./stats";

export function groupWinRate(group: Array<Pick<MatchRow, "won">>): number | null {
  return group.length ? group.filter((match) => match.won).length / group.length : null;
}

export function expectedExcess(group: Array<{ won: boolean; expected_win?: unknown }>): number | null {
  const valid = group.filter((match) => toNumber(match.expected_win) !== null);
  if (!valid.length) {
    return null;
  }
  return (mean(valid.map((match) => match.won ? 1 : 0)) ?? 0) - (mean(valid.map((match) => match.expected_win)) ?? 0);
}
