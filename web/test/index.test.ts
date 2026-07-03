import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/index";

describe("worker endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a self-contained report from mocked TETR.IO records", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/summaries/league")) {
        return new Response(JSON.stringify({
          success: true,
          cache: { cached_until: 1_800_000_000 },
          data: { apm: 82.42, pps: 1.78, vs: 164.68, tr: 20447.864, glicko: 2283.487, rd: 60.48, gameswon: 1973, rank: "x" },
        }));
      }
      return new Response(JSON.stringify({
        success: true,
        cache: { cached_until: 1_800_000_000 },
        data: { entries: [record("m1", "2026-07-01T00:00:00.000Z", 2, 1), record("m2", "2026-07-02T00:00:00.000Z", 1, 2)] },
      }));
    }));

    const response = await handleRequest(new Request("http://worker.test/api/report?username=player&max_matches=2"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(html).toContain("const CHART_CONFIGS=");
    expect(html).toContain("01_tr_history");
    expect(html).toContain("29_session_decay");
    expect(html).toContain("summary API 由来の現在値");
    expect(html).toContain("現在TR（summary）");
    expect(html).toContain("TETR.IO / osk");
  });
});

function record(id: string, ts: string, targetWins: number, opponentWins: number): Record<string, unknown> {
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
        { id: "target", username: "player", wins: targetWins, active: true, stats: stats(60, 2, 120) },
        { id: "opponent", username: `opponent_${id}`, wins: opponentWins, active: true, stats: stats(55, 1.9, 110) },
      ],
      rounds: [
        [
          { id: "target", username: "player", alive: true, lifetime: 65000, active: true, stats: stats(62, 2.1, 125) },
          { id: "opponent", username: `opponent_${id}`, alive: false, lifetime: 64000, active: true, stats: stats(50, 1.8, 100) },
        ],
        [
          { id: "target", username: "player", alive: targetWins > opponentWins, lifetime: 70000, active: true, stats: stats(58, 1.95, 115) },
          { id: "opponent", username: `opponent_${id}`, alive: targetWins < opponentWins, lifetime: 70000, active: true, stats: stats(57, 1.92, 112) },
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
