import { describe, expect, it } from "vitest";
import { analyzeReport } from "../src/analysis/analyze";
import type { DataRow, RoundRow } from "../src/analysis/types";

describe("streak summaries", () => {
  it("separates overall streak records from session-local streak distribution", () => {
    const bundle = analyzeReport([
      round(1, "2026-01-01 00:00:00", "win"),
      round(2, "2026-01-01 00:02:00", "win"),
      round(3, "2026-01-01 01:00:00", "win"),
      round(4, "2026-01-01 01:02:00", "win"),
      round(5, "2026-01-01 01:04:00", "loss"),
    ], {
      username: "your_username",
      maxMatches: 5,
      recordsCount: 5,
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(bundle.summary.streaks.max_win).toBe(4);
    expect(bundle.summary.streaks.max_loss).toBe(1);
    expect(bundle.summary.streaks.session_max_win).toBe(2);
    expect(bundle.summary.streaks.session_max_loss).toBe(1);
    expect(bundle.summary.streaks.overall_win_runs).toEqual([4]);
    expect(bundle.summary.streaks.session_win_runs).toEqual([2, 2]);
    expect(bundle.summary.streaks.win_runs).toEqual([2, 2]);

    const records = new Map(bundle.summary.records.map((record) => [record.name, record]));
    expect(records.get("最長連勝")?.value).toBe(4);
    expect(records.get("最長連勝")?.scope).toBe("全期間の連続勝敗");
    expect(records.get("セッション内最長連勝")?.value).toBe(2);
    expect(records.get("セッション内最長連勝")?.scope).toBe("セッション内連勝・連敗");
  });
});

function round(match: number, playedAt: string, result: "win" | "loss"): RoundRow {
  const won = result === "win";
  const row: DataRow = {
    match_number: match,
    match_id: `m${match}`,
    played_at_jst: playedAt,
    match_result: result,
    target_score: won ? 1 : 0,
    opponent_score: won ? 0 : 1,
    target_id: "target",
    target_username: "your_username",
    opponent: `opponent_${match}`,
    opponent_id: `opponent_${match}`,
    target_leaderboard_active: true,
    opponent_leaderboard_active: true,
    round: 1,
    round_won: won,
    opponent_round_won: !won,
    lifetime_ms: 60_000,
    opponent_lifetime_ms: 60_000,
    apm: 50 + match,
    pps: 1.5,
    vs: 100 + match,
    opponent_apm: 45,
    opponent_pps: 1.4,
    opponent_vs: 95,
    tr_before: 15000 + match,
    tr_after: 15000 + match + (won ? 10 : -10),
    tr_delta: won ? 10 : -10,
    opponent_tr_before: 14900,
    opponent_rd_before: 60,
    glicko_before: 1700,
    opponent_glicko_before: 1680,
    rd_before: 60,
    league_rank_after: "s",
  };
  return row as RoundRow;
}
