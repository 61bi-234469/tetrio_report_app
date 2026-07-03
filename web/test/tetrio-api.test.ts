import { describe, expect, it, vi } from "vitest";
import { analyzeReport } from "../src/analysis/analyze";
import { convertToRoundRows, fetchAllLeagueRecords, validateUsername } from "../src/tetrio-api";

describe("tetrio api fetcher", () => {
  it("rejects placeholder username", () => {
    expect(() => validateUsername("your_username")).toThrow();
  });

  it("paginates, de-duplicates, and stops at max matches", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      const after = parsed.searchParams.get("after");
      const entries = after
        ? [{ _id: "m100", p: { pri: 100, sec: 100, ter: 100 } }, { _id: "m101", p: { pri: 101, sec: 101, ter: 101 } }]
        : Array.from({ length: 100 }, (_, index) => ({
          _id: `m${index + 1}`,
          p: { pri: index + 1, sec: index + 1, ter: index + 1 },
        }));
      return new Response(JSON.stringify({
        success: true,
        cache: { cached_until: 1000 },
        data: { entries },
      }));
    });
    const result = await fetchAllLeagueRecords("player", {
      fetcher: fetcher as unknown as typeof fetch,
      maxMatches: 101,
      maxPages: 5,
      pageDelayMs: 0,
      sessionId: "session",
    });
    expect(result.records.at(0)?._id).toBe("m1");
    expect(result.records.at(-1)?._id).toBe("m101");
    expect(result.records).toHaveLength(101);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("preserves leaderboard activity so API-derived DQ results are counted outside normal analysis", () => {
    const records = [
      record("dq-win", "2026-07-01T00:00:00.000Z", 2, 0, true, false),
      record("dq-loss", "2026-07-02T00:00:00.000Z", 0, 2, false, true),
    ];
    const rows = convertToRoundRows(records, "player");
    const bundle = analyzeReport(rows, {
      username: "player",
      maxMatches: 2,
      recordsCount: 2,
      fetchedAt: "2026-07-02T00:00:00.000Z",
    });
    const summary = bundle.summary as any;

    expect(rows[0]?.opponent_leaderboard_active).toBe(false);
    expect(rows[1]?.target_leaderboard_active).toBe(false);
    expect(summary.meta.dq_wins).toBe(1);
    expect(summary.meta.dq_losses).toBe(1);
    expect(summary.kpis.dq_wins).toBe(1);
    expect(summary.kpis.dq_losses).toBe(1);
    expect(summary.meta.matches).toBe(2);
    expect(summary.meta.analysis_matches).toBe(0);
    expect(bundle.matches).toHaveLength(0);
  });
});

function record(
  id: string,
  ts: string,
  targetWins: number,
  opponentWins: number,
  targetActive: boolean,
  opponentActive: boolean,
): Record<string, unknown> {
  return {
    _id: id,
    replayid: `${id}-replay`,
    ts,
    gamemode: "league",
    p: { pri: id, sec: id, ter: id },
    otherusers: [
      { id: "target", username: "player" },
      { id: "opponent", username: `opponent_${id}` },
    ],
    results: {
      leaderboard: [
        { id: "target", username: "player", wins: targetWins, active: targetActive, stats: stats(60, 2, 120) },
        { id: "opponent", username: `opponent_${id}`, wins: opponentWins, active: opponentActive, stats: stats(55, 1.9, 110) },
      ],
      rounds: [
        [
          { id: "target", username: "player", alive: targetWins > opponentWins, lifetime: 65000, active: targetActive, stats: stats(62, 2.1, 125) },
          { id: "opponent", username: `opponent_${id}`, alive: targetWins < opponentWins, lifetime: 64000, active: opponentActive, stats: stats(50, 1.8, 100) },
        ],
      ],
    },
    extras: {
      league: {
        target: [
          { tr: 15000, glicko: 1800, rd: 70, rank: "u" },
          { tr: targetWins > opponentWins ? 15020 : 14980, glicko: 1810, rd: 68, rank: "u" },
        ],
        opponent: [
          { tr: 14900, glicko: 1750, rd: 75, rank: "ss" },
          { tr: opponentWins > targetWins ? 14920 : 14880, glicko: 1745, rd: 76, rank: "ss" },
        ],
      },
    },
  };
}

function stats(apm: number, pps: number, vsscore: number): Record<string, number> {
  return {
    apm,
    pps,
    vsscore,
    pieceplaced: 120,
    inputs: 300,
    lines: 40,
    attack: 20,
    garbagesent: 22,
    garbagereceived: 18,
    garbagecleared: 15,
    btb: 4,
  };
}
